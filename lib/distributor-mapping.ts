import { getPublisherAssignmentKey } from './catalog-imprints';
import { MasterCatalog } from './catalog-types';
import { cleanPublisherName } from './publisher-cleaner';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const LEGACY_DISTRIBUTOR_KEY_ALIASES: Record<string, string> = {
  'AdiDev Press': 'Adidev Press',
  Barefoot: 'Barefoot Books',
  CBT: "Children's Book Trust",
  'Daffodil Lane': 'Daffdill Lane',
  'Flying Eye': 'Flying Eye Books',
  'Harper Collins': 'HarperCollins',
  Indigrow: 'Indagrow',
  'Jyotsana Prakashan': 'Jyotsna Prakashan',
  NBT: 'National Book Trust',
  Penguin: 'Penguin Random House',
  Pratham: 'Pratham Books',
  'Pan Macmillian': 'Pan Macmillan',
};

export interface DistributorMappingMigration {
  from: string;
  to: string;
}

export interface DistributorMappingReconciliation {
  changed: boolean;
  livePublisherKeys: string[];
  migratedKeys: DistributorMappingMigration[];
  mergedKeys: string[];
  unresolvedKeys: string[];
}

export interface ImportedDistributorMappingSummary {
  appliedMappings: number;
  createdDistributors: number;
  unresolvedPublishers: string[];
}

export interface SelfDistributorMappingResult {
  appliedKeys: string[];
}

