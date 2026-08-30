#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

import { getPublisherAssignmentKey } from '../lib/catalog-imprints';
import { resolveCatalogSourcePaths } from '../lib/catalog-source-paths';
import { isSecondHandCategory } from '../lib/catalog-scope';
import { CatalogEntry, MasterCatalog } from '../lib/catalog-types';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'master-catalog.json');
const MIN_DAYS_TO_JUDGE = 60;
const IGNORE_STOCK_AT_OR_ABOVE = 40;
const ESTIMATED_COST_SHARE_OF_MRP = 0.7;
const AVERAGE_DAYS_PER_MONTH = 365.25 / 12;

interface SalesTotals {
  qtySold: number;
  revenue: number;
}

interface MovementRow {
  priority: 'High' | 'Medium' | 'Low';
  movement: 'Non-moving' | 'Very slow' | 'Slow';
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  parentPublisher: string;
  distributor: string;
  currentStock: number;
  unitsSold: number;
  salesRevenue: number;
  observedDays: number;
  monthlySalesRate: number;
  monthsOfStock: number | null;
  mrp: number;
  stockMrpValue: number;
  createdOn: string;
  ageGroup: string;
  tags: string;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value || '').trim();
  const namedDate = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if (namedDate) {
    const monthNames = [
      'jan', 'feb', 'mar', 'apr', 'may', 'jun',
      'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    ];
    const month = monthNames.indexOf(namedDate[1].slice(0, 3).toLowerCase());
    if (month >= 0) {
      return new Date(Date.UTC(Number(namedDate[3]), month, Number(namedDate[2])));
    }
  }

  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDate) {
    return new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseSalesPeriod(sheet: XLSX.WorkSheet): { start: Date; end: Date; label: string } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, defval: '' });
  for (const row of rows.slice(0, 8)) {
    for (const cell of row) {
      const match = String(cell).match(
        /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+to\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i
      );
      if (!match) continue;
      const start = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
      const end = new Date(Date.UTC(Number(match[6]), Number(match[5]) - 1, Number(match[4])));
      return { start, end, label: `${formatDate(start)} to ${formatDate(end)}` };
    }
  }
  throw new Error('Could not find the sales date range in the workbook');
}

function readSales(filePath: string): {
  period: { start: Date; end: Date; label: string };
  totals: Map<string, SalesTotals>;
} {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const period = parseSalesPeriod(sheet);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { range: 4, defval: '' });
  const totals = new Map<string, SalesTotals>();

  for (const row of rows) {
    const isbn = String(row['Item Code'] || '').trim();
    if (!isbn) continue;
    const current = totals.get(isbn) || { qtySold: 0, revenue: 0 };
    current.qtySold += Number(row['Quantity Sold']) || 0;
    current.revenue += Number(row['Total']) || 0;
    totals.set(isbn, current);
  }

  return { period, totals };
}

function readFirstSeenDates(filePath: string): Map<string, Date> {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const dates = new Map<string, Date>();

  for (const row of rows) {
    const isbn = String(row['ItemCode'] || '').trim();
    const category = String(row['Category'] || '').trim();
    if (!isbn || isSecondHandCategory(category) || (Number(row['Qty']) || 0) < 0) continue;
    const date = parseDate(row['Created on Date']);
    if (!date) continue;
    const current = dates.get(isbn);
    if (!current || date < current) dates.set(isbn, date);
  }

  return dates;
}

function getDistributorNames(catalog: MasterCatalog, entry: CatalogEntry): string {
  const ids = catalog.publisherDistributors[getPublisherAssignmentKey(entry)] || [];
  const namesById = new Map(catalog.distributors.map(distributor => [distributor.id, distributor.name]));
  return ids.map(id => namesById.get(id) || id).join(', ');
}

function getTags(entry: CatalogEntry): string {
  if (!entry.tagData) return '';
  return [
    entry.tagData.ageGroup,
    ...entry.tagData.categories,
    ...entry.tagData.subjects,
  ].filter(Boolean).join(', ');
}

function getPriority(stock: number, stockValue: number): 'High' | 'Medium' | 'Low' {
  if (stock >= 5 || stockValue >= 3000) return 'High';
  if (stock >= 2 || stockValue >= 1000) return 'Medium';
  return 'Low';
}

