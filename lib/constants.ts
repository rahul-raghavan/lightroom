// Stock level thresholds (in days of remaining stock)
export const CRITICAL_DAYS = 7;
export const WARNING_DAYS = 21;

// Reorder target: enough stock for this many days
export const REORDER_TARGET_DAYS = 30;

// Chart colors
export const COLORS = {
  critical: '#ef4444',    // red-500
  warning: '#f59e0b',     // amber-500
  healthy: '#22c55e',     // green-500
  noSales: '#94a3b8',     // slate-400
  outOfStock: '#1e293b',  // slate-800
  primary: '#3b82f6',     // blue-500
  secondary: '#8b5cf6',   // violet-500
  accent: '#06b6d4',      // cyan-500
};

// Number of items to show in various lists
export const TOP_SELLERS_CHART_COUNT = 20;
export const TOP_SELLERS_TABLE_COUNT = 50;
