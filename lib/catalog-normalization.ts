import {
  CatalogEntry,
  MetadataSource,
  SearchAliases,
  TagData,
} from './catalog-types';
import { cleanPublisherName, getKnownPublishers, isKnownPublisherAlias } from './publisher-cleaner';

type AliasField = keyof SearchAliases;

const AUTHOR_PLACEHOLDERS = new Set([
  'nill',
  'nil',
  'tbc',
  'to be confirmed',
]);

const RAW_BRAND_PLACEHOLDERS = new Set([
  'not found',
  'unknown',
  'n/a',
  'na',
  'second hand publisher',
]);

const TITLE_VARIANT_NOISE_PATTERNS = [
  /\bpaperback\b/i,
  /\bhardback\b/i,
  /\bhardcover\b/i,
  /\bboard book\b/i,
  /\bedition\b/i,
  /\bseries\b/i,
  /\bvol(?:ume)?\b/i,
  /\bbook\s+\d+\b/i,
  /\bjan\s+\d{1,2},\s+\d{4}\b/i,
  /\bby\s+[\p{L}]/iu,
  /\[[^\]]+\]/,
];

const PUBLISHER_LEGAL_SUFFIXES = [
  'books llp',
  'llp',
  'llc',
  'pty limited',
  'private limited',
  'limited',
  'ltd',
  'pvt ltd',
  'pvt. ltd',
  'pvt.ltd',
  'india',
];

