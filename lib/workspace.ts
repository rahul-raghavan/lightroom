import { CatalogEntry, MasterCatalog } from './catalog-types';
import { getMissingFields, isBookEntry } from './catalog-enrichment';
import { getPublisherAssignmentKey } from './catalog-imprints';
import { buildCatalogSearchText } from './catalog-normalization';

export type WorkspaceStockFilter = 'all' | 'in' | 'out' | 'low';
export type WorkspaceMappedFilter = 'all' | 'mapped' | 'unmapped';
export type WorkspaceCleanupFilter = 'all' | 'clean' | 'needs-attention';
export type WorkspaceSort =
  | 'revenue_desc'
  | 'sales_desc'
  | 'sales_asc'
  | 'stock_asc'
  | 'stock_desc'
  | 'title_asc';

export interface WorkspaceFilters {
  authorQuery?: string;
  authorQueryAny?: string[];
  themeQuery?: string;
  themeQueryAny?: string[];
  query?: string;
  queryAny?: string[];
  publisher?: string;
  distributor?: string;
  ageGroup?: string;
  ageGroupsAny?: string[];
  category?: string;
  stock?: WorkspaceStockFilter;
  stockMin?: number;
  stockMax?: number;
  mapped?: WorkspaceMappedFilter;
  cleanup?: WorkspaceCleanupFilter;
  missing?: Array<'author' | 'publisher' | 'tags'>;
  onlyRevenue?: boolean;
  limit?: number;
  sort?: WorkspaceSort;
}

export interface WorkspaceSearchRow {
  isbn: string;
  name: string;
  author: string;
  publisher: string;
  imprint?: string;
  parentPublisher?: string;
  assignmentKey: string;
  distributorIds: string[];
  distributors: string[];
  distributorMapped: boolean;
  currentStock: number;
  mrp?: number;
  sellingPrice?: number;
  qtySold: number;
  revenue: number;
  language?: string;
  ageGroup?: string;
  categories: string[];
  subjects: string[];
  tagSource?: string;
  tagConfidence?: string;
  missing: ReturnType<typeof getMissingFields>;
  cleanupReady: boolean;
  matchConfidence?: 'high' | 'medium' | 'low';
  matchBasis: string[];
}

export interface WorkspaceMeta {
  summary: {
    books: number;
    complete: number;
    mappedPublishers: number;
    unmappedPublishers: number;
    revenueBooks: number;
  };
  lastBuilt: string;
  sourceFiles?: MasterCatalog['sourceFiles'];
  publishers: string[];
  distributors: string[];
  ageGroups: string[];
  categories: string[];
  nlMode: 'heuristic' | 'openai';
}

export interface WorkspaceOrderItemInput {
  isbn: string;
  quantity: number;
  distributorIds?: string[];
}

export interface WorkspaceOrderDraftGroup {
  groupKey: string;
  distributorName?: string;
  assignmentKeys: string[];
  items: Array<{
    isbn: string;
    title: string;
    author: string;
    publisher: string;
    assignmentKey: string;
    quantity: number;
    currentStock: number;
    qtySold: number;
    revenue: number;
  }>;
}

export interface WorkspaceOrderDraft {
  id: string;
  title: string;
  createdAt: string;
  notes?: string;
  groups: WorkspaceOrderDraftGroup[];
}

function normalizeValue(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeTokenKey(value: string | null | undefined): string {
  return normalizeValue(value).replace(/[^a-z0-9]+/g, '');
}

const SEARCH_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'about',
  'all',
  'any',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'with',
]);

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 4 && token.endsWith('es')) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith('s')) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenizeForSearch(value: string | null | undefined): string[] {
  return normalizeValue(value)
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => !SEARCH_STOPWORDS.has(token))
    .map(stemToken);
}

function getDistributorNames(catalog: Pick<MasterCatalog, 'distributors' | 'publisherDistributors'>, assignmentKey: string): string[] {
  const distributorLookup = new Map((catalog.distributors || []).map(distributor => [distributor.id, distributor.name]));
  return (catalog.publisherDistributors[assignmentKey] || [])
    .map(distributorId => distributorLookup.get(distributorId) || distributorId)
    .filter(Boolean);
}

