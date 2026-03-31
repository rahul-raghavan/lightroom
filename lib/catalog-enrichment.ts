import {
  CatalogEntry,
  LookupField,
  LookupState,
  LookupStateBySource,
  MasterCatalog,
} from './catalog-types';
import { getCatalogScope } from './catalog-scope';

export interface MissingFields {
  author: boolean;
  publisher: boolean;
  tags: boolean;
}

export type LookupSourceName = keyof LookupStateBySource;
export type EnrichmentPhase = 'open-library' | 'india-isbn' | 'google-books' | 'done';

export const OPEN_LIBRARY_DELAY_MS = 300;
export const INDIA_ISBN_DELAY_MS = 500;
export const GOOGLE_BOOKS_DELAY_MS = 1100;
export const LOOKUP_ERROR_RETRY_MS = 60 * 60 * 1000;
export const GOOGLE_BOOKS_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const INDIA_ISBN_PREFIXES = ['97881', '97893', '97981'] as const;

export function isGoogleBooksStageSkipped(
  enrichmentState?: MasterCatalog['enrichmentState']
): boolean {
  return Boolean(enrichmentState?.googleBooksSkippedAt);
}

export function getMissingFields(entry: CatalogEntry): MissingFields {
  return {
    author: !entry.author,
    publisher: entry.publisher === 'Unknown Publisher',
    tags: !entry.tagData,
  };
}

export function countMissingFields(missing: MissingFields): number {
  return Number(missing.author) + Number(missing.publisher) + Number(missing.tags);
}

export function hasMissingFields(entry: CatalogEntry): boolean {
  return countMissingFields(getMissingFields(entry)) > 0;
}

export function isBookEntry(entry: CatalogEntry): boolean {
  return (entry.scope || getCatalogScope(entry.isbn, entry.category).scope) === 'book';
}

export function selectEnrichmentCandidates(
  entries: CatalogEntry[],
  options?: { onlyRevenue?: boolean }
): CatalogEntry[] {
  const onlyRevenue = options?.onlyRevenue || false;

  return entries
    .filter(entry => isBookEntry(entry))
    .filter(entry => !onlyRevenue || entry.revenue > 0)
    .filter(hasMissingFields)
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;

      const missingDelta = countMissingFields(getMissingFields(b)) - countMissingFields(getMissingFields(a));
      if (missingDelta !== 0) return missingDelta;

      return a.isbn.localeCompare(b.isbn);
    });
}

export function isLookupEligible(
  state: LookupState | undefined,
  now: Date,
  retryMisses: boolean
): boolean {
  if (!state) return true;

  if (state.status === 'pending') return true;
  if (state.status === 'miss') return retryMisses;
  if (state.status === 'hit') return false;

  if (!state.nextEligibleAt) return true;
  return new Date(state.nextEligibleAt) <= now;
}

export function terminalLookupStatus(state: LookupState | undefined): boolean {
  return state?.status === 'hit' || state?.status === 'miss';
}

export function countCompleteBooks(entries: CatalogEntry[]): number {
  return entries.filter(entry => isBookEntry(entry) && !hasMissingFields(entry)).length;
}

export function countRevenueCompleteBooks(entries: CatalogEntry[]): number {
  return entries.filter(entry => isBookEntry(entry) && entry.revenue > 0 && !hasMissingFields(entry)).length;
}

export function isIndiaIsbnCandidate(isbn: string): boolean {
  return INDIA_ISBN_PREFIXES.some(prefix => isbn.startsWith(prefix));
}

export function needsIndiaIsbnLookup(entry: CatalogEntry): boolean {
  const missing = getMissingFields(entry);
  return isIndiaIsbnCandidate(entry.isbn) && (missing.author || missing.publisher);
}

export function createLookupState(
  previous: LookupState | undefined,
  status: LookupState['status'],
  fieldsResolved: LookupField[],
  now: string,
  nextEligibleAt?: string
): LookupState {
  return {
    status,
    attempts: (previous?.attempts || 0) + 1,
    lastAttemptAt: now,
    ...(nextEligibleAt ? { nextEligibleAt } : {}),
    fieldsResolved,
  };
}

export function applyGoogleRateLimitState(catalog: MasterCatalog, entry: CatalogEntry, lookedUpAt: string): string {
  const blockedUntil = new Date(Date.now() + GOOGLE_BOOKS_COOLDOWN_MS).toISOString();

  entry.lookupState = {
    ...(entry.lookupState || {}),
    googleBooks: createLookupState(entry.lookupState?.googleBooks, 'rate_limited', [], lookedUpAt, blockedUntil),
  };
  catalog.enrichmentState = {
    ...(catalog.enrichmentState || {}),
    googleBooksBlockedUntil: blockedUntil,
  };

  return blockedUntil;
}