function toWorksheetRows(rows: MovementRow[]): Record<string, string | number>[] {
  return rows.map(row => ({
    Priority: row.priority,
    Movement: row.movement,
    ISBN: row.isbn,
    Title: row.title,
    Author: row.author,
    Publisher: row.publisher,
    'Parent Publisher': row.parentPublisher,
    Distributor: row.distributor,
    'Current Stock': row.currentStock,
    'Units Sold': row.unitsSold,
    'Sales Revenue': Number(row.salesRevenue.toFixed(2)),
    'Observed Days': row.observedDays,
    'Monthly Sales Rate': Number(row.monthlySalesRate.toFixed(2)),
    'Months of Stock': row.monthsOfStock === null ? 'No sales' : Number(row.monthsOfStock.toFixed(1)),
    MRP: Number(row.mrp.toFixed(2)),
    'Stock MRP Value': Number(row.stockMrpValue.toFixed(2)),
    'ERP Created On': row.createdOn,
    'Age Group': row.ageGroup,
    Tags: row.tags,
  }));
}

function setUsefulWidths(sheet: XLSX.WorkSheet): void {
  sheet['!cols'] = [
    { wch: 10 }, { wch: 14 }, { wch: 15 }, { wch: 42 }, { wch: 24 },
    { wch: 26 }, { wch: 24 }, { wch: 22 }, { wch: 14 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 10 },
    { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 55 },
  ];
}