function matchesTokenSet(haystack: string, query: string): boolean {
  const haystackTokens = new Set(tokenizeForSearch(haystack));
  const queryTokens = tokenizeForSearch(query);
  if (queryTokens.length === 0) return normalizeValue(haystack).includes(normalizeValue(query));
  return queryTokens.every(token => haystackTokens.has(token));
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index) => values.findIndex(candidate => normalizeValue(candidate) === normalizeValue(value)) === index);
}

function buildEntryAuthorPhrases(entry: CatalogEntry): string[] {
  return [
    entry.author,
    ...(entry.searchAliases?.authors || []),
  ].filter(Boolean);
}

function buildEntryTitlePhrases(entry: CatalogEntry): string[] {
  return [
    entry.name,
    entry.rawName || '',
    ...(entry.searchAliases?.titles || []),
  ].filter(Boolean);
}

function buildEntryThemePhrases(entry: CatalogEntry): string[] {
  return [
    ...buildEntryTitlePhrases(entry),
    ...(entry.tagData?.categories || []),
    ...(entry.tagData?.subjects || []),
  ].filter(Boolean);
}

function matchesPhraseSet(phrases: string[], clause: string): string | undefined {
  const normalizedClauseCompact = normalizeTokenKey(clause);

  for (const phrase of phrases) {
    if (matchesTokenSet(phrase, clause)) {
      return phrase;
    }
  }

  if (!normalizedClauseCompact) return undefined;

  for (const phrase of phrases) {
    if (normalizeTokenKey(phrase) === normalizedClauseCompact) {
      return phrase;
    }
  }

  return undefined;
}

function buildMatchInfo(
  entry: CatalogEntry,
  filters: WorkspaceFilters
): Pick<WorkspaceSearchRow, 'matchConfidence' | 'matchBasis'> & { matchScore: number; matchedClauses: string[] } {
  const authorClauses = uniqueStrings([
    ...(filters.authorQuery ? [filters.authorQuery] : []),
    ...(filters.authorQueryAny || []),
  ]);
  const themeClauses = uniqueStrings([
    ...(filters.themeQuery ? [filters.themeQuery] : []),
    ...(filters.themeQueryAny || []),
  ]);
  const clauses = uniqueStrings([
    ...(filters.query ? [filters.query] : []),
    ...(filters.queryAny || []),
  ]);
  const basis: string[] = [];
  const matchedClauses = new Set<string>();
  let confidence: WorkspaceSearchRow['matchConfidence'] = 'low';
  let matchScore = 0;
  const authorPhrases = buildEntryAuthorPhrases(entry);
  const titlePhrases = buildEntryTitlePhrases(entry);
  const themePhrases = buildEntryThemePhrases(entry);

  for (const clause of authorClauses) {
    if (matchesPhraseSet(authorPhrases, clause)) {
      basis.push(`Author match: ${entry.author}`);
      matchedClauses.add(normalizeValue(clause));
      confidence = 'high';
      matchScore = Math.max(matchScore, 110);
    }
  }

  for (const clause of themeClauses) {
    const matchingSubject = matchesPhraseSet(entry.tagData?.subjects || [], clause);
    if (matchingSubject) {
      basis.push(`Subject tag: ${matchingSubject}`);
      matchedClauses.add(normalizeValue(clause));
      confidence = entry.tagData?.confidence === 'high' ? 'high' : 'medium';
      matchScore = Math.max(matchScore, entry.tagData?.confidence === 'high' ? 100 : 90);
      continue;
    }

    const matchingCategory = matchesPhraseSet(entry.tagData?.categories || [], clause);
    if (matchingCategory) {
      basis.push(`Category tag: ${matchingCategory}`);
      matchedClauses.add(normalizeValue(clause));
      confidence = confidence === 'high' ? 'high' : 'medium';
      matchScore = Math.max(matchScore, 82);
      continue;
    }

    if (matchesPhraseSet(titlePhrases, clause) || matchesPhraseSet(themePhrases, clause)) {
      basis.push(`Title/theme match: ${entry.name}`);
      matchedClauses.add(normalizeValue(clause));
      confidence = confidence === 'high' ? 'high' : 'medium';
      matchScore = Math.max(matchScore, 75);
    }
  }

  for (const clause of clauses) {
    if (matchesPhraseSet(authorPhrases, clause)) {
      basis.push(`Author match: ${entry.author}`);
      matchedClauses.add(normalizeValue(clause));
      confidence = 'high';
      matchScore = Math.max(matchScore, 95);
      continue;
    }

    if (matchesPhraseSet(titlePhrases, clause)) {
      basis.push(`Title match: ${entry.name}`);
      matchedClauses.add(normalizeValue(clause));
      confidence = confidence === 'high' ? 'high' : 'medium';
      matchScore = Math.max(matchScore, 72);
      continue;
    }

    const matchingSubject = matchesPhraseSet(entry.tagData?.subjects || [], clause);
    if (matchingSubject) {
      basis.push(`Subject tag: ${matchingSubject}`);
      matchedClauses.add(normalizeValue(clause));
      confidence = entry.tagData?.confidence === 'high' ? 'high' : 'medium';
      matchScore = Math.max(matchScore, entry.tagData?.confidence === 'high' ? 88 : 80);
      continue;
    }

    const matchingCategory = matchesPhraseSet(entry.tagData?.categories || [], clause);
    if (matchingCategory) {
      basis.push(`Category tag: ${matchingCategory}`);
      matchedClauses.add(normalizeValue(clause));
      confidence = confidence === 'high' ? 'high' : 'medium';
      matchScore = Math.max(matchScore, 68);
    }
  }

  if ((filters.ageGroup || (filters.ageGroupsAny || []).length > 0) && entry.tagData?.ageGroup) {
    basis.push(`Age group: ${entry.tagData.ageGroup}`);
    if (confidence === 'low') {
      confidence = entry.tagData?.confidence === 'high' ? 'medium' : 'low';
    }
    matchScore += entry.tagData?.confidence === 'high' ? 12 : 8;
  }

  if (filters.category) {
    const matchingCategory = (entry.tagData?.categories || []).find(category => normalizeValue(category) === normalizeValue(filters.category));
    if (matchingCategory) {
      basis.push(`Category: ${matchingCategory}`);
      if (confidence === 'low') {
        confidence = entry.tagData?.confidence === 'high' ? 'medium' : 'low';
      }
      matchScore += entry.tagData?.confidence === 'high' ? 10 : 6;
    }
  }

  if (basis.length === 0 && clauses.length > 0) {
    basis.push('Keyword match in catalog search text');
  }

  if (entry.tagData && basis.some(reason => reason.startsWith('Subject tag:') || reason.startsWith('Category tag:') || reason.startsWith('Age group:') || reason.startsWith('Category:'))) {
    basis.push(`Tag source: ${entry.tagData.source} (${entry.tagData.confidence})`);
  }

  return {
    matchConfidence: basis.length > 0 ? confidence : undefined,
    matchBasis: basis.slice(0, 4),
    matchScore,
    matchedClauses: Array.from(matchedClauses),
  };
}

