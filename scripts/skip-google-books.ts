#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import {
  applyResidualPublisherSuggestions,
  countCompleteBooks,
  countRevenueCompleteBooks,
  getManualExceptionCounts,
  isBookEntry,
} from '../lib/catalog-enrichment';
import { MasterCatalog } from '../lib/catalog-types';
import { normalizeCatalogEntry } from '../lib/catalog-normalization';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'master-catalog.json');

function readCatalog(): MasterCatalog {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as MasterCatalog;
}

function writeCatalog(catalog: MasterCatalog): void {
  for (const entry of Object.values(catalog.entries)) {
    normalizeCatalogEntry(entry);
  }
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('Catalog not found. Run `npm run build-catalog` first.');
    process.exit(1);
  }

  const catalog = readCatalog();
  catalog.enrichmentState = {
    ...(catalog.enrichmentState || {}),
    googleBooksSkippedAt: new Date().toISOString(),
  };
  delete catalog.enrichmentState.googleBooksBlockedUntil;

  const suggestionCount = applyResidualPublisherSuggestions(catalog);
  writeCatalog(catalog);

  const books = Object.values(catalog.entries).filter(isBookEntry);
  const revenueBooks = books.filter(entry => entry.revenue > 0);
  const counts = getManualExceptionCounts(books, catalog.enrichmentState);

  console.log(`Google Books marked as skipped at ${catalog.enrichmentState.googleBooksSkippedAt}`);
  console.log(`Residual publisher suggestions refreshed: ${suggestionCount}`);
  console.log(
    `Snapshot: author=${books.filter(entry => entry.author).length} ` +
    `publisher=${books.filter(entry => entry.publisher !== 'Unknown Publisher').length} ` +
    `tags=${books.filter(entry => entry.tagData).length} ` +
    `complete=${countCompleteBooks(books)} ` +
    `revenue-complete=${countRevenueCompleteBooks(revenueBooks)} ` +
    `pending(ol=${counts.pendingOpenLibrary}, india=${counts.pendingIndiaIsbn}, google=${counts.pendingGoogleBooks}, manual=${counts.manualOnly})`
  );
}

main();