function normalizeKey(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function trimKey(value: string | null | undefined): string {
  return String(value || '').trim();
}

function appendUnique(target: string[], values: string[]): boolean {
  let changed = false;
  for (const value of values) {
    const trimmed = trimKey(value);
    if (!trimmed || target.includes(trimmed)) continue;
    target.push(trimmed);
    changed = true;
  }
  return changed;
}

function slugifyDistributorId(name: string): string {
  return `dist_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

function parseDistributorMappingLabel(rawLabel: string): { label: string; parentHint?: string } {
  const trimmed = trimKey(rawLabel);
  const match = trimmed.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (!match) return { label: trimmed };
  return {
    label: trimKey(match[1]),
    parentHint: trimKey(match[2]),
  };
}

function readDistributorMappingRows(filePath: string): string[][] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') {
    const workbook = XLSX.read(fs.readFileSync(filePath, 'utf-8'), { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][];
  }

  const workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][];
}

function ensureDistributor(
  catalog: Pick<MasterCatalog, 'distributors'>,
  distributorName: string
): { id: string; created: boolean } {
  const trimmedName = trimKey(distributorName);
  const normalized = normalizeKey(trimmedName);
  const existing = catalog.distributors.find(distributor => normalizeKey(distributor.name) === normalized);
  if (existing) {
    return { id: existing.id, created: false };
  }

  const id = slugifyDistributorId(trimmedName);
  catalog.distributors.push({ id, name: trimmedName });
  return { id, created: true };
}

function resolveImportedPublisherKey(
  rawLabel: string,
  livePublisherKeys: string[]
): string | undefined {
  const parsed = parseDistributorMappingLabel(rawLabel);
  // Prefer the explicit imprint/label in sheets like "Nosy Crow (Harper Collins)".
  // Falling through to the raw label first can over-normalize to the parent before
  // we get a chance to match the live imprint key.
  const directCandidates = [parsed.label, rawLabel, parsed.parentHint].filter(Boolean) as string[];

  for (const candidate of directCandidates) {
    const resolved = resolveLivePublisherDistributorKey(candidate, livePublisherKeys);
    if (resolved) return resolved;
  }

  return undefined;
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function collectLivePublisherAssignmentKeys(catalog: Pick<MasterCatalog, 'entries'>): string[] {
  const keys = new Set<string>();
  for (const entry of Object.values(catalog.entries)) {
    if (entry.scope !== 'book') continue;
    if (entry.publisher === 'Unknown Publisher') continue;
    const key = trimKey(getPublisherAssignmentKey(entry));
    if (!key) continue;
    keys.add(key);
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

export function resolveLivePublisherDistributorKey(
  rawKey: string,
  livePublisherKeys: Iterable<string>
): string | undefined {
  const trimmed = trimKey(rawKey);
  if (!trimmed) return undefined;

  const liveKeys = Array.isArray(livePublisherKeys) ? livePublisherKeys : Array.from(livePublisherKeys);
  const liveSet = new Set(liveKeys);
  if (liveSet.has(trimmed)) return trimmed;

  const normalizedLive = new Map<string, string>();
  for (const key of liveKeys) {
    const normalized = normalizeKey(key);
    if (!normalized || normalizedLive.has(normalized)) continue;
    normalizedLive.set(normalized, key);
  }

  const candidates = [
    trimmed,
    LEGACY_DISTRIBUTOR_KEY_ALIASES[trimmed],
    cleanPublisherName(trimmed),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (liveSet.has(candidate)) return candidate;
  }

  for (const candidate of candidates) {
    const normalized = normalizeKey(candidate);
    const liveMatch = normalizedLive.get(normalized);
    if (liveMatch) return liveMatch;
  }

  return undefined;
}

export function reconcilePublisherDistributorMap(
  catalog: Pick<MasterCatalog, 'entries' | 'publisherDistributors'>
): DistributorMappingReconciliation {
  const livePublisherKeys = collectLivePublisherAssignmentKeys(catalog);
  const currentMap = catalog.publisherDistributors || {};
  const nextMap: Record<string, string[]> = {};
  const migratedKeys: DistributorMappingMigration[] = [];
  const mergedKeys = new Set<string>();
  const unresolvedKeys: string[] = [];
  let changed = false;

  for (const [rawKey, distributorIds] of Object.entries(currentMap)) {
    const trimmedKey = trimKey(rawKey);
    if (!trimmedKey) {
      if (distributorIds.length > 0) changed = true;
      continue;
    }

    const resolvedKey = resolveLivePublisherDistributorKey(trimmedKey, livePublisherKeys) || trimmedKey;
    const cleanedIds = distributorIds.map(trimKey).filter(Boolean);
    const target = nextMap[resolvedKey] || [];
    const hadTarget = resolvedKey in nextMap;
    const appended = appendUnique(target, cleanedIds);
    nextMap[resolvedKey] = target;

    if (resolvedKey !== trimmedKey) {
      migratedKeys.push({ from: trimmedKey, to: resolvedKey });
      changed = true;
    } else if (rawKey !== trimmedKey) {
      changed = true;
    }

    if (hadTarget && appended) {
      mergedKeys.add(resolvedKey);
      changed = true;
    }

    if (!livePublisherKeys.includes(resolvedKey)) {
      unresolvedKeys.push(resolvedKey);
    }
  }

  const currentKeys = Object.keys(currentMap).sort((a, b) => a.localeCompare(b));
  const nextKeys = Object.keys(nextMap).sort((a, b) => a.localeCompare(b));
  if (!changed) {
    if (!arraysEqual(currentKeys, nextKeys)) {
      changed = true;
    } else {
      changed = currentKeys.some(key => !arraysEqual(currentMap[key] || [], nextMap[key] || []));
    }
  }

  if (changed) {
    catalog.publisherDistributors = nextMap;
  }

  return {
    changed,
    livePublisherKeys,
    migratedKeys: migratedKeys.sort((a, b) => a.from.localeCompare(b.from)),
    mergedKeys: Array.from(mergedKeys).sort((a, b) => a.localeCompare(b)),
    unresolvedKeys: Array.from(new Set(unresolvedKeys)).sort((a, b) => a.localeCompare(b)),
  };
}

export function applySelfDistributorMappings(
  catalog: Pick<MasterCatalog, 'entries' | 'distributors' | 'publisherDistributors'>
): SelfDistributorMappingResult {
  const appliedKeys: string[] = [];
  const distributorsByKey = new Map(
    (catalog.distributors || []).map(distributor => [normalizeKey(distributor.name), distributor.id])
  );

  for (const assignmentKey of collectLivePublisherAssignmentKeys(catalog)) {
    if ((catalog.publisherDistributors[assignmentKey] || []).length > 0) continue;
    const distributorId = distributorsByKey.get(normalizeKey(assignmentKey));
    if (!distributorId) continue;
    catalog.publisherDistributors[assignmentKey] = [distributorId];
    appliedKeys.push(assignmentKey);
  }

  return {
    appliedKeys: appliedKeys.sort((a, b) => a.localeCompare(b)),
  };
}

export function importPublisherDistributorMappingFile(
  catalog: Pick<MasterCatalog, 'entries' | 'publisherDistributors' | 'distributors'>,
  filePath: string
): ImportedDistributorMappingSummary {
  if (!fs.existsSync(filePath)) {
    return {
      appliedMappings: 0,
      createdDistributors: 0,
      unresolvedPublishers: [],
    };
  }

  const rows = readDistributorMappingRows(filePath);
  const livePublisherKeys = collectLivePublisherAssignmentKeys(catalog);
  let appliedMappings = 0;
  let createdDistributors = 0;
  const unresolvedPublishers = new Set<string>();

  for (const row of rows.slice(1)) {
    const publisherLabel = trimKey(row[0]);
    if (!publisherLabel) continue;

    const distributorNames = row
      .slice(1)
      .map(value => trimKey(String(value || '')))
      .filter(Boolean);
    if (distributorNames.length === 0) continue;

    const resolvedPublisherKey = resolveImportedPublisherKey(publisherLabel, livePublisherKeys);
    if (!resolvedPublisherKey) {
      unresolvedPublishers.add(publisherLabel);
      continue;
    }

    const distributorIds: string[] = [];
    for (const distributorName of distributorNames) {
      const { id, created } = ensureDistributor(catalog, distributorName);
      if (created) createdDistributors++;
      if (!distributorIds.includes(id)) distributorIds.push(id);
    }

    if (distributorIds.length === 0) continue;
    catalog.publisherDistributors[resolvedPublisherKey] = distributorIds;
    appliedMappings++;
  }

  return {
    appliedMappings,
    createdDistributors,
    unresolvedPublishers: Array.from(unresolvedPublishers).sort((a, b) => a.localeCompare(b)),
  };
}
