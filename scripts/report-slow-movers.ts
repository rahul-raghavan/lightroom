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
const OPENING_INVENTORY_PATH = path.join(ROOT, 'erp-data', 'archive', 'Inventory - 30 Mar.xlsx');
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
  recommendedReturnQty: number;
  estimatedReturnCredit: number;
  returnReason: string;
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
    const rawQty = Number(row['Quantity Sold']) || 0;
    const nearestWholeQty = Math.round(rawQty);
    current.qtySold += Math.abs(rawQty - nearestWholeQty) <= 0.05 ? nearestWholeQty : rawQty;
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

function readInventoryQuantities(filePath: string): Map<string, number> {
  if (!fs.existsSync(filePath)) return new Map();
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const quantities = new Map<string, number>();

  for (const row of rows) {
    const isbn = String(row.ItemCode || '').trim();
    const category = String(row.Category || '').trim();
    const qty = Number(row.Qty) || 0;
    if (!isbn || isSecondHandCategory(category) || qty < 0) continue;
    quantities.set(isbn, (quantities.get(isbn) || 0) + qty);
  }

  return quantities;
}

function isBarefootConsignment(entry: CatalogEntry): boolean {
  return [entry.publisher, entry.parentPublisher, entry.rawBrand]
    .some(value => /^(barefoot|barefoot books)$/i.test(String(value || '').trim()));
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

function getReturnRecommendation(row: MovementRow): Pick<
  MovementRow,
  'recommendedReturnQty' | 'estimatedReturnCredit' | 'returnReason'
> {
  let targetStock = row.currentStock;
  let returnReason = '';

  if (row.movement === 'Non-moving' && row.currentStock > 1) {
    targetStock = 1;
    returnReason = 'No sales in at least 60 days; retain one curated/display copy';
  } else if (row.movement === 'Very slow') {
    targetStock = Math.max(1, Math.ceil(row.monthlySalesRate * 6));
    returnReason = 'More than 12 months of stock; reduce to about 6 months of demand';
  } else if (row.movement === 'Slow' && row.priority === 'High') {
    targetStock = Math.max(1, Math.ceil(row.monthlySalesRate * 4));
    returnReason = 'High-value exposure with 6-12 months of stock; reduce to about 4 months';
  }

  const recommendedReturnQty = Math.max(0, row.currentStock - targetStock);
  return {
    recommendedReturnQty,
    estimatedReturnCredit: recommendedReturnQty * row.mrp * ESTIMATED_COST_SHARE_OF_MRP,
    returnReason: recommendedReturnQty > 0 ? returnReason : 'Review only; no excess copy recommended for automatic return',
  };
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
    'Recommended Return Qty': row.recommendedReturnQty,
    'Estimated Return Credit': Number(row.estimatedReturnCredit.toFixed(2)),
    'Return Rationale': row.returnReason,
  }));
}

function setUsefulWidths(sheet: XLSX.WorkSheet): void {
  sheet['!cols'] = [
    { wch: 10 }, { wch: 14 }, { wch: 15 }, { wch: 42 }, { wch: 24 },
    { wch: 26 }, { wch: 24 }, { wch: 22 }, { wch: 14 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 10 },
    { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 55 },
    { wch: 22 }, { wch: 24 }, { wch: 62 },
  ];
}

function percent(value: number): number {
  return Number((value * 100).toFixed(1));
}

function concentrationShare(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => right - left);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || sorted.length === 0) return 0;
  const take = Math.max(1, Math.ceil(sorted.length * fraction));
  return sorted.slice(0, take).reduce((sum, value) => sum + value, 0) / total;
}

function titlesForShare(values: number[], targetShare: number): number {
  const sorted = [...values].sort((left, right) => right - left);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  let running = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    running += sorted[index];
    if (running / total >= targetShare) return index + 1;
  }
  return sorted.length;
}