function main(): void {
  if (!fs.existsSync(CATALOG_PATH)) throw new Error('Catalog not found. Run npm run build-catalog first.');

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')) as MasterCatalog;
  const paths = resolveCatalogSourcePaths(ROOT);
  const { period, totals } = readSales(paths.salesPath);
  const firstSeenDates = readFirstSeenDates(paths.inventoryPath);
  const reportRows: MovementRow[] = [];
  const recentRows: MovementRow[] = [];
  let ignoredBulkTitles = 0;
  let ignoredBulkUnits = 0;
  let ignoredBulkMrpValue = 0;

  for (const entry of Object.values(catalog.entries)) {
    const currentStock = Number(entry.currentStock) || 0;
    if (entry.scope !== 'book' || currentStock <= 0) continue;

    if (currentStock >= IGNORE_STOCK_AT_OR_ABOVE) {
      const mrp = Number(entry.mrp) || Number(entry.sellingPrice) || 0;
      ignoredBulkTitles += 1;
      ignoredBulkUnits += currentStock;
      ignoredBulkMrpValue += currentStock * mrp;
      continue;
    }

    const sales = totals.get(entry.isbn) || { qtySold: 0, revenue: 0 };
    const firstSeen = firstSeenDates.get(entry.isbn);
    const observedStart = firstSeen && firstSeen > period.start ? firstSeen : period.start;
    const observedDays = Math.max(1, Math.round((period.end.getTime() - observedStart.getTime()) / 86_400_000) + 1);
    const observedMonths = observedDays / AVERAGE_DAYS_PER_MONTH;
    const monthlySalesRate = sales.qtySold / observedMonths;
    const monthsOfStock = monthlySalesRate > 0 ? currentStock / monthlySalesRate : null;
    const mrp = Number(entry.mrp) || Number(entry.sellingPrice) || 0;
    const stockMrpValue = currentStock * mrp;

    let movement: MovementRow['movement'] | null = null;
    if (sales.qtySold <= 0) movement = 'Non-moving';
    else if (monthsOfStock !== null && monthsOfStock >= 12) movement = 'Very slow';
    else if (monthsOfStock !== null && monthsOfStock >= 6) movement = 'Slow';
    if (!movement) continue;

    const row: MovementRow = {
      priority: getPriority(currentStock, stockMrpValue),
      movement,
      isbn: entry.isbn,
      title: entry.name,
      author: entry.author,
      publisher: entry.publisher,
      parentPublisher: entry.parentPublisher || '',
      distributor: getDistributorNames(catalog, entry),
      currentStock,
      unitsSold: sales.qtySold,
      salesRevenue: sales.revenue,
      observedDays,
      monthlySalesRate,
      monthsOfStock,
      mrp,
      stockMrpValue,
      createdOn: firstSeen ? formatDate(firstSeen) : '',
      ageGroup: entry.tagData?.ageGroup || '',
      tags: getTags(entry),
    };

    if (observedDays < MIN_DAYS_TO_JUDGE) recentRows.push(row);
    else reportRows.push(row);
  }

  const movementOrder = { 'Non-moving': 0, 'Very slow': 1, Slow: 2 } as const;
  const priorityOrder = { High: 0, Medium: 1, Low: 2 } as const;
  reportRows.sort((left, right) =>
    movementOrder[left.movement] - movementOrder[right.movement]
    || priorityOrder[left.priority] - priorityOrder[right.priority]
    || right.stockMrpValue - left.stockMrpValue
    || right.currentStock - left.currentStock
  );
  recentRows.sort((left, right) => right.stockMrpValue - left.stockMrpValue);

  const highPriority = reportRows.filter(row => row.priority === 'High');
  const highPriorityMrpValue = highPriority.reduce((sum, row) => sum + row.stockMrpValue, 0);
  const estimatedRecoverableCapital = highPriorityMrpValue * ESTIMATED_COST_SHARE_OF_MRP;
  const summaryFor = (movement: MovementRow['movement']) => {
    const rows = reportRows.filter(row => row.movement === movement);
    return {
      movement,
      titles: rows.length,
      units: rows.reduce((sum, row) => sum + row.currentStock, 0),
      value: rows.reduce((sum, row) => sum + row.stockMrpValue, 0),
    };
  };
  const summary = ['Non-moving', 'Very slow', 'Slow'].map(movement =>
    summaryFor(movement as MovementRow['movement'])
  );

  const summaryRows: Array<Record<string, string | number>> = [
    { Metric: 'Inventory snapshot', Value: path.basename(paths.inventoryPath) },
    { Metric: 'Sales period', Value: period.label },
    { Metric: 'Minimum observation period', Value: `${MIN_DAYS_TO_JUDGE} days` },
    { Metric: 'Bulk-return exclusion', Value: `Titles with ${IGNORE_STOCK_AT_OR_ABOVE} or more units are ignored` },
    { Metric: 'Ignored bulk-return titles / units / MRP value', Value: `${ignoredBulkTitles} / ${ignoredBulkUnits} / INR ${Math.round(ignoredBulkMrpValue).toLocaleString('en-IN')}` },
    { Metric: 'Non-moving definition', Value: 'In stock, observed for at least 60 days, zero units sold' },
    { Metric: 'Very slow definition', Value: 'At least 12 months of stock at observed sales rate' },
    { Metric: 'Slow definition', Value: '6 to under 12 months of stock at observed sales rate' },
    { Metric: 'High priority definition', Value: 'At least 5 copies or at least INR 3,000 stock MRP value' },
    { Metric: 'High-priority titles', Value: highPriority.length },
    { Metric: 'High-priority stock MRP value', Value: `INR ${Math.round(highPriorityMrpValue).toLocaleString('en-IN')}` },
    { Metric: 'Estimated capital tied up at 70% of MRP', Value: `INR ${Math.round(estimatedRecoverableCapital).toLocaleString('en-IN')}` },
    { Metric: 'Too new to judge', Value: recentRows.length },
    ...summary.map(item => ({
      Metric: `${item.movement} titles / units / MRP value`,
      Value: `${item.titles} / ${item.units} / INR ${Math.round(item.value).toLocaleString('en-IN')}`,
    })),
  ];

  const outputStem = `slow-moving-books-${formatDate(period.end)}`;
  const xlsxPath = path.join(ROOT, 'data', `${outputStem}.xlsx`);
  const csvPath = path.join(ROOT, 'data', `${outputStem}.csv`);
  const priorityCsvPath = path.join(ROOT, 'data', `high-priority-${outputStem}.csv`);
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 42 }, { wch: 78 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  for (const [name, rows] of [
    ['Priority Action', highPriority],
    ['All Flagged', reportRows],
    ['Too New To Judge', recentRows],
  ] as const) {
    const sheet = XLSX.utils.json_to_sheet(toWorksheetRows(rows));
    setUsefulWidths(sheet);
    sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1:S1' };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }

  XLSX.writeFile(workbook, xlsxPath);
  fs.writeFileSync(csvPath, XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(toWorksheetRows(reportRows))));
  fs.writeFileSync(priorityCsvPath, XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(toWorksheetRows(highPriority))));

  console.log(`Sales period: ${period.label}`);
  for (const item of summary) {
    console.log(`${item.movement}: ${item.titles} titles, ${item.units} units, INR ${Math.round(item.value).toLocaleString('en-IN')} MRP value`);
  }
  console.log(`High priority: ${highPriority.length} titles`);
  console.log(`Ignored bulk returns: ${ignoredBulkTitles} titles, ${ignoredBulkUnits} units`);
  console.log(`High-priority stock MRP value: INR ${Math.round(highPriorityMrpValue).toLocaleString('en-IN')}`);
  console.log(`Estimated capital at 70% of MRP: INR ${Math.round(estimatedRecoverableCapital).toLocaleString('en-IN')}`);
  console.log(`Too new to judge: ${recentRows.length} titles`);
  console.log(`Saved: ${xlsxPath}`);
  console.log(`Saved: ${csvPath}`);
  console.log(`Saved: ${priorityCsvPath}`);
}

main();