function interleaveRowsByClause<T extends { matchInfo: { matchedClauses: string[] } }>(rows: T[], clauseOrder: string[]): T[] {
  const clauseBuckets = new Map(clauseOrder.map(clause => [normalizeValue(clause), [] as T[]]));
  const fallback: T[] = [];

  for (const row of rows) {
    const matchedClause = row.matchInfo.matchedClauses.find(clause => clauseBuckets.has(normalizeValue(clause)));
    if (!matchedClause) {
      fallback.push(row);
      continue;
    }
    clauseBuckets.get(normalizeValue(matchedClause))?.push(row);
  }

  const interleaved: T[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const clause of clauseOrder) {
      const bucket = clauseBuckets.get(normalizeValue(clause));
      if (bucket && bucket.length > 0) {
        interleaved.push(bucket.shift()!);
        added = true;
      }
    }
  }

  return [...interleaved, ...fallback];
}

function matchesOptionValue(candidate: string | undefined, filterValue: string): boolean {
  if (!candidate) return false;
  const normalizedCandidate = normalizeValue(candidate);
  const normalizedFilter = normalizeValue(filterValue);
  if (!normalizedFilter) return false;
  return (
    normalizeTokenKey(candidate) === normalizeTokenKey(filterValue) ||
    normalizedCandidate.includes(normalizedFilter) ||
    normalizedFilter.includes(normalizedCandidate)
  );
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en', { sensitivity: 'base' });
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

export function resolveWorkspaceOption(rawValue: string | undefined, options: string[]): string | undefined {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) return undefined;

  const exact = options.find(option => normalizeTokenKey(option) === normalizeTokenKey(trimmed));
  if (exact) return exact;

  const substring = options.find(option => normalizeValue(option).includes(normalizeValue(trimmed)) || normalizeValue(trimmed).includes(normalizeValue(option)));
  if (substring) return substring;

  return undefined;
}

