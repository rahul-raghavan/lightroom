import { CatalogEntry } from './catalog-types';
import { addSearchAlias, cleanPublisherNameForWrite, normalizeCatalogEntry } from './catalog-normalization';

export interface ImprintMappingRecord {
  imprint: string;
  parent: string;
  confidence?: 'high' | 'medium';
  note?: string;
}

export type PublisherFieldMode = 'keep-imprint' | 'use-parent';

function normalizeKey(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function trimValue(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function parseExplicitImprintLabel(
  publisher: string | null | undefined
): { imprint: string; parentPublisher: string } | null {
  const raw = trimValue(publisher);
  if (!raw) return null;

  const match = raw.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (!match) return null;

  const imprint = trimValue(match[1]);
  const parentPublisher = trimValue(match[2]);
  if (!imprint || !parentPublisher) return null;
  if (normalizeKey(imprint) === normalizeKey(parentPublisher)) return null;

  return { imprint, parentPublisher };
}

export function getPublisherAssignmentKey(entry: Pick<CatalogEntry, 'publisher' | 'parentPublisher'>): string {
  return trimValue(entry.parentPublisher) || entry.publisher;
}

export function syncStructuredPublisherFields(entry: CatalogEntry): boolean {
  let changed = false;
  const parsed = parseExplicitImprintLabel(entry.publisher);
  if (parsed) {
    addSearchAlias(entry, 'publishers', entry.publisher, [parsed.imprint, parsed.parentPublisher]);
    if (entry.publisher !== parsed.imprint) {
      entry.publisher = parsed.imprint;
      changed = true;
    }
    if (entry.imprint !== parsed.imprint) {
      entry.imprint = parsed.imprint;
      changed = true;
    }
    if (entry.parentPublisher !== parsed.parentPublisher) {
      entry.parentPublisher = parsed.parentPublisher;
      changed = true;
    }
  } else {
    const imprint = trimValue(entry.imprint);
    const parentPublisher = trimValue(entry.parentPublisher);
    const normalizedImprint = imprint || undefined;
    const normalizedParentPublisher = parentPublisher || undefined;
    if (normalizedImprint !== entry.imprint) {
      entry.imprint = normalizedImprint;
      changed = true;
    }
    if (normalizedParentPublisher !== entry.parentPublisher) {
      entry.parentPublisher = normalizedParentPublisher;
      changed = true;
    }
  }

  if (entry.parentPublisher && normalizeKey(entry.parentPublisher) === normalizeKey(entry.publisher)) {
    delete entry.parentPublisher;
    changed = true;
  }
  if (entry.imprint && normalizeKey(entry.imprint) === normalizeKey(entry.publisher)) {
    entry.imprint = entry.publisher;
  }

  return changed;
}

export function applyImprintMappingToEntry(
  entry: CatalogEntry,
  mapping: Pick<ImprintMappingRecord, 'imprint' | 'parent'>,
  options?: { publisherFieldMode?: PublisherFieldMode }
): boolean {
  const publisherFieldMode = options?.publisherFieldMode || 'keep-imprint';
  const imprint = trimValue(mapping.imprint);
  const parentPublisher = trimValue(mapping.parent);
  if (!imprint || !parentPublisher || entry.publisher === 'Unknown Publisher') return false;

  const oldPublisher = entry.publisher;
  let changed = false;

  if (entry.imprint !== imprint) {
    entry.imprint = imprint;
    changed = true;
  }
  if (entry.parentPublisher !== parentPublisher) {
    entry.parentPublisher = parentPublisher;
    changed = true;
  }

  const nextPublisher = publisherFieldMode === 'use-parent' ? parentPublisher : imprint;
  if (oldPublisher !== nextPublisher) {
    addSearchAlias(entry, 'publishers', oldPublisher, [nextPublisher, parentPublisher, imprint]);
    entry.publisher = nextPublisher;
    changed = true;
  }

  normalizeCatalogEntry(entry);
  return changed;
}

export function applyKnownImprintMappings(
  entries: Iterable<CatalogEntry>,
  mappings: ImprintMappingRecord[],
  options?: { publisherFieldMode?: PublisherFieldMode }
): number {
  const mappingByImprint = new Map<string, ImprintMappingRecord>();
  for (const mapping of mappings) {
    const key = normalizeKey(mapping.imprint);
    if (!key) continue;
    mappingByImprint.set(key, mapping);
  }

  let changed = 0;
  for (const entry of entries) {
    const hadStructuredChange = syncStructuredPublisherFields(entry);
    const candidateKeys = new Set<string>();
    const directKey = normalizeKey(entry.imprint || entry.publisher);
    if (directKey) candidateKeys.add(directKey);

    const normalizedPublisher = cleanPublisherNameForWrite(entry.publisher);
    const reviewKey = normalizeKey(normalizedPublisher.reviewCanonical);
    if (reviewKey) candidateKeys.add(reviewKey);

    const slashTail = trimValue(entry.publisher).split(' / ').map(part => trimValue(part)).filter(Boolean).at(-1);
    const slashTailKey = normalizeKey(slashTail);
    if (slashTailKey) candidateKeys.add(slashTailKey);

    const matchKey = Array.from(candidateKeys).find(key => mappingByImprint.has(key));
    const mapping = matchKey ? mappingByImprint.get(matchKey) : undefined;

    let entryChanged = hadStructuredChange;
    if (mapping) {
      const hasStructuredFields = Boolean(entry.imprint && entry.parentPublisher);
      if (
        !hasStructuredFields &&
        (!entry.parentPublisher || normalizeKey(entry.parentPublisher) === normalizeKey(mapping.parent))
      ) {
        entryChanged = applyImprintMappingToEntry(entry, mapping, options) || entryChanged;
      }
    } else if (hadStructuredChange) {
      normalizeCatalogEntry(entry);
    }

    if (entryChanged) changed++;
  }

  return changed;
}