const PUBLISHER_COMPANY_WORDS = new Set([
  'books',
  'book',
  'publishing',
  'publication',
  'publications',
  'press',
  'media',
  'house',
  'india',
  'group',
  'editions',
  'llp',
  'llc',
  'ltd',
  'private',
  'limited',
  'pvt',
  'enterprise',
  'enterprises',
  'studio',
  'studios',
  'creations',
]);

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeQuotes(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function normalizeSpacing(value: string): string {
  return collapseWhitespace(
    normalizeQuotes(value)
      .replace(/\s+,/g, ',')
      .replace(/,\s*/g, ', ')
      .replace(/\s+:/g, ':')
      .replace(/\s*\/\s*/g, ' / ')
      .replace(/"{2,}/g, '"')
      .replace(/'{2,}/g, "'")
  );
}

function aliasKey(value: string): string {
  return collapseWhitespace(normalizeQuotes(value)).toLowerCase();
}

const KNOWN_PUBLISHER_KEYS = new Set(getKnownPublishers().map(value => aliasKey(value)));

function normalizePublisherToken(value: string): string {
  return aliasKey(value)
    .replace(/\(india\)/g, ' india ')
    .replace(/[.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanupPublisherInput(value: string): string {
  return collapseWhitespace(
    normalizeQuotes(value)
      .replace(/\s*\/\s*/g, ' / ')
      .replace(/\(india\)/gi, ' India ')
      .replace(/\s+,/g, ',')
      .replace(/,\s*/g, ', ')
  );
}

function isAllUpperOrLower(value: string): boolean {
  const letters = Array.from(value).filter(char => /\p{L}/u.test(char));
  if (letters.length === 0) return false;

  const joined = letters.join('');
  return joined === joined.toUpperCase() || joined === joined.toLowerCase();
}

function looksLikeAuthorFragment(value: string): boolean {
  const cleaned = cleanAuthorName(value);
  if (!cleaned) return false;

  const words = cleaned
    .split(/[\s,]+/)
    .map(word => word.replace(/[^\p{L}.'’-]/gu, ''))
    .filter(Boolean);

  if (words.length === 0 || words.length > 8) return false;
  if (words.some(word => /\d/.test(word))) return false;
  if (words.some(word => PUBLISHER_COMPANY_WORDS.has(word.toLowerCase()))) return false;

  return true;
}

function rawBrandRightSideLooksPublisherish(value: string, publisherHint?: string): boolean {
  const cleaned = cleanupPublisherInput(value);
  if (!cleaned) return false;

  const lower = aliasKey(cleaned);
  if (RAW_BRAND_PLACEHOLDERS.has(lower)) return true;

  if (publisherHint && publisherHint !== 'Unknown Publisher') {
    const hintKey = aliasKey(publisherHint);
    if (lower.includes(hintKey) || hintKey.includes(lower)) {
      return true;
    }
  }

  if (cleanPublisherName(cleaned) !== 'Unknown Publisher') return true;

  return looksLikeTrustedPublisherLabel(cleaned, publisherHint || '');
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  if (/^\p{L}\.?$/u.test(word)) return word.toUpperCase();

  const lower = word.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCaseName(value: string): string {
  return value.replace(/\p{L}[\p{L}'’.:-]*/gu, match => {
    if (match.includes('.')) {
      return match
        .split('.')
        .map(part => titleCaseWord(part))
        .join('.');
    }

    if (match.includes('-')) {
      return match
        .split('-')
        .map(part => titleCaseWord(part))
        .join('-');
    }

    if (match.includes("'")) {
      return match
        .split("'")
        .map(part => titleCaseWord(part))
        .join("'");
    }

    return titleCaseWord(match);
  });
}

function createEmptyAliases(): SearchAliases {
  return {
    titles: [],
    authors: [],
    publishers: [],
  };
}

function isLikelyPersonPrefix(prefix: string): boolean {
  const words = prefix
    .split(/\s+/)
    .map(word => word.replace(/[^\p{L}'-]/gu, ''))
    .filter(Boolean);

  if (words.length < 2 || words.length > 5) return false;
  if (words.some(word => PUBLISHER_COMPANY_WORDS.has(word.toLowerCase()))) return false;

  return words.every(word => /^[\p{Lu}][\p{L}'-]*$/u.test(word));
}

function suffixIsOnlyLegalNoise(suffix: string): boolean {
  if (!suffix.trim()) return true;

  const cleaned = normalizePublisherToken(suffix);
  if (!cleaned) return true;

  const words = cleaned.split(/\s+/);
  return words.every(word => PUBLISHER_LEGAL_SUFFIXES.includes(word) || PUBLISHER_COMPANY_WORDS.has(word));
}

function looksLikeTrustedPublisherLabel(rawValue: string, canonicalPublisher: string): boolean {
  if (!rawValue.trim() || canonicalPublisher === 'Unknown Publisher') return false;
  if (isKnownPublisherAlias(rawValue)) return true;
  if (KNOWN_PUBLISHER_KEYS.has(aliasKey(canonicalPublisher))) return true;

  const words = normalizePublisherToken(rawValue).split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  const lastWord = words[words.length - 1];
  if (lastWord === 'india') {
    return words.length > 1;
  }

  return PUBLISHER_COMPANY_WORDS.has(lastWord);
}

function isAmbiguousPublisherComposite(rawValue: string, canonicalPublisher: string): boolean {
  const cleanedRaw = cleanupPublisherInput(rawValue);
  const rawLower = cleanedRaw.toLowerCase();
  const canonicalLower = canonicalPublisher.toLowerCase();

  if (!rawLower.includes(canonicalLower)) return false;
  if (rawLower === canonicalLower || rawLower.startsWith(canonicalLower)) return false;

  const publisherIndex = rawLower.indexOf(canonicalLower);
  if (publisherIndex <= 0) return false;

  const prefix = cleanedRaw.slice(0, publisherIndex).trim();
  const suffix = cleanedRaw.slice(publisherIndex + canonicalPublisher.length).trim();

  return isLikelyPersonPrefix(prefix) && suffixIsOnlyLegalNoise(suffix);
}

function findEmbeddedPublisherCanonical(rawValue: string): string | undefined {
  const words = cleanupPublisherInput(rawValue).split(/\s+/).filter(Boolean);
  if (words.length < 3) return undefined;

  for (let start = 1; start < words.length - 1; start++) {
    const candidate = words.slice(start).join(' ');
    const canonical = cleanPublisherName(candidate);
    if (canonical === 'Unknown Publisher') continue;
    if (aliasKey(canonical) === aliasKey(candidate)) continue;
    if (normalizePublisherToken(candidate).includes(normalizePublisherToken(canonical))) {
      return canonical;
    }
  }

  return undefined;
}

export function cleanAuthorName(rawValue: string | null | undefined): string {
  if (!rawValue) return '';

  let cleaned = normalizeSpacing(String(rawValue))
    .replace(/^Author\s*[-:]\s*/i, '')
    .replace(/^Authors?\s*:\s*/i, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();

  if (!cleaned) return '';

  if (AUTHOR_PLACEHOLDERS.has(cleaned.toLowerCase())) {
    return '';
  }

  if (isAllUpperOrLower(cleaned)) {
    cleaned = titleCaseName(cleaned);
  }

  return cleaned;
}

export function inferAuthorFromRawBrand(
  rawBrand: string | null | undefined,
  publisherHint?: string
): string {
  if (!rawBrand) return '';

  const cleanedRaw = cleanupPublisherInput(String(rawBrand));
  if (!cleanedRaw) return '';

  if (/^Author[-\s:]/i.test(cleanedRaw)) {
    const authorPart = cleanedRaw.split(' / ')[0].trim();
    return cleanAuthorName(authorPart);
  }

  if (!cleanedRaw.includes(' / ')) return '';

  const [left, ...rest] = cleanedRaw.split(' / ').map(part => part.trim()).filter(Boolean);
  if (!left || rest.length === 0) return '';

  const authorCandidate = cleanAuthorName(left);
  if (!looksLikeAuthorFragment(authorCandidate)) return '';

  const right = rest.join(' / ');
  if (!rawBrandRightSideLooksPublisherish(right, publisherHint)) return '';

  return authorCandidate;
}

export function inferPublisherFromRawBrand(rawBrand: string | null | undefined): string {
  if (!rawBrand) return 'Unknown Publisher';

  const cleanedRaw = cleanupPublisherInput(String(rawBrand));
  if (!cleanedRaw) return 'Unknown Publisher';

  const candidates: string[] = [];
  if (cleanedRaw.includes(' / ')) {
    const parts = cleanedRaw.split(' / ').map(part => part.trim()).filter(Boolean);
    const rightSide = parts[parts.length - 1];
    if (rightSide) candidates.push(rightSide);
  }
  candidates.push(cleanedRaw);

  for (const candidate of candidates) {
    if (!candidate || RAW_BRAND_PLACEHOLDERS.has(aliasKey(candidate))) continue;

    const normalized = cleanPublisherNameForWrite(candidate);
    if (normalized.reviewCanonical) return normalized.reviewCanonical;
    if (normalized.value !== 'Unknown Publisher') return normalized.value;
  }

  return 'Unknown Publisher';
}

export function inferPublisherFromSearchAliases(entry: Pick<CatalogEntry, 'publisher' | 'searchAliases'>): string {
  if (entry.publisher && entry.publisher !== 'Unknown Publisher' && entry.publisher !== 'Not found') {
    return entry.publisher;
  }

  const candidates = new Set<string>();
  for (const alias of entry.searchAliases?.publishers || []) {
    const normalized = cleanPublisherNameForWrite(alias);
    if (normalized.reviewCanonical) {
      candidates.add(normalized.reviewCanonical);
      continue;
    }
    if (normalized.value && normalized.value !== 'Unknown Publisher') {
      candidates.add(normalized.value);
    }
  }

  return candidates.size === 1 ? Array.from(candidates)[0] : 'Unknown Publisher';
}

export function cleanTitleName(rawValue: string | null | undefined): string {
  if (!rawValue) return '';

  return collapseWhitespace(
    normalizeQuotes(String(rawValue))
      .replace(/\s+:/g, ':')
      .replace(/\s+,/g, ',')
      .replace(/,\s*/g, ', ')
      .replace(/\s*\/\s*/g, ' / ')
  );
}

export function normalizeTitleForComparison(value: string | null | undefined): string {
  return cleanTitleName(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^0-9\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titlesAgree(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftNormalized = normalizeTitleForComparison(left);
  const rightNormalized = normalizeTitleForComparison(right);

  return Boolean(leftNormalized) && leftNormalized === rightNormalized;
}

function stripTitleVariantNoise(value: string): string {
  return cleanTitleName(value)
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]*edition[^)]*\)/gi, ' ')
    .replace(/\b(?:paperback|hardback|hardcover|board book)\b/gi, ' ')
    .replace(/\b(?:edition|series|volume|vol\.?|book)\b\s*[\w-]*/gi, ' ')
    .replace(/\bby\s+[\p{L}][\p{L} .,'’-]*/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let i = 0; i < left.length; i++) {
    current[0] = i + 1;
    for (let j = 0; j < right.length; j++) {
      const substitution = previous[j] + (left[i] === right[j] ? 0 : 1);
      const insertion = current[j] + 1;
      const deletion = previous[j + 1] + 1;
      current[j + 1] = Math.min(substitution, insertion, deletion);
    }

    for (let j = 0; j < current.length; j++) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared++;
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : shared / union;
}

export function classifyTitleSuggestion(
  currentTitle: string | null | undefined,
  suggestedTitle: string | null | undefined
): 'likely-typo' | 'source-variant' {
  const current = cleanTitleName(currentTitle);
  const suggested = cleanTitleName(suggestedTitle);
  if (!current || !suggested) return 'source-variant';

  const hasNoise = TITLE_VARIANT_NOISE_PATTERNS.some(pattern => pattern.test(suggested));
  const strippedCurrent = normalizeTitleForComparison(stripTitleVariantNoise(current));
  const strippedSuggested = normalizeTitleForComparison(stripTitleVariantNoise(suggested));
  if (!strippedCurrent || !strippedSuggested) return hasNoise ? 'source-variant' : 'likely-typo';

  if (strippedCurrent === strippedSuggested) {
    return hasNoise ? 'source-variant' : 'likely-typo';
  }

  const distance = levenshteinDistance(strippedCurrent, strippedSuggested);
  const maxLength = Math.max(strippedCurrent.length, strippedSuggested.length);
  const overlap = tokenOverlap(strippedCurrent, strippedSuggested);
  const similarLength = Math.abs(strippedCurrent.length - strippedSuggested.length) <= 8;
  const likelyTypo = distance <= Math.max(3, Math.floor(maxLength * 0.12));

  if ((likelyTypo && similarLength) || overlap >= 0.8) {
    return hasNoise ? 'source-variant' : 'likely-typo';
  }

  return 'source-variant';
}

export function cleanPublisherNameForWrite(
  rawValue: string | null | undefined
): { value: string; reviewCanonical?: string } {
  if (!rawValue) {
    return { value: 'Unknown Publisher' };
  }

  const prepared = cleanupPublisherInput(rawValue);
  const canonical = cleanPublisherName(prepared);
  if (canonical === 'Unknown Publisher') {
    return { value: canonical };
  }

  if (isKnownPublisherAlias(prepared)) {
    return { value: canonical };
  }

  if (prepared.includes(' / ')) {
    const tail = prepared.split(' / ').map(part => part.trim()).filter(Boolean).at(-1);
    if (tail) {
      const tailCanonical = cleanPublisherName(tail);
      if (looksLikeTrustedPublisherLabel(tail, tailCanonical)) {
        return { value: tailCanonical };
      }
    }
  }

  if (prepared.includes(' / ') && KNOWN_PUBLISHER_KEYS.has(aliasKey(canonical))) {
    return { value: canonical };
  }

  if (isAmbiguousPublisherComposite(prepared, canonical)) {
    return {
      value: prepared,
      reviewCanonical: canonical,
    };
  }

  const embeddedCanonical = aliasKey(canonical) === aliasKey(prepared)
    ? findEmbeddedPublisherCanonical(prepared)
    : undefined;
  if (embeddedCanonical && isAmbiguousPublisherComposite(prepared, embeddedCanonical)) {
    return {
      value: prepared,
      reviewCanonical: embeddedCanonical,
    };
  }

  return { value: canonical };
}

export function ensureSearchAliases(entry: CatalogEntry): SearchAliases {
  if (!entry.searchAliases) {
    entry.searchAliases = createEmptyAliases();
  }

  entry.searchAliases.titles = entry.searchAliases.titles || [];
  entry.searchAliases.authors = entry.searchAliases.authors || [];
  entry.searchAliases.publishers = entry.searchAliases.publishers || [];

  return entry.searchAliases;
}

export function addSearchAlias(
  entry: CatalogEntry,
  field: AliasField,
  value: string | null | undefined,
  canonicalValues: Array<string | null | undefined> = []
): void {
  if (!value) return;

  const cleanedValue = field === 'authors'
    ? cleanAuthorName(value)
    : field === 'publishers'
      ? cleanupPublisherInput(value)
      : cleanTitleName(value);

  if (!cleanedValue) return;

  const cleanedKey = aliasKey(cleanedValue);
  if (canonicalValues.some(current => current && aliasKey(current) === cleanedKey)) {
    return;
  }

  const aliases = ensureSearchAliases(entry)[field];
  if (aliases.some(existing => aliasKey(existing) === cleanedKey)) {
    return;
  }

  aliases.push(cleanedValue);
  if (aliases.length > 5) {
    aliases.splice(0, aliases.length - 5);
  }
}

export function setCanonicalAuthor(
  entry: CatalogEntry,
  nextAuthor: string | null | undefined,
  source: MetadataSource
): boolean {
  const cleanedAuthor = cleanAuthorName(nextAuthor);
  if (!cleanedAuthor) return false;

  addSearchAlias(entry, 'authors', nextAuthor, [entry.author]);
  if (entry.author && aliasKey(entry.author) !== aliasKey(cleanedAuthor)) {
    addSearchAlias(entry, 'authors', entry.author, [cleanedAuthor]);
  }

  if (aliasKey(entry.author) === aliasKey(cleanedAuthor)) {
    entry.author = cleanedAuthor;
    if (!entry.authorSource || entry.authorSource === 'inventory' || entry.authorSource === 'indian-stock') {
      entry.authorSource = source;
    }
    return false;
  }

  entry.author = cleanedAuthor;
  entry.authorSource = source;
  return true;
}

export function setCanonicalPublisher(
  entry: CatalogEntry,
  nextPublisher: string | null | undefined,
  source: MetadataSource
): { changed: boolean; reviewCanonical?: string } {
  const normalized = cleanPublisherNameForWrite(nextPublisher);
  const cleanedPublisher = normalized.value;
  if (!cleanedPublisher || cleanedPublisher === 'Unknown Publisher') {
    return { changed: false, reviewCanonical: normalized.reviewCanonical };
  }

  addSearchAlias(entry, 'publishers', nextPublisher, [entry.publisher]);
  if (entry.publisher && aliasKey(entry.publisher) !== aliasKey(cleanedPublisher)) {
    addSearchAlias(entry, 'publishers', entry.publisher, [cleanedPublisher]);
  }

  if (aliasKey(entry.publisher) === aliasKey(cleanedPublisher)) {
    entry.publisher = cleanedPublisher;
    if (!entry.publisherSource || entry.publisherSource === 'inventory' || entry.publisherSource === 'indian-stock') {
      entry.publisherSource = source;
    }
    return { changed: false, reviewCanonical: normalized.reviewCanonical };
  }

  entry.publisher = cleanedPublisher;
  entry.publisherSource = source;
  return { changed: true, reviewCanonical: normalized.reviewCanonical };
}

export function setCanonicalTitle(
  entry: CatalogEntry,
  nextTitle: string | null | undefined,
  source: MetadataSource | 'manual'
): boolean {
  const cleanedTitle = cleanTitleName(nextTitle);
  if (!cleanedTitle) return false;

  if (!entry.rawName) {
    entry.rawName = cleanTitleName(entry.name);
  }

  addSearchAlias(entry, 'titles', nextTitle, [entry.name, entry.rawName]);
  if (entry.name && aliasKey(entry.name) !== aliasKey(cleanedTitle)) {
    addSearchAlias(entry, 'titles', entry.name, [cleanedTitle, entry.rawName]);
  }

  if (titlesAgree(entry.name, cleanedTitle)) {
    entry.name = cleanedTitle;
    if (!entry.titleSource || entry.titleSource === 'inventory') {
      entry.titleSource = source;
    }
    return false;
  }

  entry.name = cleanedTitle;
  entry.titleSource = source;
  return true;
}

function hasEquivalentTitleAlias(entry: CatalogEntry, title: string): boolean {
  return (entry.searchAliases?.titles || []).some(alias => titlesAgree(alias, title));
}

export function applyTitleCandidate(
  entry: CatalogEntry,
  nextTitle: string | null | undefined,
  source: MetadataSource,
  options?: { authoritative?: boolean }
): boolean {
  const cleanedTitle = cleanTitleName(nextTitle);
  if (!cleanedTitle) return false;

  const hadPriorTrustedVariant = hasEquivalentTitleAlias(entry, cleanedTitle);
  addSearchAlias(entry, 'titles', cleanedTitle, [entry.name, entry.rawName]);

  if (options?.authoritative) {
    return setCanonicalTitle(entry, cleanedTitle, source);
  }

  if (titlesAgree(entry.name, cleanedTitle)) {
    if (!entry.titleSource || entry.titleSource === 'inventory') {
      entry.titleSource = source;
    }
    return false;
  }

  if (hadPriorTrustedVariant) {
    return setCanonicalTitle(entry, cleanedTitle, source);
  }

  return false;
}

export function sanitizeTagData(tagData: TagData | undefined): TagData | undefined {
  if (!tagData) return undefined;

  const subjectNoisePatterns = [
    /^nyt:/i,
    /^series:/i,
    /^open library staff picks$/i,
    /^staff picks$/i,
    /^new york times bestseller$/i,
    /^bestseller$/i,
    /^juvenile fiction\b/i,
    /^juvenile nonfiction\b/i,
    /^language materials?\b/i,
    /^accessible book$/i,
    /^protected daisy$/i,
    /^in library$/i,
    /^lending library$/i,
  ];

  const categoryKeys = new Set<string>();
  const categories: string[] = [];
  for (const category of tagData.categories) {
    const cleanedCategory = cleanTitleName(category);
    if (!cleanedCategory) continue;

    const key = aliasKey(cleanedCategory);
    if (categoryKeys.has(key)) continue;
    categoryKeys.add(key);
    categories.push(cleanedCategory);
    if (categories.length >= 4) break;
  }

  const subjectKeys = new Set<string>();
  const categorySet = new Set(categories.map(category => aliasKey(category)));
  const subjects: string[] = [];
  for (const subject of tagData.subjects) {
    const cleanedSubject = cleanTitleName(subject);
    if (!cleanedSubject) continue;
    if (subjectNoisePatterns.some(pattern => pattern.test(cleanedSubject))) continue;

    const key = aliasKey(cleanedSubject);
    if (categorySet.has(key) || subjectKeys.has(key)) continue;
    subjectKeys.add(key);
    subjects.push(cleanedSubject);
    if (subjects.length >= 8) break;
  }

  if (!tagData.ageGroup && categories.length === 0 && subjects.length === 0) {
    return undefined;
  }

  return {
    ...tagData,
    categories,
    subjects,
  };
}

export function getPublisherNormalizationSuggestion(entry: CatalogEntry): {
  publisher: string;
  confidence: 'high' | 'medium';
  reason: string;
} | null {
  if (!entry.publisher || entry.publisher === 'Unknown Publisher') return null;

  const normalized = cleanPublisherNameForWrite(entry.publisher);
  if (normalized.reviewCanonical) {
    return {
      publisher: normalized.reviewCanonical,
      confidence: 'medium',
      reason: 'Known publisher token found inside a composite publisher string',
    };
  }

  if (normalized.value !== entry.publisher) {
    return {
      publisher: normalized.value,
      confidence: 'high',
      reason: 'Deterministic normalization of a known publisher variant',
    };
  }

  return null;
}

export function getPublisherSuggestionAutofill(entry: CatalogEntry): {
  publisher: string;
  confidence: 'medium';
  reason: string;
} | null {
  if (!entry.publisher || entry.publisher !== 'Unknown Publisher') return null;
  if (!entry.suggestion?.publisher || entry.suggestion.source !== 'isbn-prefix') return null;
  if (entry.suggestion.confidence !== 'medium') return null;

  const rawBrand = aliasKey(entry.rawBrand);
  if (
    rawBrand &&
    !RAW_BRAND_PLACEHOLDERS.has(rawBrand) &&
    !rawBrand.includes('/ not found') &&
    !rawBrand.includes('/ unknown') &&
    !rawBrand.startsWith('author-')
  ) {
    return null;
  }

  return {
    publisher: entry.suggestion.publisher,
    confidence: 'medium',
    reason: 'Medium-confidence ISBN-prefix suggestion on a placeholder inventory publisher',
  };
}

export function getAuthorNormalizationSuggestion(entry: CatalogEntry): {
  author: string;
  confidence: 'high';
  reason: string;
} | null {
  if (!entry.author) return null;

  const cleanedAuthor = cleanAuthorName(entry.author);
  if (!cleanedAuthor || cleanedAuthor === entry.author) return null;

  return {
    author: cleanedAuthor,
    confidence: 'high',
    reason: 'Deterministic cleanup of author casing or prefix noise',
  };
}

export function getTitleNormalizationSuggestion(entry: CatalogEntry): {
  title: string;
  confidence: 'medium';
  reason: string;
} | null {
  const aliases = entry.searchAliases?.titles || [];
  const candidate = aliases.find(alias => !titlesAgree(alias, entry.name));
  if (!candidate) return null;

  return {
    title: candidate,
    confidence: 'medium',
    reason: 'Alternative title variant preserved from a trusted source',
  };
}

export function getTitleSuggestionKind(entry: CatalogEntry): 'likely-typo' | 'source-variant' | null {
  const suggestion = getTitleNormalizationSuggestion(entry);
  if (!suggestion) return null;

  return classifyTitleSuggestion(entry.name, suggestion.title);
}

export function getTagHygieneSuggestion(entry: CatalogEntry): TagData | null {
  if (!entry.tagData) return null;

  const sanitized = sanitizeTagData(entry.tagData);
  if (!sanitized) return null;

  return JSON.stringify(sanitized) === JSON.stringify(entry.tagData) ? null : sanitized;
}

export function normalizeCatalogEntry(entry: CatalogEntry): void {
  entry.name = cleanTitleName(entry.name);
  if (entry.rawName) {
    entry.rawName = cleanTitleName(entry.rawName);
  }
  if (!entry.rawName && entry.name) {
    entry.rawName = entry.name;
  }

  if (entry.author) {
    const cleanedAuthor = cleanAuthorName(entry.author);
    if (cleanedAuthor && cleanedAuthor !== entry.author) {
      addSearchAlias(entry, 'authors', entry.author, [cleanedAuthor]);
      entry.author = cleanedAuthor;
    }
  }

  if (!entry.author && entry.rawBrand) {
    const inferredAuthor = inferAuthorFromRawBrand(entry.rawBrand, entry.publisher);
    if (inferredAuthor) {
      entry.author = inferredAuthor;
      entry.authorSource = entry.authorSource || 'inventory';
    }
  }

  if (entry.publisher && entry.publisher !== 'Unknown Publisher') {
    const normalizedPublisher = cleanPublisherNameForWrite(entry.publisher);
    if (!normalizedPublisher.reviewCanonical && normalizedPublisher.value !== entry.publisher) {
      addSearchAlias(entry, 'publishers', entry.publisher, [normalizedPublisher.value]);
      entry.publisher = normalizedPublisher.value;
    }
  }

  if ((!entry.publisher || entry.publisher === 'Unknown Publisher') && entry.rawBrand) {
    const inferredPublisher = inferPublisherFromRawBrand(entry.rawBrand);
    if (inferredPublisher !== 'Unknown Publisher') {
      entry.publisher = inferredPublisher;
      entry.publisherSource = entry.publisherSource || 'inventory';
    }
  }

  if ((!entry.publisher || entry.publisher === 'Unknown Publisher') && entry.searchAliases?.publishers?.length) {
    const inferredPublisher = inferPublisherFromSearchAliases(entry);
    if (inferredPublisher !== 'Unknown Publisher') {
      entry.publisher = inferredPublisher;
      entry.publisherSource = entry.publisherSource || 'manual';
    }
  }

  if (entry.tagData) {
    entry.tagData = sanitizeTagData(entry.tagData);
  }

  if (entry.searchAliases) {
    entry.searchAliases.titles = entry.searchAliases.titles.filter(alias => aliasKey(alias) !== aliasKey(entry.name));
    entry.searchAliases.authors = entry.searchAliases.authors.filter(alias => aliasKey(alias) !== aliasKey(entry.author));
    entry.searchAliases.publishers = entry.searchAliases.publishers.filter(alias => aliasKey(alias) !== aliasKey(entry.publisher));

    if (
      entry.searchAliases.titles.length === 0 &&
      entry.searchAliases.authors.length === 0 &&
      entry.searchAliases.publishers.length === 0
    ) {
      delete entry.searchAliases;
    }
  }
}

export function buildCatalogSearchText(entry: CatalogEntry): string {
  const parts = [
    entry.isbn,
    entry.name,
    entry.rawName || '',
    entry.author,
    entry.publisher,
    entry.imprint || '',
    entry.parentPublisher || '',
    entry.language || '',
    ...(entry.searchAliases?.titles || []),
    ...(entry.searchAliases?.authors || []),
    ...(entry.searchAliases?.publishers || []),
    ...(entry.tagData?.categories || []),
    ...(entry.tagData?.subjects || []),
  ];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const part of parts) {
    const cleaned = collapseWhitespace(String(part || ''));
    if (!cleaned) continue;

    const key = aliasKey(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized.join(' | ');
}
