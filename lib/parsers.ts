import * as XLSX from 'xlsx';
import { RawInventoryItem, RawSalesItem, InventoryItem, SalesItem } from './types';
import { cleanPublisherName } from './publisher-cleaner';
import { isSecondHandCategory } from './catalog-scope';

export interface ParseResult<T> {
  data: T[];
  rowCount: number;
  errors: string[];
}

export interface SalesParseResult extends ParseResult<SalesItem> {
  dateRange: string;
  daysInRange: number;
}

export function parseInventoryFile(
  file: ArrayBuffer,
  overrides?: Record<string, string>
): ParseResult<InventoryItem> {
  const workbook = XLSX.read(file, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json<RawInventoryItem>(sheet);
  const errors: string[] = [];

  const data: InventoryItem[] = [];
  let skippedNegative = 0;
  let skippedSecondHand = 0;

  for (const row of rawData) {
    const qty = Number(row.Qty) || 0;

    // Skip negative quantities (data errors)
    if (qty < 0) {
      skippedNegative++;
      continue;
    }

    // Skip second-hand books — opportunistic inventory, not useful for restock analytics
    const category = String(row.Category || '').trim();
    if (isSecondHandCategory(category)) {
      skippedSecondHand++;
      continue;
    }

    const itemCode = String(row.ItemCode || '').trim();
    if (!itemCode) continue;

    const rawBrand = String(row.Brand || '').trim();
    const subBrand = String(row['Sub Brand'] || '').trim();

    data.push({
      name: String(row.Name || '').trim(),
      rawBrand,
      subBrand,
      publisher: cleanPublisherName(row.Brand, overrides),
      category,
      isbn: itemCode,
      mrp: Number(row.MRP) || 0,
      sellingPrice: Number(row['Selling Price']) || Number(row.MRP) || 0,
      qty,
    });
  }

  if (skippedNegative > 0) {
    errors.push(`Skipped ${skippedNegative} items with negative quantities`);
  }
  if (skippedSecondHand > 0) {
    errors.push(`Skipped ${skippedSecondHand} second-hand book items`);
  }

  return { data, rowCount: rawData.length, errors };
}

function parseDateRange(sheet: XLSX.WorkSheet): { dateRange: string; daysInRange: number } {
  // The sales file has a title block in rows 1-4
  // We need to find the date range from the title block
  // It's typically in a format like "From : 01/01/2026  To : 21/02/2026"
  let dateRange = '';
  let daysInRange = 52; // Default fallback (Jan 1 to Feb 21 = 52 days)

  // Read the first few rows to find the date range
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  for (let r = 0; r < Math.min(5, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'string') {
        const val = cell.v;
        // Look for "DD/MM/YYYY to DD/MM/YYYY" pattern (actual format from ERP)
        const simpleMatch = val.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*to\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
        if (simpleMatch) {
          const [, fromStr, toStr] = simpleMatch;
          dateRange = `${fromStr} to ${toStr}`;

          // Parse dates (DD/MM/YYYY format)
          const [fd, fm, fy] = fromStr.split('/').map(Number);
          const [td, tm, ty] = toStr.split('/').map(Number);
          const fromDate = new Date(fy, fm - 1, fd);
          const toDate = new Date(ty, tm - 1, td);
          daysInRange = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)));
          break;
        }

        // Also try: "From : DD/MM/YYYY To : DD/MM/YYYY" format
        const fromToMatch = val.match(/From\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*To\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
        if (fromToMatch) {
          const [, fromStr, toStr] = fromToMatch;
          dateRange = `${fromStr} to ${toStr}`;
          const [fd, fm, fy] = fromStr.split('/').map(Number);
          const [td, tm, ty] = toStr.split('/').map(Number);
          const fromDate = new Date(fy, fm - 1, fd);
          const toDate = new Date(ty, tm - 1, td);
          daysInRange = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)));
          break;
        }

        // Also try: "01-Jan-2026 to 21-Feb-2026" type format
        const altMatch = val.match(/(\d{1,2}[-\/]\w{3}[-\/]\d{4})\s*to\s*(\d{1,2}[-\/]\w{3}[-\/]\d{4})/i);
        if (altMatch) {
          dateRange = `${altMatch[1]} to ${altMatch[2]}`;
          const from = new Date(altMatch[1]);
          const to = new Date(altMatch[2]);
          if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
            daysInRange = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
          }
          break;
        }
      }
    }
    if (dateRange) break;
  }

  return { dateRange: dateRange || 'Unknown date range', daysInRange };
}

export function parseSalesFile(file: ArrayBuffer): SalesParseResult {
  const workbook = XLSX.read(file, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // Extract date range from title block (rows 1-4)
  const { dateRange, daysInRange } = parseDateRange(sheet);

  // Header is in row 5 (0-indexed row 4), so use range: 4
  const rawData = XLSX.utils.sheet_to_json<RawSalesItem>(sheet, { range: 4 });
  const errors: string[] = [];

  const data: SalesItem[] = [];

  for (const row of rawData) {
    const isbn = String(row['Item Code'] || '').trim();
    const qtySold = Number(row['Quantity Sold']) || 0;

    // Skip rows without item code or quantity (e.g., totals row)
    if (!isbn || qtySold <= 0) continue;
    // Skip if "Sr.No" is empty or not a number (likely a totals/summary row)
    if (row['Sr.No'] !== undefined && isNaN(Number(row['Sr.No']))) continue;

    data.push({
      isbn,
      name: String(row['Product Name'] || '').trim(),
      qtySold,
      avgPrice: Number(row['Averege Price']) || Number(row['Average Price' as keyof RawSalesItem]) || 0,
      revenue: Number(row.Total) || 0,
    });
  }

  return { data, rowCount: rawData.length, errors, dateRange, daysInRange };
}