export function buildWorkspaceSearchRow(
  entry: CatalogEntry,
  catalog: Pick<MasterCatalog, 'distributors' | 'publisherDistributors'>
): WorkspaceSearchRow {
  const assignmentKey = getPublisherAssignmentKey(entry);
  const distributorIds = [...(catalog.publisherDistributors[assignmentKey] || [])];
  const distributors = getDistributorNames(catalog, assignmentKey);
  const missing = getMissingFields(entry);
  const currentStock = Number(entry.currentStock || 0);

  return {
    isbn: entry.isbn,
    name: entry.name,
    author: entry.author,
    publisher: entry.publisher,
    ...(entry.imprint ? { imprint: entry.imprint } : {}),
    ...(entry.parentPublisher ? { parentPublisher: entry.parentPublisher } : {}),
    assignmentKey,
    distributorIds,
    distributors,
    distributorMapped: distributors.length > 0,
    currentStock,
    ...(entry.mrp !== undefined ? { mrp: entry.mrp } : {}),
    ...(entry.sellingPrice !== undefined ? { sellingPrice: entry.sellingPrice } : {}),
    qtySold: entry.qtySold,
    revenue: entry.revenue,
    ...(entry.language ? { language: entry.language } : {}),
    ...(entry.tagData?.ageGroup ? { ageGroup: entry.tagData.ageGroup } : {}),
    categories: entry.tagData?.categories || [],
    subjects: entry.tagData?.subjects || [],
    ...(entry.tagData?.source ? { tagSource: entry.tagData.source } : {}),
    ...(entry.tagData?.confidence ? { tagConfidence: entry.tagData.confidence } : {}),
    missing,
    cleanupReady: !missing.author && !missing.publisher && !missing.tags && entry.publisher !== 'Unknown Publisher',
    matchBasis: [],
  };
}