function main(): void {
  if (!fs.existsSync(CATALOG_PATH)) throw new Error('Catalog not found. Run npm run build-catalog first.');

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')) as MasterCatalog;
  const paths = resolveCatalogSourcePaths(ROOT);
  const { period, totals } = readSales(paths.salesPath);
  const firstSeenDates = readFirstSeenDates(paths.inventoryPath);
  const openingQuantities = readInventoryQuantities(OPENING_INVENTORY_PATH);
  const reportRows: MovementRow[] = [];
  const recentRows: MovementRow[] = [];
  const eligibleEntries = Object.values(catalog.entries).filter(entry =>
    entry.scope === 'book'
    && !isBarefootConsignment(entry)
    && (Number(entry.currentStock) || 0) < IGNORE_STOCK_AT_OR_ABOVE
  );
  const eligibleByIsbn = new Map(eligibleEntries.map(entry => [entry.isbn, entry]));
  let ignoredConsignmentTitles = 0;
  let ignoredConsignmentUnits = 0;
  let ignoredConsignmentMrpValue = 0;
  let ignoredBulkTitles = 0;
  let ignoredBulkUnits = 0;
  let ignoredBulkMrpValue = 0;

  for (const entry of Object.values(catalog.entries)) {
    const currentStock = Number(entry.currentStock) || 0;
    if (entry.scope !== 'book' || currentStock <= 0) continue;

    if (isBarefootConsignment(entry)) {
      const mrp = Number(entry.mrp) || Number(entry.sellingPrice) || 0;
      ignoredConsignmentTitles += 1;
      ignoredConsignmentUnits += currentStock;
      ignoredConsignmentMrpValue += currentStock * mrp;
      continue;
    }

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
      recommendedReturnQty: 0,
      estimatedReturnCredit: 0,
      returnReason: '',
    };
    Object.assign(row, getReturnRecommendation(row));

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
  const recommendedReturns = reportRows
    .filter(row => row.recommendedReturnQty > 0)
    .sort((left, right) =>
      right.estimatedReturnCredit - left.estimatedReturnCredit
      || right.recommendedReturnQty - left.recommendedReturnQty
    );
  const allVerySlow = reportRows.filter(row => row.movement === 'Very slow');
  const highPriorityMrpValue = highPriority.reduce((sum, row) => sum + row.stockMrpValue, 0);
  const estimatedRecoverableCapital = highPriorityMrpValue * ESTIMATED_COST_SHARE_OF_MRP;
  const recommendedReturnUnits = recommendedReturns.reduce((sum, row) => sum + row.recommendedReturnQty, 0);
  const recommendedReturnCredit = recommendedReturns.reduce((sum, row) => sum + row.estimatedReturnCredit, 0);
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

  const periodDays = Math.max(1, Math.round((period.end.getTime() - period.start.getTime()) / 86_400_000) + 1);
  const inStockEntries = eligibleEntries.filter(entry => (Number(entry.currentStock) || 0) > 0);
  const matureInStockEntries = inStockEntries.filter(entry => {
    const firstSeen = firstSeenDates.get(entry.isbn);
    const observedStart = firstSeen && firstSeen > period.start ? firstSeen : period.start;
    return Math.round((period.end.getTime() - observedStart.getTime()) / 86_400_000) + 1 >= MIN_DAYS_TO_JUDGE;
  });
  const matureZeroSaleEntries = matureInStockEntries.filter(entry => (totals.get(entry.isbn)?.qtySold || 0) <= 0);
  const soldTitleRows = [...totals.entries()]
    .filter(([isbn, sales]) => eligibleByIsbn.has(isbn) && sales.qtySold > 0)
    .map(([, sales]) => sales);
  const soldUnits = soldTitleRows.reduce((sum, sales) => sum + sales.qtySold, 0);
  const salesRevenue = soldTitleRows.reduce((sum, sales) => sum + sales.revenue, 0);
  const salesRevenueByTitle = soldTitleRows.map(sales => sales.revenue);
  const unitsBySoldTitle = soldTitleRows.map(sales => sales.qtySold).sort((left, right) => left - right);
  const medianUnitsPerSellingTitle = unitsBySoldTitle.length === 0
    ? 0
    : unitsBySoldTitle[Math.floor(unitsBySoldTitle.length / 2)];
  const currentUnits = inStockEntries.reduce((sum, entry) => sum + (Number(entry.currentStock) || 0), 0);
  const openingUnits = eligibleEntries.reduce((sum, entry) => sum + (openingQuantities.get(entry.isbn) || 0), 0);
  const currentMrpValue = inStockEntries.reduce((sum, entry) => {
    const mrp = Number(entry.mrp) || Number(entry.sellingPrice) || 0;
    return sum + (Number(entry.currentStock) || 0) * mrp;
  }, 0);
  const openingMrpValue = eligibleEntries.reduce((sum, entry) => {
    const mrp = Number(entry.mrp) || Number(entry.sellingPrice) || 0;
    return sum + (openingQuantities.get(entry.isbn) || 0) * mrp;
  }, 0);
  const averageUnits = (openingUnits + currentUnits) / 2;
  const averageMrpValue = (openingMrpValue + currentMrpValue) / 2;
  const annualizedUnitTurn = averageUnits > 0 ? (soldUnits / averageUnits) * (365.25 / periodDays) : 0;
  const annualizedValueTurn = averageMrpValue > 0 ? (salesRevenue / averageMrpValue) * (365.25 / periodDays) : 0;
  const currentSellThrough = soldUnits + currentUnits > 0 ? soldUnits / (soldUnits + currentUnits) : 0;
  const titlesGenerating80Percent = titlesForShare(salesRevenueByTitle, 0.8);
  const top20RevenueShare = concentrationShare(salesRevenueByTitle, 0.2);
  const benchmarkUrl = 'https://booknetcanada.ca/blog/2024/8/20/easier-with-booknet-managing-inventory-and-understanding-stock-turn/';

  const distributionRows: Array<Record<string, string | number>> = [];
  const addDistribution = (
    section: string,
    bands: Array<{ label: string; matches: (entry: CatalogEntry) => boolean }>,
  ) => {
    for (const band of bands) {
      const entries = matureInStockEntries.filter(band.matches);
      distributionRows.push({
        Section: section,
        Band: band.label,
        Titles: entries.length,
        'Share of Titles': entries.length / Math.max(1, matureInStockEntries.length),
        'Current Units': entries.reduce((sum, entry) => sum + (Number(entry.currentStock) || 0), 0),
        'Current MRP Value': Math.round(entries.reduce((sum, entry) => {
          const mrp = Number(entry.mrp) || Number(entry.sellingPrice) || 0;
          return sum + (Number(entry.currentStock) || 0) * mrp;
        }, 0)),
      });
    }
  };
  addDistribution('Sales per title during period', [
    { label: '0 copies', matches: entry => (totals.get(entry.isbn)?.qtySold || 0) <= 0 },
    { label: '1 copy', matches: entry => (totals.get(entry.isbn)?.qtySold || 0) === 1 },
    { label: '2 copies', matches: entry => (totals.get(entry.isbn)?.qtySold || 0) === 2 },
    { label: '3-5 copies', matches: entry => (totals.get(entry.isbn)?.qtySold || 0) >= 3 && (totals.get(entry.isbn)?.qtySold || 0) <= 5 },
    { label: '6-10 copies', matches: entry => (totals.get(entry.isbn)?.qtySold || 0) >= 6 && (totals.get(entry.isbn)?.qtySold || 0) <= 10 },
    { label: '11+ copies', matches: entry => (totals.get(entry.isbn)?.qtySold || 0) >= 11 },
  ]);
  addDistribution('Current stock per title', [
    { label: '1 copy', matches: entry => (Number(entry.currentStock) || 0) === 1 },
    { label: '2 copies', matches: entry => (Number(entry.currentStock) || 0) === 2 },
    { label: '3-4 copies', matches: entry => (Number(entry.currentStock) || 0) >= 3 && (Number(entry.currentStock) || 0) <= 4 },
    { label: '5-9 copies', matches: entry => (Number(entry.currentStock) || 0) >= 5 && (Number(entry.currentStock) || 0) <= 9 },
    { label: '10-19 copies', matches: entry => (Number(entry.currentStock) || 0) >= 10 && (Number(entry.currentStock) || 0) <= 19 },
    { label: '20-39 copies', matches: entry => (Number(entry.currentStock) || 0) >= 20 && (Number(entry.currentStock) || 0) <= 39 },
  ]);

  const assessmentRows: Array<Record<string, string | number>> = [
    { Metric: 'Analysis scope', Value: 'Purchased books below 40 units; Barefoot Books consignment excluded', Source: 'Current catalog rules' },
    { Metric: 'Sales period', Value: period.label, Source: path.basename(paths.salesPath) },
    { Metric: 'In-stock titles', Value: inStockEntries.length, Source: path.basename(paths.inventoryPath) },
    { Metric: 'Current stock units', Value: currentUnits, Source: path.basename(paths.inventoryPath) },
    { Metric: 'Current stock MRP value', Value: Math.round(currentMrpValue), Source: path.basename(paths.inventoryPath) },
    { Metric: 'Estimated capital in current stock (70% MRP)', Value: Math.round(currentMrpValue * ESTIMATED_COST_SHARE_OF_MRP), Source: 'Assumption supplied by user' },
    { Metric: 'Titles selling during period', Value: soldTitleRows.length, Source: path.basename(paths.salesPath) },
    { Metric: 'Units sold during period', Value: soldUnits, Source: path.basename(paths.salesPath) },
    { Metric: 'Sales revenue during period', Value: Math.round(salesRevenue), Source: path.basename(paths.salesPath) },
    { Metric: 'Mature in-stock titles with zero sales', Value: matureZeroSaleEntries.length, Source: `At least ${MIN_DAYS_TO_JUDGE} observed days` },
    { Metric: 'Share of mature in-stock titles with zero sales', Value: percent(matureZeroSaleEntries.length / Math.max(1, matureInStockEntries.length)) / 100, Source: `At least ${MIN_DAYS_TO_JUDGE} observed days` },
    { Metric: 'Median units sold per selling title', Value: medianUnitsPerSellingTitle, Source: path.basename(paths.salesPath) },
    { Metric: 'Top 20% of selling titles - share of revenue', Value: percent(top20RevenueShare) / 100, Source: path.basename(paths.salesPath) },
    { Metric: 'Titles generating 80% of revenue', Value: titlesGenerating80Percent, Source: path.basename(paths.salesPath) },
    { Metric: 'Share of selling titles generating 80% of revenue', Value: percent(titlesGenerating80Percent / Math.max(1, soldTitleRows.length)) / 100, Source: path.basename(paths.salesPath) },
    { Metric: 'Period sell-through (units)', Value: percent(currentSellThrough) / 100, Source: 'Units sold / (units sold + ending units)' },
    { Metric: 'Annualized stock turn - units', Value: Number(annualizedUnitTurn.toFixed(2)), Source: 'Opening/ending average inventory' },
    { Metric: 'Annualized stock turn - value', Value: Number(annualizedValueTurn.toFixed(2)), Source: 'Sales revenue / opening/ending average MRP inventory' },
    { Metric: 'Healthy bookstore annual stock-turn range', Value: '2.5x-5.0x', Source: benchmarkUrl },
    { Metric: 'Recommended return titles', Value: recommendedReturns.length, Source: 'Rule-based recommendation' },
    { Metric: 'Recommended return units', Value: recommendedReturnUnits, Source: 'Rule-based recommendation' },
    { Metric: 'Estimated return credit (70% MRP)', Value: Math.round(recommendedReturnCredit), Source: 'Assumption supplied by user' },
  ];

  const summaryRows: Array<Record<string, string | number>> = [
    { Metric: 'Inventory snapshot', Value: path.basename(paths.inventoryPath) },
    { Metric: 'Sales period', Value: period.label },
    { Metric: 'Minimum observation period', Value: `${MIN_DAYS_TO_JUDGE} days` },
    { Metric: 'Consignment exclusion', Value: 'Barefoot Books and Barefoot publisher values are ignored' },
    { Metric: 'Ignored Barefoot titles / units / MRP value', Value: `${ignoredConsignmentTitles} / ${ignoredConsignmentUnits} / INR ${Math.round(ignoredConsignmentMrpValue).toLocaleString('en-IN')}` },
    { Metric: 'Bulk-return exclusion', Value: `Titles with ${IGNORE_STOCK_AT_OR_ABOVE} or more units are ignored` },
    { Metric: 'Ignored bulk-return titles / units / MRP value', Value: `${ignoredBulkTitles} / ${ignoredBulkUnits} / INR ${Math.round(ignoredBulkMrpValue).toLocaleString('en-IN')}` },
    { Metric: 'Non-moving definition', Value: 'In stock, observed for at least 60 days, zero units sold' },
    { Metric: 'Very slow definition', Value: 'At least 12 months of stock at observed sales rate' },
    { Metric: 'Slow definition', Value: '6 to under 12 months of stock at observed sales rate' },
    { Metric: 'High priority definition', Value: 'At least 5 copies or at least INR 3,000 stock MRP value' },
    { Metric: 'High-priority titles', Value: highPriority.length },
    { Metric: 'High-priority stock MRP value', Value: `INR ${Math.round(highPriorityMrpValue).toLocaleString('en-IN')}` },
    { Metric: 'Estimated capital tied up at 70% of MRP', Value: `INR ${Math.round(estimatedRecoverableCapital).toLocaleString('en-IN')}` },
    { Metric: 'Recommended return titles / units', Value: `${recommendedReturns.length} / ${recommendedReturnUnits}` },
    { Metric: 'Estimated credit from recommended quantities', Value: `INR ${Math.round(recommendedReturnCredit).toLocaleString('en-IN')}` },
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
  const returnsCsvPath = path.join(ROOT, 'data', `recommended-returns-${formatDate(period.end)}.csv`);
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 42 }, { wch: 78 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  const assessmentSheet = XLSX.utils.json_to_sheet(assessmentRows);
  assessmentSheet['!cols'] = [{ wch: 48 }, { wch: 24 }, { wch: 92 }];
  for (const cellAddress of ['B12', 'B14', 'B16', 'B17']) {
    if (assessmentSheet[cellAddress]) assessmentSheet[cellAddress].z = '0.0%';
  }
  XLSX.utils.book_append_sheet(workbook, assessmentSheet, 'Stocking Assessment');

  const distributionSheet = XLSX.utils.json_to_sheet(distributionRows);
  distributionSheet['!cols'] = [
    { wch: 32 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 22 },
  ];
  for (let row = 2; row <= distributionRows.length + 1; row += 1) {
    if (distributionSheet[`D${row}`]) distributionSheet[`D${row}`].z = '0.0%';
  }
  distributionSheet['!autofilter'] = { ref: distributionSheet['!ref'] || 'A1:F1' };
  XLSX.utils.book_append_sheet(workbook, distributionSheet, 'Stock and Sales Mix');

  for (const [name, rows] of [
    ['Recommended Returns', recommendedReturns],
    ['Priority Action', highPriority],
    ['All Very Slow', allVerySlow],
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
  fs.writeFileSync(returnsCsvPath, XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(toWorksheetRows(recommendedReturns))));

  console.log(`Sales period: ${period.label}`);
  for (const item of summary) {
    console.log(`${item.movement}: ${item.titles} titles, ${item.units} units, INR ${Math.round(item.value).toLocaleString('en-IN')} MRP value`);
  }
  console.log(`High priority: ${highPriority.length} titles`);
  console.log(`Recommended returns: ${recommendedReturns.length} titles, ${recommendedReturnUnits} units`);
  console.log(`Estimated recommended-return credit: INR ${Math.round(recommendedReturnCredit).toLocaleString('en-IN')}`);
  console.log(`Ignored Barefoot consignment: ${ignoredConsignmentTitles} titles, ${ignoredConsignmentUnits} units`);
  console.log(`Ignored bulk returns: ${ignoredBulkTitles} titles, ${ignoredBulkUnits} units`);
  console.log(`Annualized stock turn: ${annualizedUnitTurn.toFixed(2)}x units, ${annualizedValueTurn.toFixed(2)}x value`);
  console.log(`Mature in-stock titles with zero sales: ${matureZeroSaleEntries.length}/${matureInStockEntries.length}`);
  console.log(`Top 20% selling-title revenue share: ${percent(top20RevenueShare)}%`);
  console.log(`High-priority stock MRP value: INR ${Math.round(highPriorityMrpValue).toLocaleString('en-IN')}`);
  console.log(`Estimated capital at 70% of MRP: INR ${Math.round(estimatedRecoverableCapital).toLocaleString('en-IN')}`);
  console.log(`Too new to judge: ${recentRows.length} titles`);
  console.log(`Saved: ${xlsxPath}`);
  console.log(`Saved: ${csvPath}`);
  console.log(`Saved: ${priorityCsvPath}`);
  console.log(`Saved: ${returnsCsvPath}`);
}

main();
