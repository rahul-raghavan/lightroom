#!/usr/bin/env tsx
/**
 * Quota-aware catalog enrichment — fills missing author, publisher, and tags
 * while persisting per-source lookup state so reruns skip misses and survive 429s.
 *
 * Usage:
 *   npm run enrich-catalog
 *   npm run enrich-catalog -- --source open-library --limit 250 --only-revenue
 *   npm run enrich-catalog -- --source india-isbn --limit 500
 *   npm run enrich-catalog -- --source google-books --limit 500
 *   npm run enrich-catalog -- --retry-misses --dry-run
 *
 * `--skip-google` is preserved as an alias for `--source open-library`.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CatalogEntry,
  LookupField,
  MasterCatalog,
} from '../lib/catalog-types';
import {
  addSearchAlias,
  applyTitleCandidate,
  normalizeCatalogEntry,
  sanitizeTagData,
  setCanonicalAuthor,
  setCanonicalPublisher,
} from '../lib/catalog-normalization';
import { parseIndiaIsbnSearchResult } from '../lib/india-isbn';
import {
  ageGroupFromPublisher,
  mapGoogleBooksCategories,
  mapOpenLibrarySubjects,
  mergeTags,
  validateCategories,
} from '../lib/tag-mapper';
import {
  GOOGLE_BOOKS_DELAY_MS,
  INDIA_ISBN_DELAY_MS,
  LOOKUP_ERROR_RETRY_MS,
  OPEN_LIBRARY_DELAY_MS,
  applyResidualPublisherSuggestions,
  applyGoogleRateLimitState,
  countCompleteBooks,
  countRevenueCompleteBooks,
  createLookupState,
  determineEnrichmentPhase,
  getManualExceptionCounts,
  getMissingFields,
  isBookEntry,
  needsIndiaIsbnLookup as entryNeedsIndiaIsbnLookup,
  isLookupEligible,
  selectEnrichmentCandidates,
  terminalLookupStatus,
} from '../lib/catalog-enrichment';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'master-catalog.json');

type SourceMode = 'open-library' | 'india-isbn' | 'google-books' | 'all';

interface ApiBookData {
  title?: string;
  publisher?: string;
  authors?: string[];
  categories?: string[];
  subjects?: string[];
  language?: string;
}

interface LookupResult {
  kind: 'hit' | 'miss' | 'error' | 'rate_limited';
  data?: ApiBookData;
}

interface RunOptions {
  source: SourceMode;
  maxLookups: number;
  onlyRevenue: boolean;
  retryMisses: boolean;
  saveEvery: number;
  dryRun: boolean;
}

interface RunStats {
  authorsFilled: number;
  publishersFilled: number;
  tagsFilled: number;
  openLibraryHits: number;
  openLibraryMisses: number;
  indiaHits: number;
  indiaMisses: number;
  indiaCalls: number;
  googleHits: number;
  googleMisses: number;
  googleCalls: number;
  publisherSuggestions: number;
}

const INDIA_ISBN_SEARCH_URL = 'https://isbn.gov.in/Home/IsbnSearch';
const INDIA_ISBN_LOOKUP_URL = 'https://isbn.gov.in/Home/SearchIsbnResult';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

class IndiaIsbnClient {
  private cookieHeader = '';
  private hasSession = false;

  private async ensureSession(): Promise<void> {
    if (this.hasSession) return;

    const res = await fetch(INDIA_ISBN_SEARCH_URL, {
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      throw new Error(`India ISBN session failed with ${res.status}`);
    }

    const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
    this.cookieHeader = setCookies
      .map(cookie => cookie.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ');
    this.hasSession = true;
  }

  private resetSession(): void {
    this.cookieHeader = '';
    this.hasSession = false;
  }

  private async lookupOnce(isbn: string): Promise<LookupResult> {
    await this.ensureSession();

    const res = await fetch(INDIA_ISBN_LOOKUP_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept': '*/*',
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': INDIA_ISBN_SEARCH_URL,
        ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {}),
      },
      body: JSON.stringify({
        Title: '',
        Publisher: '',
        Author: '',
        Years: '',
        IsbnNumber: isbn,
        Mobile: '',
        Email: '',
        Fromdate: '',
        Todate: '',
        selectTopFromValue: '',
        NosCounter: '',
        PreviouseRec: '',
      }),
    });

    if (!res.ok) {
      return { kind: 'error' };
    }

    const html = await res.text();
    const parsed = parseIndiaIsbnSearchResult(html, isbn);
    if (!parsed) {
      return { kind: 'miss' };
    }

    return {
      kind: 'hit',
      data: {
        title: parsed.title,
        publisher: parsed.publisher,
        authors: parsed.authors,
        language: parsed.language,
      },
    };
  }

  async lookup(isbn: string): Promise<LookupResult> {
    try {
      const result = await this.lookupOnce(isbn);
      if (result.kind !== 'error') return result;
    } catch {
      // Retry once with a fresh session below.
    }

    try {
      this.resetSession();
      return await this.lookupOnce(isbn);
    } catch {
      this.resetSession();
      return { kind: 'error' };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeCatalog(catalog: MasterCatalog): void {
  for (const entry of Object.values(catalog.entries)) {
    normalizeCatalogEntry(entry);
  }
}

function readCatalog(): MasterCatalog {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('Catalog not found. Run `npm run build-catalog` first.');
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as MasterCatalog;
  normalizeCatalog(catalog);
  return catalog;
}

function writeCatalog(catalog: MasterCatalog): void {
  normalizeCatalog(catalog);
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

function formatRupees(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function getCoverageSnapshot(catalog: MasterCatalog) {
  const entries = Object.values(catalog.entries);
  const inScope = entries.filter(isBookEntry);
  const revenueBooks = inScope.filter(entry => entry.revenue > 0);

  return {
    withAuthor: inScope.filter(entry => entry.author).length,
    withPublisher: inScope.filter(entry => entry.publisher !== 'Unknown Publisher').length,
    withTags: inScope.filter(entry => entry.tagData).length,
    completeBooks: countCompleteBooks(inScope),
    revenueCompleteBooks: countRevenueCompleteBooks(revenueBooks),
    exceptionCounts: getManualExceptionCounts(inScope, catalog.enrichmentState),
  };
}

function printCheckpointSnapshot(catalog: MasterCatalog): void {
  const snapshot = getCoverageSnapshot(catalog);

  console.log(
    `     snapshot: author=${snapshot.withAuthor} publisher=${snapshot.withPublisher} ` +
    `tags=${snapshot.withTags} complete=${snapshot.completeBooks} revenue-complete=${snapshot.revenueCompleteBooks} ` +
    `pending(ol=${snapshot.exceptionCounts.pendingOpenLibrary}, india=${snapshot.exceptionCounts.pendingIndiaIsbn}, google=${snapshot.exceptionCounts.pendingGoogleBooks}, manual=${snapshot.exceptionCounts.manualOnly})`
  );
}

function parseOptions(args: string[]): RunOptions {
  const sourceIndex = args.indexOf('--source');
  const limitIndex = args.indexOf('--limit');
  const saveEveryIndex = args.indexOf('--save-every');
  const skipGoogle = args.includes('--skip-google');

  const source = (skipGoogle
    ? 'open-library'
    : (sourceIndex >= 0 ? args[sourceIndex + 1] : 'all')) as SourceMode;

  if (!['open-library', 'india-isbn', 'google-books', 'all'].includes(source)) {
    console.error('Invalid source "' + source + '". Use open-library, india-isbn, google-books, or all.');
    process.exit(1);
  }

  return {
    source,
    maxLookups: limitIndex >= 0 ? parseInt(args[limitIndex + 1] || '500', 10) : 500,
    onlyRevenue: args.includes('--only-revenue'),
    retryMisses: args.includes('--retry-misses'),
    saveEvery: saveEveryIndex >= 0 ? parseInt(args[saveEveryIndex + 1] || '25', 10) : 25,
    dryRun: args.includes('--dry-run'),
  };
}

async function lookupOpenLibrary(isbn: string): Promise<LookupResult> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { kind: 'error' };

    const data = await res.json();
    const entry = data[`ISBN:${isbn}`];
    if (!entry) return { kind: 'miss' };

    return {
      kind: 'hit',
      data: {
        title: entry.title || undefined,
        publisher: entry.publishers?.[0]?.name || undefined,
        authors: entry.authors?.map((author: { name: string }) => author.name) || undefined,
        subjects: entry.subjects?.map((subject: { name: string }) => subject.name) || undefined,
      },
    };
  } catch {
    return { kind: 'error' };
  }
}

async function lookupGoogleBooks(isbn: string): Promise<LookupResult> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;

  try {
    const res = await fetch(url);
    if (res.status === 429) return { kind: 'rate_limited' };
    if (!res.ok) return { kind: 'error' };

    const data = await res.json();
    if (!data.items?.length) return { kind: 'miss' };

    const info = data.items[0].volumeInfo;
    return {
      kind: 'hit',
      data: {
        title: info.title || undefined,
        publisher: info.publisher || undefined,
        authors: info.authors || undefined,
        categories: info.categories || undefined,
      },
    };
  } catch {
    return { kind: 'error' };
  }
}

function setLookupState(
  entry: CatalogEntry,
  source: 'openLibrary' | 'indiaIsbn' | 'googleBooks',
  status: 'pending' | 'hit' | 'miss' | 'error' | 'rate_limited',
  fieldsResolved: LookupField[],
  lookedUpAt: string,
  nextEligibleAt?: string
): void {
  entry.lookupState = {
    ...(entry.lookupState || {}),
    [source]: createLookupState(entry.lookupState?.[source], status, fieldsResolved, lookedUpAt, nextEligibleAt),
  };
}

function applyOpenLibraryData(entry: CatalogEntry, data: ApiBookData): LookupField[] {
  const resolved: LookupField[] = [];
  const missing = getMissingFields(entry);

  if (data.title) {
    applyTitleCandidate(entry, data.title, 'open-library');
  }

  if (missing.author && data.authors?.length && setCanonicalAuthor(entry, data.authors.join(', '), 'open-library')) {
    resolved.push('author');
  }

  if (missing.publisher && data.publisher) {
    const publisherResult = setCanonicalPublisher(entry, data.publisher, 'open-library');
    if (publisherResult.changed) {
      resolved.push('publisher');
    } else if (publisherResult.reviewCanonical) {
      addSearchAlias(entry, 'publishers', publisherResult.reviewCanonical, [entry.publisher]);
    }
  }

  if (missing.tags && data.subjects?.length) {
    const mapped = mapOpenLibrarySubjects(data.subjects);
    const validCategories = validateCategories(mapped.categories);

    if (mapped.ageGroup || validCategories.length > 0 || mapped.subjects.length > 0) {
      const sanitized = sanitizeTagData({
        ageGroup: mapped.ageGroup,
        categories: validCategories,
        subjects: mapped.subjects,
        source: 'open-library',
        confidence: 'high',
        taggedAt: new Date().toISOString(),
      });

      if (sanitized && (sanitized.ageGroup || sanitized.categories.length > 0 || sanitized.subjects.length > 0)) {
        entry.tagData = sanitized;
        resolved.push('tags');
      }
    }
  }

  normalizeCatalogEntry(entry);
  return resolved;
}

function applyIndiaIsbnData(entry: CatalogEntry, data: ApiBookData): LookupField[] {
  const resolved: LookupField[] = [];
  const missing = getMissingFields(entry);

  if (data.title) {
    applyTitleCandidate(entry, data.title, 'india-isbn', { authoritative: true });
  }

  if (missing.author && data.authors?.length && setCanonicalAuthor(entry, data.authors.join(', '), 'india-isbn')) {
    resolved.push('author');
  }

  if (missing.publisher && data.publisher) {
    const publisherResult = setCanonicalPublisher(entry, data.publisher, 'india-isbn');
    if (publisherResult.changed) {
      resolved.push('publisher');
    } else if (publisherResult.reviewCanonical) {
      addSearchAlias(entry, 'publishers', publisherResult.reviewCanonical, [entry.publisher]);
    }
  }

  if (!entry.language && data.language) {
    entry.language = data.language;
  }

  normalizeCatalogEntry(entry);
  return resolved;
}

function applyGoogleBooksData(entry: CatalogEntry, data: ApiBookData, openLibraryData?: ApiBookData): LookupField[] {
  const resolved: LookupField[] = [];
  const missing = getMissingFields(entry);

  if (data.title) {
    applyTitleCandidate(entry, data.title, 'google-books');
  }

  if (missing.author && data.authors?.length && setCanonicalAuthor(entry, data.authors.join(', '), 'google-books')) {
    resolved.push('author');
  }

  if (missing.publisher && data.publisher) {
    const publisherResult = setCanonicalPublisher(entry, data.publisher, 'google-books');
    if (publisherResult.changed) {
      resolved.push('publisher');
    } else if (publisherResult.reviewCanonical) {
      addSearchAlias(entry, 'publishers', publisherResult.reviewCanonical, [entry.publisher]);
    }
  }

  if (missing.tags && data.categories?.length) {
    const googleTags = mapGoogleBooksCategories(data.categories);
    const openLibraryTags = openLibraryData?.subjects?.length
      ? mapOpenLibrarySubjects(openLibraryData.subjects)
      : null;
    const merged = openLibraryTags ? mergeTags(openLibraryTags, googleTags) : googleTags;

    if (!merged.ageGroup && entry.publisher !== 'Unknown Publisher') {
      const publisherAge = ageGroupFromPublisher(entry.publisher);
      if (publisherAge) merged.ageGroup = publisherAge;
    }

    const validCategories = validateCategories(merged.categories);
    if (merged.ageGroup || validCategories.length > 0 || merged.subjects.length > 0) {
      const sanitized = sanitizeTagData({
        ageGroup: merged.ageGroup,
        categories: validCategories,
        subjects: merged.subjects,
        source: 'google-books',
        confidence: 'high',
        taggedAt: new Date().toISOString(),
        rawCategories: data.categories,
      });

      if (sanitized && (sanitized.ageGroup || sanitized.categories.length > 0 || sanitized.subjects.length > 0)) {
        entry.tagData = sanitized;
        resolved.push('tags');
      }
    }
  }

  normalizeCatalogEntry(entry);
  return resolved;
}

function applyPublisherHeuristicTag(entry: CatalogEntry): boolean {
  if (entry.tagData || entry.publisher === 'Unknown Publisher') return false;

  const publisherAge = ageGroupFromPublisher(entry.publisher);
  if (!publisherAge) return false;

  entry.tagData = {
    ageGroup: publisherAge,
    categories: [],
    subjects: [],
    source: 'publisher-heuristic',
    confidence: 'low',
    taggedAt: new Date().toISOString(),
  };
  normalizeCatalogEntry(entry);
  return true;
}

function printHeader(
  catalog: MasterCatalog,
  options: RunOptions,
  candidates: CatalogEntry[],
  queue: CatalogEntry[],
  modeLabel: string
): void {
  const entries = Object.values(catalog.entries);
  const inScope = entries.filter(isBookEntry).length;
  const excluded = entries.length - inScope;
  const missingAuthor = candidates.filter(entry => getMissingFields(entry).author).length;
  const missingPublisher = candidates.filter(entry => getMissingFields(entry).publisher).length;
  const missingTags = candidates.filter(entry => getMissingFields(entry).tags).length;

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║        QUOTA-AWARE ENRICHMENT               ║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║  In-scope books: ${inScope.toLocaleString().padEnd(28)}║`);
  console.log(`║  Excluded rows: ${excluded.toLocaleString().padEnd(28)}║`);
  console.log(`║  Candidates: ${candidates.length.toLocaleString().padEnd(31)}║`);
  console.log(`║    Missing author:    ${missingAuthor.toLocaleString().padEnd(23)}║`);
  console.log(`║    Missing publisher: ${missingPublisher.toLocaleString().padEnd(23)}║`);
  console.log(`║    Missing tags:      ${missingTags.toLocaleString().padEnd(23)}║`);
  console.log(`║  Mode: ${modeLabel.padEnd(36)}║`);
  console.log(`║  Revenue-only: ${(options.onlyRevenue ? 'yes' : 'no').padEnd(29)}║`);
  console.log(`║  Queue this run: ${queue.length.toLocaleString().padEnd(26)}║`);
  if (options.dryRun) {
    console.log(`║  DRY RUN — no changes will be saved          ║`);
  }
  console.log(`╚══════════════════════════════════════════════╝`);
}

function needsGoogleLookup(entry: CatalogEntry, retryMisses: boolean, now: Date): boolean {
  const missing = getMissingFields(entry);
  if (!terminalLookupStatus(entry.lookupState?.openLibrary)) return false;
  if (entryNeedsIndiaIsbnLookup(entry) && !terminalLookupStatus(entry.lookupState?.indiaIsbn)) return false;
  if (!missing.author && !missing.publisher && !missing.tags) return false;

  return isLookupEligible(entry.lookupState?.googleBooks, now, retryMisses);
}

function needsIndiaLookup(entry: CatalogEntry, retryMisses: boolean, now: Date): boolean {
  if (!entryNeedsIndiaIsbnLookup(entry)) return false;

  return isLookupEligible(entry.lookupState?.indiaIsbn, now, retryMisses);
}

function needsOpenLibraryLookup(entry: CatalogEntry, retryMisses: boolean, now: Date): boolean {
  const missing = getMissingFields(entry);
  if (!missing.author && !missing.publisher && !missing.tags) return false;

  return isLookupEligible(entry.lookupState?.openLibrary, now, retryMisses);
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const catalog = readCatalog();
  catalog.enrichmentState = catalog.enrichmentState || {};

  const runStartedAt = new Date();
  const blockedUntil = catalog.enrichmentState.googleBooksBlockedUntil
    ? new Date(catalog.enrichmentState.googleBooksBlockedUntil)
    : null;

  if (blockedUntil && blockedUntil <= runStartedAt && !options.dryRun) {
    delete catalog.enrichmentState.googleBooksBlockedUntil;
  }

  const entries = Object.values(catalog.entries);
  const candidates = selectEnrichmentCandidates(entries, { onlyRevenue: options.onlyRevenue });
  const inScopeEntries = entries.filter(isBookEntry);
  const stageCounts = getManualExceptionCounts(inScopeEntries, catalog.enrichmentState);
  const activePhase = determineEnrichmentPhase(inScopeEntries, catalog.enrichmentState);
  const googlePhaseReady = stageCounts.pendingOpenLibrary === 0 && stageCounts.pendingIndiaIsbn === 0;
  const effectiveSource: SourceMode = options.source === 'all'
    ? (activePhase === 'done' ? 'all' : activePhase)
    : options.source;

  let queue = candidates.filter(entry => {
    if (effectiveSource === 'open-library') {
      return needsOpenLibraryLookup(entry, options.retryMisses, runStartedAt);
    }

    if (effectiveSource === 'india-isbn') {
      return needsIndiaLookup(entry, options.retryMisses, runStartedAt);
    }

    if (effectiveSource === 'google-books') {
      if (!googlePhaseReady) return false;
      return needsGoogleLookup(entry, options.retryMisses, runStartedAt);
    }

    return (
      needsOpenLibraryLookup(entry, options.retryMisses, runStartedAt) ||
      (terminalLookupStatus(entry.lookupState?.openLibrary) && needsIndiaLookup(entry, options.retryMisses, runStartedAt)) ||
      needsGoogleLookup(entry, options.retryMisses, runStartedAt)
    );
  });

  queue = queue.slice(0, options.maxLookups);

  const modeLabel = options.source === 'all'
    ? (activePhase === 'done' ? 'all (complete)' : `all -> ${effectiveSource}`)
    : effectiveSource;
  printHeader(catalog, options, candidates, queue, modeLabel);

  if (queue.length === 0) {
    if (options.source === 'google-books' && !googlePhaseReady) {
      console.log('\nGoogle Books is gated until Open Library and India ISBN are exhausted for the whole catalog.');
      return;
    }

    console.log('\nNothing to do for this source/queue.');
    return;
  }

  const googleBlockedForRun = blockedUntil && blockedUntil > runStartedAt;
  if (googleBlockedForRun && effectiveSource === 'google-books') {
    console.log(`\nGoogle Books is blocked until ${blockedUntil.toISOString()}. Google calls will be skipped this run.`);
  }

  const stats: RunStats = {
    authorsFilled: 0,
    publishersFilled: 0,
    tagsFilled: 0,
    openLibraryHits: 0,
    openLibraryMisses: 0,
    indiaHits: 0,
    indiaMisses: 0,
    indiaCalls: 0,
    googleHits: 0,
    googleMisses: 0,
    googleCalls: 0,
    publisherSuggestions: 0,
  };

  let processed = 0;
  let googleRateLimited = false;
  const indiaClient = new IndiaIsbnClient();

  for (const queuedEntry of queue) {
    const entry = catalog.entries[queuedEntry.isbn];
    if (!entry) continue;

    let openLibraryData: ApiBookData | undefined;
    const missingBefore = getMissingFields(entry);
    if (!missingBefore.author && !missingBefore.publisher && !missingBefore.tags) continue;

    if (effectiveSource === 'open-library' && isLookupEligible(entry.lookupState?.openLibrary, new Date(), options.retryMisses)) {
      const lookedUpAt = new Date().toISOString();
      const result = await lookupOpenLibrary(entry.isbn);

      if (result.kind === 'hit') {
        stats.openLibraryHits++;
        openLibraryData = result.data;
        const resolved = options.dryRun || !result.data ? [] : applyOpenLibraryData(entry, result.data);
        setLookupState(entry, 'openLibrary', 'hit', resolved, lookedUpAt);
      } else if (result.kind === 'miss') {
        stats.openLibraryMisses++;
        setLookupState(entry, 'openLibrary', 'miss', [], lookedUpAt);
      } else {
        const retryAt = new Date(Date.now() + LOOKUP_ERROR_RETRY_MS).toISOString();
        setLookupState(entry, 'openLibrary', 'error', [], lookedUpAt, retryAt);
      }

      await sleep(OPEN_LIBRARY_DELAY_MS);
    }

    if (
      effectiveSource === 'india-isbn' &&
      entryNeedsIndiaIsbnLookup(entry) &&
      terminalLookupStatus(entry.lookupState?.openLibrary) &&
      isLookupEligible(entry.lookupState?.indiaIsbn, new Date(), options.retryMisses)
    ) {
      const lookedUpAt = new Date().toISOString();
      const result = await indiaClient.lookup(entry.isbn);
      stats.indiaCalls++;

      if (result.kind === 'hit') {
        stats.indiaHits++;
        const resolved = options.dryRun || !result.data ? [] : applyIndiaIsbnData(entry, result.data);
        setLookupState(entry, 'indiaIsbn', 'hit', resolved, lookedUpAt);
      } else if (result.kind === 'miss') {
        stats.indiaMisses++;
        setLookupState(entry, 'indiaIsbn', 'miss', [], lookedUpAt);
      } else {
        const retryAt = new Date(Date.now() + LOOKUP_ERROR_RETRY_MS).toISOString();
        setLookupState(entry, 'indiaIsbn', 'error', [], lookedUpAt, retryAt);
      }

      await sleep(INDIA_ISBN_DELAY_MS);
    }

    const missingAfterIndia = getMissingFields(entry);
    const googleEligible = !googleBlockedForRun &&
      effectiveSource === 'google-books' &&
      terminalLookupStatus(entry.lookupState?.openLibrary) &&
      (!entryNeedsIndiaIsbnLookup(entry) || terminalLookupStatus(entry.lookupState?.indiaIsbn)) &&
      (missingAfterIndia.author || missingAfterIndia.publisher || missingAfterIndia.tags) &&
      isLookupEligible(entry.lookupState?.googleBooks, new Date(), options.retryMisses);

    if (googleEligible) {
      const lookedUpAt = new Date().toISOString();
      const result = await lookupGoogleBooks(entry.isbn);
      stats.googleCalls++;

      if (result.kind === 'rate_limited') {
        const retryAt = applyGoogleRateLimitState(catalog, entry, lookedUpAt);

        if (!options.dryRun) {
          stats.publisherSuggestions = applyResidualPublisherSuggestions(catalog);
          writeCatalog(catalog);
        }

        console.warn(`\nGoogle Books rate limited. Cooling down until ${retryAt}.`);
        googleRateLimited = true;
        break;
      }

      if (result.kind === 'hit') {
        stats.googleHits++;
        const resolved = options.dryRun || !result.data
          ? []
          : applyGoogleBooksData(entry, result.data, openLibraryData);
        setLookupState(entry, 'googleBooks', 'hit', resolved, lookedUpAt);
      } else if (result.kind === 'miss') {
        stats.googleMisses++;
        setLookupState(entry, 'googleBooks', 'miss', [], lookedUpAt);
      } else {
        const retryAt = new Date(Date.now() + LOOKUP_ERROR_RETRY_MS).toISOString();
        setLookupState(entry, 'googleBooks', 'error', [], lookedUpAt, retryAt);
      }

      await sleep(GOOGLE_BOOKS_DELAY_MS);
    }

    if (
      !options.dryRun &&
      getMissingFields(entry).tags &&
      terminalLookupStatus(entry.lookupState?.googleBooks) &&
      applyPublisherHeuristicTag(entry)
    ) {
      stats.tagsFilled++;
    }

    const missingAfter = getMissingFields(entry);
    if (!missingBefore.author && missingAfter.author) {
      // no-op
    } else if (missingBefore.author && !missingAfter.author) {
      stats.authorsFilled++;
    }

    if (missingBefore.publisher && !missingAfter.publisher) {
      stats.publishersFilled++;
    }

    if (missingBefore.tags && !missingAfter.tags && entry.tagData?.source !== 'publisher-heuristic') {
      stats.tagsFilled++;
    }

    processed++;

    if (!options.dryRun && processed % options.saveEvery === 0) {
      stats.publisherSuggestions = applyResidualPublisherSuggestions(catalog);
      writeCatalog(catalog);
      console.log(`  --- saved progress (${processed}/${queue.length}) ---`);
      printCheckpointSnapshot(catalog);
    }

    const filledParts: string[] = [];
    if (missingBefore.author && !missingAfter.author) filledParts.push(`author="${entry.author}"`);
    if (missingBefore.publisher && !missingAfter.publisher) filledParts.push(`pub="${entry.publisher}"`);
    if (missingBefore.tags && !missingAfter.tags) {
      if (entry.tagData?.categories.length) filledParts.push(`tags=[${entry.tagData.categories.join(',')}]`);
      else if (entry.tagData?.ageGroup) filledParts.push(`age="${entry.tagData.ageGroup}"`);
    }
    if (entry.name && entry.rawName && entry.name !== entry.rawName) {
      filledParts.push(`title="${entry.name}"`);
    }

    if (filledParts.length > 0) {
      const revenueString = entry.revenue > 0 ? ` ${formatRupees(entry.revenue)}` : '';
      console.log(`  [${processed}/${queue.length}] ${entry.isbn}${revenueString} → ${filledParts.join(' | ')}`);
    } else if (processed % 20 === 0) {
      console.log(`  [${processed}/${queue.length}] ...`);
    }
  }

  if (!options.dryRun && !googleRateLimited) {
    stats.publisherSuggestions = applyResidualPublisherSuggestions(catalog);
    writeCatalog(catalog);
  }

  const finalEntries = Object.values(catalog.entries);
  const inScope = finalEntries.filter(isBookEntry);
  const withAuthor = inScope.filter(entry => entry.author).length;
  const withPublisher = inScope.filter(entry => entry.publisher !== 'Unknown Publisher').length;
  const withTags = inScope.filter(entry => entry.tagData).length;
  const completeBooks = countCompleteBooks(inScope);
  const revenueCompleteBooks = countRevenueCompleteBooks(inScope.filter(entry => entry.revenue > 0));
  const exceptionCounts = getManualExceptionCounts(inScope, catalog.enrichmentState);

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║           ENRICHMENT RESULTS                ║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║  Processed: ${processed.toString().padEnd(33)}║`);
  console.log(`║  Authors filled: ${stats.authorsFilled.toString().padEnd(26)}║`);
  console.log(`║  Publishers filled: ${stats.publishersFilled.toString().padEnd(23)}║`);
  console.log(`║  Tags filled: ${stats.tagsFilled.toString().padEnd(29)}║`);
  console.log(`║  OL hits/misses: ${`${stats.openLibraryHits}/${stats.openLibraryMisses}`.padEnd(24)}║`);
  console.log(`║  India hits/misses: ${`${stats.indiaHits}/${stats.indiaMisses}`.padEnd(21)}║`);
  console.log(`║  India calls: ${stats.indiaCalls.toString().padEnd(28)}║`);
  console.log(`║  Google hits/misses: ${`${stats.googleHits}/${stats.googleMisses}`.padEnd(20)}║`);
  console.log(`║  Google calls: ${stats.googleCalls.toString().padEnd(27)}║`);
  console.log(`║  Prefix suggestions: ${stats.publisherSuggestions.toString().padEnd(21)}║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║  In-scope books: ${inScope.length.toString().padEnd(26)}║`);
  console.log(`║  Have author: ${withAuthor.toString().padEnd(29)}║`);
  console.log(`║  Have publisher: ${withPublisher.toString().padEnd(26)}║`);
  console.log(`║  Have tags: ${withTags.toString().padEnd(31)}║`);
  console.log(`║  Complete books: ${completeBooks.toString().padEnd(24)}║`);
  console.log(`║  Revenue complete: ${revenueCompleteBooks.toString().padEnd(22)}║`);
  console.log(`║  Pending OL: ${exceptionCounts.pendingOpenLibrary.toString().padEnd(29)}║`);
  console.log(`║  Pending India: ${exceptionCounts.pendingIndiaIsbn.toString().padEnd(24)}║`);
  console.log(`║  Pending Google: ${exceptionCounts.pendingGoogleBooks.toString().padEnd(25)}║`);
  console.log(`║  Manual-only: ${exceptionCounts.manualOnly.toString().padEnd(28)}║`);
  console.log(`╚══════════════════════════════════════════════╝`);

  if (catalog.enrichmentState.googleBooksBlockedUntil) {
    console.log(`\nGoogle Books blocked until: ${catalog.enrichmentState.googleBooksBlockedUntil}`);
  }

  if (!options.dryRun) {
    console.log(`Saved to: ${CATALOG_PATH}`);
  } else {
    console.log('Dry run — no changes saved.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
