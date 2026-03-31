// Raw row from Inventory.xlsx
export interface RawInventoryItem {
  Name: string;
  Brand: string;
  'Sub Brand': string;
  Category: string;
  ItemCode: string;
  MRP: number;
  'Selling Price': number;
  Qty: number;
  [key: string]: unknown;
}

// Raw row from sales_by_product.xlsx
export interface RawSalesItem {
  'Sr.No': number;
  'Item Code': string;
  'Product Name': string;
  'Quantity Sold': number;
  UNIT: string;
  'Taxable Amount': number;
  'Averege Price': number; // misspelled in ERP
  Total: number;
}

// Cleaned inventory item
export interface InventoryItem {
  name: string;
  rawBrand: string;
  subBrand: string;
  publisher: string;
  category: string;
  isbn: string;
  mrp: number;
  sellingPrice: number;
  qty: number;
}

// Cleaned sales item
export interface SalesItem {
  isbn: string;
  name: string;
  qtySold: number;
  avgPrice: number;
  revenue: number;
}

// Joined item with analytics
export interface StockItem {
  isbn: string;
  name: string;
  rawBrand: string;
  subBrand: string;
  publisher: string;
  parentPublisher: string;
  category: string;
  currentStock: number;
  mrp: number;
  sellingPrice: number;
  qtySold: number;
  revenue: number;
  dailySalesRate: number;
  daysOfStock: number | null; // null = no sales data
  restockUrgency: 'critical' | 'warning' | 'healthy' | 'no-sales' | 'out-of-stock';
  suggestedReorder: number;
}

// Publisher group for the restock tab
export interface PublisherGroup {
  publisher: string;
  items: StockItem[];
  totalRevenue: number;
  titlesInStock: number;
  titlesSold: number;
  criticalCount: number;
  warningCount: number;
}

// Summary stats for the overview
export interface DashboardSummary {
  totalRevenue: number;
  unitsSold: number;
  activeTitles: number;
  needsRestock: number;
  outOfStockWithSales: number;
  inStockNoSales: number;   // titles with qty > 0 but no sales in the period
  datePeriod: string;
  totalInventoryItems: number;
  totalSalesItems: number;
}

// Stock health breakdown
export interface StockHealth {
  critical: number;
  warning: number;
  healthy: number;
  noSales: number;
  outOfStock: number;
}

// A group of items sharing the same raw Brand value that resolved to "Unknown Publisher"
export interface UnknownBrandGroup {
  rawBrand: string;
  subBrands: string[];
  itemCount: number;
  withSalesCount: number;
  totalRevenue: number;
  totalQtySold: number;
  totalStock: number;
  sampleTitles: string[];
}

// Data quality info
export interface DataQuality {
  unknownPublisherCount: number;
  unknownPublisherPct: number;
  negativeQtyCount: number;
  unmatchedSalesCount: number;
  unmatchedSalesItems: SalesItem[];
  zeroStockCount: number;
  unknownBrandGroups: UnknownBrandGroup[];
}

// Full processed dataset
export interface ProcessedData {
  items: StockItem[];
  summary: DashboardSummary;
  stockHealth: StockHealth;
  publisherGroups: PublisherGroup[];
  dataQuality: DataQuality;
  cleanupProgress: CleanupProgress;
  salesDateRange: string;
  daysInRange: number;
}

// Distributor info
export interface Distributor {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
}

// Publisher → Distributor assignment
export interface PublisherDistributorMapping {
  publisher: string;
  primaryDistributorId: string;
  secondaryDistributorId?: string;
}

// Progress stats for the cleanup workbench
export interface CleanupProgress {
  publisherCoverage: number;   // % of revenue-generating items with known publishers
  distributorCoverage: number; // % of known publishers with a distributor assigned
  totalRevenueItems: number;
  knownPublisherItems: number;
  totalKnownPublishers: number;
  assignedPublishers: number;
}