export function searchWorkspace(
  catalog: MasterCatalog,
  filters: WorkspaceFilters = {}
): WorkspaceSearchRow[] {
  const rows = Object.values(catalog.entries)
    .filter(isBookEntry)
    .map(entry => ({ entry, row: buildWorkspaceSearchRow(entry, catalog) }))
    .filter(({ entry, row }) => {
      const searchText = buildCatalogSearchText(entry);
      const authorPhrases = buildEntryAuthorPhrases(entry);
      const themePhrases = buildEntryThemePhrases(entry);

      if (filters.onlyRevenue && row.revenue <= 0) return false;

      if (filters.authorQuery && !matchesPhraseSet(authorPhrases, filters.authorQuery)) {
        return false;
      }

      if ((filters.authorQueryAny || []).length > 0 && !filters.authorQueryAny!.some(queryClause => matchesPhraseSet(authorPhrases, queryClause))) {
        return false;
      }

      if (filters.themeQuery && !matchesPhraseSet(themePhrases, filters.themeQuery)) {
        return false;
      }

      if ((filters.themeQueryAny || []).length > 0 && !filters.themeQueryAny!.some(queryClause => matchesPhraseSet(themePhrases, queryClause))) {
        return false;
      }

      if (filters.query && !matchesTokenSet(searchText, filters.query)) {
        return false;
      }

      if ((filters.queryAny || []).length > 0 && !filters.queryAny!.some(queryClause => matchesTokenSet(searchText, queryClause))) {
        return false;
      }

      if (filters.publisher) {
        const candidates = [
          row.publisher,
          row.imprint,
          row.parentPublisher,
          row.assignmentKey,
        ].filter(Boolean) as string[];
        if (!candidates.some(candidate => matchesOptionValue(candidate, filters.publisher!))) {
          return false;
        }
      }

      if (filters.distributor) {
        if (!row.distributors.some(distributor => matchesOptionValue(distributor, filters.distributor!))) {
          return false;
        }
      }

      if (filters.ageGroup && row.ageGroup !== filters.ageGroup) {
        return false;
      }

      if ((filters.ageGroupsAny || []).length > 0 && (!row.ageGroup || !filters.ageGroupsAny!.includes(row.ageGroup))) {
        return false;
      }

      if (filters.category && !row.categories.some(category => normalizeTokenKey(category) === normalizeTokenKey(filters.category))) {
        return false;
      }

      const stockMode = filters.stock || 'all';
      if (stockMode === 'in' && row.currentStock <= 0) return false;
      if (stockMode === 'out' && row.currentStock > 0) return false;
      if (stockMode === 'low' && (row.currentStock <= 0 || row.currentStock > 5)) return false;
      if (typeof filters.stockMin === 'number' && row.currentStock < filters.stockMin) return false;
      if (typeof filters.stockMax === 'number' && row.currentStock > filters.stockMax) return false;

      const mappedMode = filters.mapped || 'all';
      if (mappedMode === 'mapped' && !row.distributorMapped) return false;
      if (mappedMode === 'unmapped' && row.distributorMapped) return false;

      const cleanupMode = filters.cleanup || 'all';
      if (cleanupMode === 'clean' && !row.cleanupReady) return false;
      if (cleanupMode === 'needs-attention' && row.cleanupReady) return false;

      const missingFilters = filters.missing || [];
      if (missingFilters.length > 0) {
        for (const field of missingFilters) {
          if (!row.missing[field]) return false;
        }
      }

      return true;
    });

  const enrichedRows = rows.map(({ entry, row }) => ({
    entry,
    row,
    matchInfo: buildMatchInfo(entry, filters),
  }));
  const sort = filters.sort || 'revenue_desc';
  const hasSemanticIntent = Boolean(
    filters.authorQuery ||
    (filters.authorQueryAny || []).length > 0 ||
    filters.themeQuery ||
    (filters.themeQueryAny || []).length > 0 ||
    filters.query ||
    (filters.queryAny || []).length > 0 ||
    filters.ageGroup ||
    (filters.ageGroupsAny || []).length > 0 ||
    filters.category
  );
  const disjunctiveClauses = uniqueStrings([
    ...(filters.authorQueryAny || []),
    ...(filters.themeQueryAny || []),
    ...(filters.queryAny || []),
  ]);

  enrichedRows.sort((left, right) => {
    if (sort === 'stock_asc') {
      return compareNumbers(left.row.currentStock, right.row.currentStock) || compareNumbers(right.row.revenue, left.row.revenue);
    }
    if (sort === 'stock_desc') {
      return compareNumbers(right.row.currentStock, left.row.currentStock) || compareNumbers(right.row.revenue, left.row.revenue);
    }
    if (sort === 'sales_desc') {
      return compareNumbers(right.row.qtySold, left.row.qtySold) || compareNumbers(right.row.revenue, left.row.revenue);
    }
    if (sort === 'sales_asc') {
      return compareNumbers(left.row.qtySold, right.row.qtySold) || compareNumbers(right.row.revenue, left.row.revenue);
    }
    if (sort === 'title_asc') {
      return compareStrings(left.row.name, right.row.name) || compareNumbers(right.row.revenue, left.row.revenue);
    }
    if (hasSemanticIntent) {
      return compareNumbers(right.matchInfo.matchScore, left.matchInfo.matchScore) ||
        compareNumbers(right.row.revenue, left.row.revenue) ||
        compareNumbers(right.row.qtySold, left.row.qtySold);
    }
    return compareNumbers(right.row.revenue, left.row.revenue) || compareNumbers(left.row.currentStock, right.row.currentStock);
  });

  const orderedRows = hasSemanticIntent && disjunctiveClauses.length > 1 && sort === 'revenue_desc'
    ? interleaveRowsByClause(enrichedRows, disjunctiveClauses)
    : enrichedRows;

  return orderedRows
    .slice(0, Math.max(1, filters.limit || 200))
    .map(({ row, matchInfo }) => ({
      ...row,
      ...matchInfo,
    }));
}

