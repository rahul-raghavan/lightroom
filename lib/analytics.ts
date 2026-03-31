import {
  InventoryItem,
  SalesItem,
  StockItem,
  PublisherGroup,
  DashboardSummary,
  StockHealth,
  DataQuality,
  ProcessedData,
  UnknownBrandGroup,
  CleanupProgress,
} from './types';
import { CRITICAL_DAYS, WARNING_DAYS, REORDER_TARGET_DAYS } from './constants';
import { resolveParentPublisher } from './consolidation';

function getRestockUrgency(
  daysOfStock: number | null,
  currentStock: number,
  qtySold: number
): StockItem['restockUrgency'] {
  if (currentStock === 0 && qtySold > 0) return 'out-of-stock';
  if (qtySold === 0 || daysOfStock === null) return 'no-sales';
  if (daysOfStock < CRITICAL_DAYS) return 'critical';
  if (daysOfStock < WARNING_DAYS) return 'warning';
  return 'healthy';
}

export function processData(
  inventory: InventoryItem[],
  sales: SalesItem[],
  daysInRange: number,
  dateRange: string,
  consolidations?: Record<string, string>
): ProcessedData {
  // Build a lookup from inventory by ISBN
  const inventoryMap = new Map<string, InventoryItem>();
  for (const item of inventory) {
    inventoryMap.set(item.isbn, item);
  }

  // Build a lookup from sales by ISBN
  const salesMap = new Map<string, SalesItem>();
  for (const item of sales) {
    salesMap.set(item.isbn, item);
  }

  // Join: start with all inventory items, augment with sales data
  const items: StockItem[] = [];
  const unmatchedSalesItems: SalesItem[] = [];

  // Resolve consolidations
  const userConsolidations = consolidations || {};

  // Process all inventory items
  for (const inv of inventory) {
    const sale = salesMap.get(inv.isbn);
    const qtySold = sale?.qtySold || 0;
    const revenue = sale?.revenue || 0;
    const dailySalesRate = daysInRange > 0 ? qtySold / daysInRange : 0;
    const daysOfStock = dailySalesRate > 0 ? inv.qty / dailySalesRate : null;
    const suggestedReorder = dailySalesRate > 0
      ? Math.max(0, Math.ceil(dailySalesRate * REORDER_TARGET_DAYS - inv.qty))
      : 0;

    const parentPublisher = inv.publisher !== 'Unknown Publisher'
      ? resolveParentPublisher(inv.publisher, userConsolidations)
      : 'Unknown Publisher';

    items.push({
      isbn: inv.isbn,
      name: inv.name || sale?.name || '',
      rawBrand: inv.rawBrand,
      subBrand: inv.subBrand,
      publisher: inv.publisher,
      parentPublisher,
      category: inv.category,
      currentStock: inv.qty,
      mrp: inv.mrp,
      sellingPrice: inv.sellingPrice,
      qtySold,
      revenue,
      dailySalesRate,
      daysOfStock,
      restockUrgency: getRestockUrgency(daysOfStock, inv.qty, qtySold),
      suggestedReorder,
    });
  }

  // Find sales items not in inventory
  for (const sale of sales) {
    if (!inventoryMap.has(sale.isbn)) {
      unmatchedSalesItems.push(sale);
    }
  }

  // Compute summary
  const soldItems = items.filter(i => i.qtySold > 0);
  const needsRestock = items.filter(
    i => i.restockUrgency === 'critical' || i.restockUrgency === 'warning'
  );
  const outOfStockWithSales = items.filter(i => i.restockUrgency === 'out-of-stock');
  // Titles where we have stock (qty > 0) but there were no sales in the period
  const inStockNoSales = items.filter(i => i.currentStock > 0 && i.qtySold === 0);

  const summary: DashboardSummary = {
    totalRevenue: sales.reduce((sum, s) => sum + s.revenue, 0),
    unitsSold: sales.reduce((sum, s) => sum + s.qtySold, 0),
    activeTitles: soldItems.length,
    needsRestock: needsRestock.length,
    outOfStockWithSales: outOfStockWithSales.length,
    inStockNoSales: inStockNoSales.length,
    datePeriod: dateRange,
    totalInventoryItems: inventory.length,
    totalSalesItems: sales.length,
  };

  // Stock health
  const stockHealth: StockHealth = {
    critical: items.filter(i => i.restockUrgency === 'critical').length,
    warning: items.filter(i => i.restockUrgency === 'warning').length,
    healthy: items.filter(i => i.restockUrgency === 'healthy').length,
    noSales: items.filter(i => i.restockUrgency === 'no-sales').length,
    outOfStock: outOfStockWithSales.length,
  };

  // Publisher groups (only items that have sales or need restocking)
  // Group by parentPublisher so consolidated imprints appear together
  const publisherMap = new Map<string, StockItem[]>();
  for (const item of items) {
    // Include items that have sales data OR are out of stock with sales
    if (item.qtySold > 0 || item.restockUrgency === 'out-of-stock') {
      const groupKey = item.parentPublisher;
      const existing = publisherMap.get(groupKey) || [];
      existing.push(item);
      publisherMap.set(groupKey, existing);
    }
  }

  const publisherGroups: PublisherGroup[] = Array.from(publisherMap.entries())
    .map(([publisher, pubItems]) => ({
      publisher,
      items: pubItems.sort((a, b) => {
        // Sort by urgency first (critical > warning > out-of-stock > healthy > no-sales)
        const urgencyOrder = { 'out-of-stock': 0, critical: 1, warning: 2, healthy: 3, 'no-sales': 4 };
        const urgencyDiff = urgencyOrder[a.restockUrgency] - urgencyOrder[b.restockUrgency];
        if (urgencyDiff !== 0) return urgencyDiff;
        // Then by quantity sold (descending)
        return b.qtySold - a.qtySold;
      }),
      totalRevenue: pubItems.reduce((sum, i) => sum + i.revenue, 0),
      titlesInStock: pubItems.filter(i => i.currentStock > 0).length,
      titlesSold: pubItems.filter(i => i.qtySold > 0).length,
      criticalCount: pubItems.filter(
        i => i.restockUrgency === 'critical' || i.restockUrgency === 'out-of-stock'
      ).length,
      warningCount: pubItems.filter(i => i.restockUrgency === 'warning').length,
    }))
    .sort((a, b) => {
      // "Unknown Publisher" always last
      if (a.publisher === 'Unknown Publisher') return 1;
      if (b.publisher === 'Unknown Publisher') return -1;
      // Then by critical count (descending), then by revenue (descending)
      if (b.criticalCount !== a.criticalCount) return b.criticalCount - a.criticalCount;
      return b.totalRevenue - a.totalRevenue;
    });

  // Data quality
  const unknownPubItems = inventory.filter(i => i.publisher === 'Unknown Publisher');

  // Group unknown-publisher items by rawBrand for the Publisher Fixer
  const unknownBrandMap = new Map<string, {
    items: StockItem[];
  }>();
  for (const item of items) {
    if (item.publisher === 'Unknown Publisher' && item.rawBrand) {
      const existing = unknownBrandMap.get(item.rawBrand);
      if (existing) {
        existing.items.push(item);
      } else {
        unknownBrandMap.set(item.rawBrand, { items: [item] });
      }
    }
  }

  const unknownBrandGroups: UnknownBrandGroup[] = Array.from(unknownBrandMap.entries())
    .map(([rawBrand, { items: groupItems }]) => {
      // Collect unique non-empty sub-brands as hints
      const subBrandSet = new Set<string>();
      for (const item of groupItems) {
        if (item.subBrand && item.subBrand !== rawBrand) {
          subBrandSet.add(item.subBrand);
        }
      }
      return {
        rawBrand,
        subBrands: Array.from(subBrandSet).slice(0, 3),
        itemCount: groupItems.length,
        withSalesCount: groupItems.filter(i => i.qtySold > 0).length,
        totalRevenue: groupItems.reduce((sum, i) => sum + i.revenue, 0),
        totalQtySold: groupItems.reduce((sum, i) => sum + i.qtySold, 0),
        totalStock: groupItems.reduce((sum, i) => sum + i.currentStock, 0),
        sampleTitles: groupItems
          .filter(i => i.name)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 3)
          .map(i => i.name),
      };
    })
    .sort((a, b) => {
      // Has sales first
      const aHasSales = a.withSalesCount > 0 ? 1 : 0;
      const bHasSales = b.withSalesCount > 0 ? 1 : 0;
      if (bHasSales !== aHasSales) return bHasSales - aHasSales;
      // Then by revenue desc
      if (b.totalRevenue !== a.totalRevenue) return b.totalRevenue - a.totalRevenue;
      // Then by stock desc
      if (b.totalStock !== a.totalStock) return b.totalStock - a.totalStock;
      // Then by item count desc
      return b.itemCount - a.itemCount;
    });

  const dataQuality: DataQuality = {
    unknownPublisherCount: unknownPubItems.length,
    unknownPublisherPct: inventory.length > 0 ? (unknownPubItems.length / inventory.length) * 100 : 0,
    negativeQtyCount: 0, // This is counted during parsing, not here
    unmatchedSalesCount: unmatchedSalesItems.length,
    unmatchedSalesItems,
    zeroStockCount: inventory.filter(i => i.qty === 0).length,
    unknownBrandGroups,
  };

  // Cleanup progress
  const revenueItems = items.filter(i => i.qtySold > 0);
  const knownPublisherItems = revenueItems.filter(i => i.publisher !== 'Unknown Publisher');
  const allKnownPublishers = new Set(
    items.filter(i => i.parentPublisher !== 'Unknown Publisher').map(i => i.parentPublisher)
  );

  const cleanupProgress: CleanupProgress = {
    publisherCoverage: revenueItems.length > 0
      ? (knownPublisherItems.length / revenueItems.length) * 100
      : 100,
    distributorCoverage: 0, // computed in the UI with distributor data
    totalRevenueItems: revenueItems.length,
    knownPublisherItems: knownPublisherItems.length,
    totalKnownPublishers: allKnownPublishers.size,
    assignedPublishers: 0, // computed in the UI with distributor data
  };

  return {
    items,
    summary,
    stockHealth,
    publisherGroups,
    dataQuality,
    cleanupProgress,
    salesDateRange: dateRange,
    daysInRange,
  };
}
