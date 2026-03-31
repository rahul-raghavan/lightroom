#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  countCompleteBooks,
  countRevenueCompleteBooks,
  getManualExceptionCounts,
  getMissingFields,
  isBookEntry,
} from '../lib/catalog-enrichment';
import { MasterCatalog } from '../lib/catalog-types';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'master-catalog.json');
const LOG_DIR = path.join(ROOT, 'data', 'queue-logs');
const FINAL_REPORT_PATH = path.join(ROOT, 'data', 'catalog-queue-final-report.json');

interface Snapshot {
  inScope: number;
  withAuthor: number;
  withPublisher: number;
  withTags: number;
  complete: number;
  revenueComplete: number;
  pendingOpenLibrary: number;
  pendingIndiaIsbn: number;
  pendingGoogleBooks: number;
  manualOnly: number;
}

function readCatalog(): MasterCatalog {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as MasterCatalog;
}

function getSnapshot(): Snapshot {
  const catalog = readCatalog();
  const entries = Object.values(catalog.entries);
  const books = entries.filter(isBookEntry);
  const revenue = books.filter(entry => entry.revenue > 0);
  const counts = getManualExceptionCounts(books, catalog.enrichmentState);

  return {
    inScope: books.length,
    withAuthor: books.filter(entry => entry.author).length,
    withPublisher: books.filter(entry => entry.publisher !== 'Unknown Publisher').length,
    withTags: books.filter(entry => entry.tagData).length,
    complete: countCompleteBooks(books),
    revenueComplete: countRevenueCompleteBooks(revenue),
    pendingOpenLibrary: counts.pendingOpenLibrary,
    pendingIndiaIsbn: counts.pendingIndiaIsbn,
    pendingGoogleBooks: counts.pendingGoogleBooks,
    manualOnly: counts.manualOnly,
  };
}

function printSnapshot(label: string, snapshot: Snapshot): void {
  console.log(
    `${label}: author=${snapshot.withAuthor} publisher=${snapshot.withPublisher} tags=${snapshot.withTags} ` +
    `complete=${snapshot.complete} revenue-complete=${snapshot.revenueComplete} ` +
    `pending(ol=${snapshot.pendingOpenLibrary}, india=${snapshot.pendingIndiaIsbn}, google=${snapshot.pendingGoogleBooks}, manual=${snapshot.manualOnly})`
  );
}

function tailLog(logPath: string, lines = 40): void {
  const content = fs.readFileSync(logPath, 'utf-8').trimEnd().split('\n');
  const tail = content.slice(-lines);
  for (const line of tail) {
    console.log(line);
  }
}

function runUtilityScript(scriptPath: string, label: string): void {
  console.log(`\nRunning ${label}`);
  const result = spawnSync('npx', ['tsx', scriptPath], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(`${label} failed`);
    process.exit(result.status || 1);
  }
}

function runBatch(source: 'open-library' | 'india-isbn', limit: number, batchNumber: number): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `${String(batchNumber).padStart(2, '0')}-${source}.log`);
  const output = fs.openSync(logPath, 'w');

  console.log(`\nRunning ${source} batch ${batchNumber} (limit ${limit})`);
  const result = spawnSync('npm', ['run', 'enrich-catalog', '--', '--source', source, '--limit', String(limit)], {
    cwd: ROOT,
    stdio: ['ignore', output, output],
  });
  fs.closeSync(output);

  if (result.status !== 0) {
    console.error(`Batch failed: ${source} ${batchNumber}`);
    tailLog(logPath, 80);
    process.exit(result.status || 1);
  }

  tailLog(logPath, 60);
}

function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('Catalog not found. Run `npm run build-catalog` first.');
    process.exit(1);
  }

  let batchNumber = 1;
  let snapshot = getSnapshot();
  printSnapshot('Starting snapshot', snapshot);

  while (snapshot.pendingIndiaIsbn > 0) {
    runBatch('india-isbn', 500, batchNumber++);
    snapshot = getSnapshot();
    printSnapshot('After India', snapshot);
  }

  while (snapshot.pendingOpenLibrary > 0) {
    runBatch('open-library', 2000, batchNumber++);
    snapshot = getSnapshot();
    printSnapshot('After OL', snapshot);

    while (snapshot.pendingIndiaIsbn > 0) {
      runBatch('india-isbn', 500, batchNumber++);
      snapshot = getSnapshot();
      printSnapshot('After India', snapshot);
    }
  }

  while (snapshot.pendingIndiaIsbn > 0) {
    runBatch('india-isbn', 500, batchNumber++);
    snapshot = getSnapshot();
    printSnapshot('After India', snapshot);
  }

  const remainingMissing = {
    author: 0,
    publisher: 0,
    tags: 0,
  };
  let revenueAuthorPublisherGaps = 0;
  for (const entry of Object.values(readCatalog().entries).filter(isBookEntry)) {
    const missing = getMissingFields(entry);
    if (missing.author) remainingMissing.author++;
    if (missing.publisher) remainingMissing.publisher++;
    if (missing.tags) remainingMissing.tags++;
    if (entry.revenue > 0 && (missing.author || missing.publisher)) {
      revenueAuthorPublisherGaps++;
    }
  }

  const googleRecommended =
    remainingMissing.author + remainingMissing.publisher > 300 ||
    revenueAuthorPublisherGaps > 25;

  console.log('\nOL and India ISBN stages are exhausted.');
  console.log(`Remaining missing: author=${remainingMissing.author} publisher=${remainingMissing.publisher} tags=${remainingMissing.tags}`);
  snapshot = getSnapshot();
  printSnapshot('Final snapshot', snapshot);
  console.log(
    googleRecommended
      ? 'Recommendation: Google Books is still worth running for residual author/publisher gaps.'
      : 'Recommendation: Skip Google Books for now and proceed with normalization.'
  );

  fs.writeFileSync(
    FINAL_REPORT_PATH,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      snapshot,
      remainingMissing,
      revenueAuthorPublisherGaps,
      googleRecommended,
    }, null, 2)
  );

  if (!googleRecommended) {
    runUtilityScript('scripts/normalize-catalog.ts', 'normalization sweep');
  }
}

main();
