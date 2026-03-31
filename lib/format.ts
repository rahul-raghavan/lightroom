// Indian number formatting utilities

/**
 * Format a number as Indian Rupees (₹1,23,456)
 */
export function formatRupees(amount: number): string {
  if (amount >= 100000) {
    // Show in lakhs for large numbers
    const lakhs = amount / 100000;
    if (lakhs >= 10) {
      return `₹${lakhs.toFixed(1)}L`;
    }
    return `₹${lakhs.toFixed(2)}L`;
  }
  // Indian number system grouping
  return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/**
 * Format a number as Indian Rupees with full precision
 */
export function formatRupeesFull(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/**
 * Format a large number with Indian grouping
 */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-IN');
}

/**
 * Format days of stock remaining
 */
export function formatDays(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'Out';
  if (days < 1) return '<1 day';
  return `${Math.round(days)} days`;
}
