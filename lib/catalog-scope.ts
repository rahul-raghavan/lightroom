import { CatalogExclusionReason, CatalogScope } from './catalog-types';

export interface ScopeResult {
  scope: CatalogScope;
  exclusionReason?: CatalogExclusionReason;
}

export function isValidBookIsbn(isbn: string): boolean {
  return /^97[89]\d{10}$/.test(isbn);
}

export function isSecondHandCategory(category?: string): boolean {
  const normalizedCategory = String(category || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  return normalizedCategory === 'SECONDHAND' || normalizedCategory === 'SECONDHANDBOOKS';
}

export function getCatalogScope(isbn: string, category?: string): ScopeResult {
  const normalizedCategory = String(category || '').trim().toUpperCase();

  if (normalizedCategory === 'PRODUCTS') {
    return { scope: 'excluded', exclusionReason: 'product_category' };
  }

  if (!isValidBookIsbn(isbn)) {
    return { scope: 'excluded', exclusionReason: 'invalid_isbn' };
  }

  return { scope: 'book' };
}

export function isBookScope(scope: CatalogScope): boolean {
  return scope === 'book';
}