export function clearResidualPublisherSuggestions(catalog: MasterCatalog): void {
  for (const entry of Object.values(catalog.entries)) {
    if (entry.suggestion?.source === 'isbn-prefix') {
      delete entry.suggestion;
    }
  }
}

function getIsbnPrefix(isbn: string): string {
  return isbn.slice(0, 8);
}

function canReceiveResidualPublisherSuggestion(
  entry: CatalogEntry,
  googleBooksSkipped: boolean
): boolean {
  if (!isBookEntry(entry)) return false;
  if (entry.publisher !== 'Unknown Publisher') return false;
  if (entry.publisherConfirmed) return false;

  if (!terminalLookupStatus(entry.lookupState?.openLibrary)) return false;
  if (needsIndiaIsbnLookup(entry) && !terminalLookupStatus(entry.lookupState?.indiaIsbn)) return false;

  return googleBooksSkipped || terminalLookupStatus(entry.lookupState?.googleBooks);
}

export function applyResidualPublisherSuggestions(catalog: MasterCatalog): number {
  clearResidualPublisherSuggestions(catalog);
  const googleBooksSkipped = isGoogleBooksStageSkipped(catalog.enrichmentState);

  const prefixGroups = new Map<string, CatalogEntry[]>();
  for (const entry of Object.values(catalog.entries)) {
    if (!isBookEntry(entry)) continue;

    const prefix = getIsbnPrefix(entry.isbn);
    const group = prefixGroups.get(prefix) || [];
    group.push(entry);
    prefixGroups.set(prefix, group);
  }

  let suggestionsAdded = 0;
  const lookedUpAt = new Date().toISOString();

  for (const group of prefixGroups.values()) {
    const knownPublishers = new Map<string, number>();
    for (const entry of group) {
      if (entry.publisher === 'Unknown Publisher') continue;
      knownPublishers.set(entry.publisher, (knownPublishers.get(entry.publisher) || 0) + 1);
    }

    if (knownPublishers.size === 0) continue;

    let bestPublisher = '';
    let bestCount = 0;
    for (const [publisher, count] of knownPublishers.entries()) {
      if (count > bestCount) {
        bestPublisher = publisher;
        bestCount = count;
      }
    }

    if (!bestPublisher) continue;

    for (const entry of group) {
      if (!canReceiveResidualPublisherSuggestion(entry, googleBooksSkipped)) continue;

      entry.suggestion = {
        publisher: bestPublisher,
        source: 'isbn-prefix',
        confidence: bestCount >= 3 ? 'medium' : 'low',
        lookedUpAt,
      };
      suggestionsAdded++;
    }
  }

  return suggestionsAdded;
}

export function getManualExceptionCounts(
  entries: CatalogEntry[],
  enrichmentState?: MasterCatalog['enrichmentState']
): {
  pendingOpenLibrary: number;
  pendingIndiaIsbn: number;
  pendingGoogleBooks: number;
  manualOnly: number;
} {
  let pendingOpenLibrary = 0;
  let pendingIndiaIsbn = 0;
  let pendingGoogleBooks = 0;
  let manualOnly = 0;
  const googleBooksSkipped = isGoogleBooksStageSkipped(enrichmentState);

  for (const entry of entries) {
    if (!isBookEntry(entry) || !hasMissingFields(entry)) continue;

    const ol = entry.lookupState?.openLibrary;
    const india = entry.lookupState?.indiaIsbn;
    const gb = entry.lookupState?.googleBooks;

    if (!terminalLookupStatus(ol)) {
      pendingOpenLibrary++;
      continue;
    }

    if (needsIndiaIsbnLookup(entry) && !terminalLookupStatus(india)) {
      pendingIndiaIsbn++;
      continue;
    }

    if (!googleBooksSkipped && !terminalLookupStatus(gb)) {
      pendingGoogleBooks++;
      continue;
    }

    manualOnly++;
  }

  return { pendingOpenLibrary, pendingIndiaIsbn, pendingGoogleBooks, manualOnly };
}

export function determineEnrichmentPhase(
  entries: CatalogEntry[],
  enrichmentState?: MasterCatalog['enrichmentState']
): EnrichmentPhase {
  const counts = getManualExceptionCounts(entries, enrichmentState);

  if (counts.pendingOpenLibrary > 0) return 'open-library';
  if (counts.pendingIndiaIsbn > 0) return 'india-isbn';
  if (!isGoogleBooksStageSkipped(enrichmentState) && counts.pendingGoogleBooks > 0) return 'google-books';
  return 'done';
}