export function buildWorkspaceMeta(catalog: MasterCatalog): WorkspaceMeta {
  const bookEntries = Object.values(catalog.entries).filter(isBookEntry);
  const publisherKeys = new Set<string>();
  const mappedPublisherKeys = new Set<string>();
  const distributorNames = new Set<string>();

  for (const entry of bookEntries) {
    if (entry.publisher === 'Unknown Publisher') continue;
    const key = getPublisherAssignmentKey(entry);
    if (!key) continue;
    publisherKeys.add(key);
    const names = getDistributorNames(catalog, key);
    if (names.length > 0) {
      mappedPublisherKeys.add(key);
      names.forEach(name => distributorNames.add(name));
    }
  }

  return {
    summary: {
      books: bookEntries.length,
      complete: bookEntries.filter(entry => {
        const missing = getMissingFields(entry);
        return !missing.author && !missing.publisher && !missing.tags;
      }).length,
      mappedPublishers: mappedPublisherKeys.size,
      unmappedPublishers: publisherKeys.size - mappedPublisherKeys.size,
      revenueBooks: bookEntries.filter(entry => entry.revenue > 0).length,
    },
    lastBuilt: catalog.lastBuilt,
    sourceFiles: catalog.sourceFiles,
    publishers: Array.from(publisherKeys).sort(compareStrings),
    distributors: Array.from(distributorNames).sort(compareStrings),
    ageGroups: Array.from(new Set(bookEntries.map(entry => entry.tagData?.ageGroup).filter(Boolean) as string[])).sort(compareStrings),
    categories: Array.from(new Set(bookEntries.flatMap(entry => entry.tagData?.categories || []).filter(Boolean))).sort(compareStrings),
    nlMode: process.env.OPENAI_API_KEY ? 'openai' : 'heuristic',
  };
}

export function buildWorkspaceOrderDraft(
  catalog: MasterCatalog,
  items: WorkspaceOrderItemInput[],
  options?: { title?: string; notes?: string }
): WorkspaceOrderDraft {
  const distributorLookup = new Map((catalog.distributors || []).map(distributor => [distributor.id, distributor.name]));
  const groups = new Map<string, WorkspaceOrderDraftGroup>();

  for (const item of items) {
    const entry = catalog.entries[item.isbn];
    if (!entry || !isBookEntry(entry)) continue;
    const quantity = Math.max(0, Math.round(item.quantity || 0));
    if (quantity <= 0) continue;

    const assignmentKey = getPublisherAssignmentKey(entry);
    const availableDistributorIds = catalog.publisherDistributors[assignmentKey] || [];
    const selectedDistributorIds = (item.distributorIds || []).filter(distributorId => availableDistributorIds.includes(distributorId));
    const targetDistributorIds = availableDistributorIds.length === 0
      ? []
      : (selectedDistributorIds.length > 0 ? selectedDistributorIds : [availableDistributorIds[0]]);

    if (targetDistributorIds.length === 0) {
      const groupKey = `unmapped:${assignmentKey}`;
      const currentGroup = groups.get(groupKey) || {
        groupKey,
        assignmentKeys: [],
        items: [],
      };

      if (!currentGroup.assignmentKeys.includes(assignmentKey)) {
        currentGroup.assignmentKeys.push(assignmentKey);
      }

      currentGroup.items.push({
        isbn: entry.isbn,
        title: entry.name,
        author: entry.author,
        publisher: entry.publisher,
        assignmentKey,
        quantity,
        currentStock: Number(entry.currentStock || 0),
        qtySold: entry.qtySold,
        revenue: entry.revenue,
      });

      groups.set(groupKey, currentGroup);
      continue;
    }

    for (const distributorId of targetDistributorIds) {
      const distributorName = distributorLookup.get(distributorId) || distributorId;
      const groupKey = `distributor:${distributorName}`;
      const currentGroup = groups.get(groupKey) || {
        groupKey,
        distributorName,
        assignmentKeys: [],
        items: [],
      };

      if (!currentGroup.assignmentKeys.includes(assignmentKey)) {
        currentGroup.assignmentKeys.push(assignmentKey);
      }

      currentGroup.items.push({
        isbn: entry.isbn,
        title: entry.name,
        author: entry.author,
        publisher: entry.publisher,
        assignmentKey,
        quantity,
        currentStock: Number(entry.currentStock || 0),
        qtySold: entry.qtySold,
        revenue: entry.revenue,
      });

      groups.set(groupKey, currentGroup);
    }
  }

  const createdAt = new Date().toISOString();
  return {
    id: createdAt.replace(/[:.]/g, '-'),
    title: options?.title?.trim() || `Order Draft ${createdAt.slice(0, 10)}`,
    createdAt,
    ...(options?.notes?.trim() ? { notes: options.notes.trim() } : {}),
    groups: Array.from(groups.values()).sort((left, right) => compareStrings(left.distributorName || left.groupKey, right.distributorName || right.groupKey)),
  };
}
