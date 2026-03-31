import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import { StockItem, PublisherGroup, Distributor, PublisherDistributorMapping } from './types';

function escapeCSV(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function stockItemToRow(item: StockItem): string {
  return [
    escapeCSV(item.isbn),
    escapeCSV(item.name),
    escapeCSV(item.publisher),
    item.currentStock,
    item.qtySold,
    item.dailySalesRate.toFixed(2),
    item.daysOfStock !== null ? Math.round(item.daysOfStock) : 'N/A',
    item.suggestedReorder,
    item.restockUrgency,
  ].join(',');
}

const CSV_HEADER = 'ISBN,Title,Publisher,Current Stock,Qty Sold,Daily Sales Rate,Days of Stock,Suggested Reorder,Urgency';

export function exportPublisherCSV(group: PublisherGroup): void {
  const rows = [CSV_HEADER, ...group.items.map(stockItemToRow)];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const filename = `restock-${group.publisher.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.csv`;
  saveAs(blob, filename);
}

export function exportAllRestockCSV(groups: PublisherGroup[]): void {
  const rows = [CSV_HEADER];
  for (const group of groups) {
    for (const item of group.items) {
      rows.push(stockItemToRow(item));
    }
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, 'restock-all-publishers.csv');
}

export function exportTopSellersCSV(items: StockItem[]): void {
  const header = 'Rank,ISBN,Title,Publisher,Qty Sold,Revenue,Current Stock,Days of Stock';
  const rows = [header];
  items.forEach((item, index) => {
    rows.push([
      index + 1,
      escapeCSV(item.isbn),
      escapeCSV(item.name),
      escapeCSV(item.publisher),
      item.qtySold,
      item.revenue.toFixed(2),
      item.currentStock,
      item.daysOfStock !== null ? Math.round(item.daysOfStock) : 'N/A',
    ].join(','));
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, 'top-sellers.csv');
}

/**
 * Export cleaned inventory as an Excel file.
 * Same structure as the original Inventory.xlsx but with the Brand column
 * updated to the cleaned publisher name (parentPublisher).
 */
export function exportCleanedInventoryExcel(items: StockItem[]): void {
  const rows = items.map(item => ({
    'ItemCode': item.isbn,
    'Name': item.name,
    'Brand': item.parentPublisher,
    'Category': item.category,
    'MRP': item.mrp,
    'Selling Price': item.sellingPrice,
    'Qty': item.currentStock,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, 'cleaned-inventory.xlsx');
}

/**
 * Export a CSV mapping publishers to their assigned distributors.
 */
export function exportDistributorReport(
  items: StockItem[],
  distributors: Distributor[],
  mappings: PublisherDistributorMapping[]
): void {
  // Build distributor lookup
  const distLookup = new Map<string, string>();
  for (const d of distributors) {
    distLookup.set(d.id, d.name);
  }

  // Build publisher stats
  const pubStats = new Map<string, { count: number; revenue: number }>();
  for (const item of items) {
    if (item.parentPublisher === 'Unknown Publisher') continue;
    const existing = pubStats.get(item.parentPublisher) || { count: 0, revenue: 0 };
    existing.count++;
    existing.revenue += item.revenue;
    pubStats.set(item.parentPublisher, existing);
  }

  const header = 'Publisher,Items,Revenue,Primary Distributor,Secondary Distributor';
  const rows = [header];

  // Build mapping lookup
  const mapLookup = new Map<string, PublisherDistributorMapping>();
  for (const m of mappings) {
    mapLookup.set(m.publisher, m);
  }

  // Sort publishers by revenue
  const sortedPubs = Array.from(pubStats.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue);

  for (const [publisher, stats] of sortedPubs) {
    const mapping = mapLookup.get(publisher);
    const primary = mapping?.primaryDistributorId ? (distLookup.get(mapping.primaryDistributorId) || '') : '';
    const secondary = mapping?.secondaryDistributorId ? (distLookup.get(mapping.secondaryDistributorId) || '') : '';
    rows.push([
      escapeCSV(publisher),
      stats.count,
      stats.revenue.toFixed(2),
      escapeCSV(primary),
      escapeCSV(secondary),
    ].join(','));
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, 'publisher-distributor-map.csv');
}
