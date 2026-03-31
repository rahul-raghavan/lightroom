#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { applyKnownImprintMappings, ImprintMappingRecord, parseExplicitImprintLabel } from '../lib/catalog-imprints';
import { MasterCatalog } from '../lib/catalog-types';
import { normalizeCatalogEntry } from '../lib/catalog-normalization';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'master-catalog.json');
const IMPRINTS_PATH = path.join(ROOT, 'data', 'imprint-mappings.json');

function readCatalog(): MasterCatalog {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as MasterCatalog;
}

function writeCatalog(catalog: MasterCatalog): void {
  for (const entry of Object.values(catalog.entries)) {
    normalizeCatalogEntry(entry);
  }
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

function normalizeDistributorAssignments(catalog: MasterCatalog, mappings: ImprintMappingRecord[]): number {
  const mappingByImprint = new Map(mappings.map(mapping => [mapping.imprint.toLowerCase(), mapping.parent]));
  const nextAssignments: Record<string, string[]> = {};
  let migratedKeys = 0;

  for (const [rawKey, distributorIds] of Object.entries(catalog.publisherDistributors)) {
    const parsed = parseExplicitImprintLabel(rawKey);
    const normalizedKey = parsed?.parentPublisher || mappingByImprint.get(rawKey.toLowerCase()) || rawKey;

    const existing = new Set(nextAssignments[normalizedKey] || []);
    for (const distributorId of distributorIds) {
      existing.add(distributorId);
    }
    nextAssignments[normalizedKey] = Array.from(existing);

    if (normalizedKey !== rawKey) {
      migratedKeys++;
    }
  }

  catalog.publisherDistributors = nextAssignments;
  return migratedKeys;
}

function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('Catalog not found. Run `npm run build-catalog` first.');
    process.exit(1);
  }
  if (!fs.existsSync(IMPRINTS_PATH)) {
    console.error('Imprint mapping file not found.');
    process.exit(1);
  }

  const catalog = readCatalog();
  const mappings = JSON.parse(fs.readFileSync(IMPRINTS_PATH, 'utf-8')) as ImprintMappingRecord[];

  const changedEntries = applyKnownImprintMappings(Object.values(catalog.entries), mappings, {
    publisherFieldMode: 'keep-imprint',
  });
  const migratedAssignmentKeys = normalizeDistributorAssignments(catalog, mappings);

  writeCatalog(catalog);

  const entries = Object.values(catalog.entries).filter(entry => entry.scope === 'book');
  const structured = entries.filter(entry => entry.imprint || entry.parentPublisher).length;
  const withParents = entries.filter(entry => entry.parentPublisher).length;

  console.log(`Imprint backfill complete.`);
  console.log(`Entries updated: ${changedEntries}`);
  console.log(`Books with structured imprint/parent data: ${structured}`);
  console.log(`Books with parent publisher: ${withParents}`);
  console.log(`Distributor assignment keys migrated: ${migratedAssignmentKeys}`);
}

main();
