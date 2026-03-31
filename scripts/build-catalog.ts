#!/usr/bin/env tsx
/**
 * Build the master catalog JSON from Excel files on disk.
 *
 * Usage: npm run build-catalog
 *
 * Reads:
 *   - Inventory-19Mar.xlsx
 *   - sales_by_product 1Jan-19Mar.xlsx
 *   - Indian Stock Books.xlsx
 *
 * Writes:
 *   - data/master-catalog.json
 *
 * If master-catalog.json already exists, manually confirmed values and
 * accepted API-sourced author/publisher fields are preserved.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildCatalogFromPaths } from '../lib/catalog-builder';
import { resolveCatalogSourcePaths } from '../lib/catalog-source-paths';
import { MasterCatalog } from '../lib/catalog-types';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'master-catalog.json');

let PATHS;
try {
  PATHS = resolveCatalogSourcePaths(ROOT);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not resolve catalog source files');
  process.exit(1);
}

// Load existing catalog if present
let existingCatalog: MasterCatalog | null = null;
if (fs.existsSync(CATALOG_PATH)) {
  try {
    existingCatalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
    const confirmedCount = Object.values(existingCatalog!.entries).filter(
      e => e.publisherConfirmed || e.authorConfirmed
    ).length;
    console.log(`Existing catalog found (v${existingCatalog!.version}, ${confirmedCount} confirmed entries will be preserved)`);
  } catch {
    console.warn('Could not parse existing catalog, starting fresh');
    existingCatalog = null;
  }
}

console.log('Building catalog...');
console.log(`  Inventory: ${path.basename(PATHS.inventoryPath)}`);
console.log(`  Sales: ${path.basename(PATHS.salesPath)}`);
console.log(`  Indian Stock: ${path.basename(PATHS.indianStockPath)}`);
if (PATHS.distributorMappingsPath) {
  console.log(`  Distributor mapping: ${path.basename(PATHS.distributorMappingsPath)}`);
}
const catalog = buildCatalogFromPaths(PATHS, existingCatalog);

// Ensure data directory exists
fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });

// Write
fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));

// Stats
const entries = Object.values(catalog.entries);
const withPublisher = entries.filter(e => e.publisher !== 'Unknown Publisher');
const withAuthor = entries.filter(e => e.author);
const withRevenue = entries.filter(e => e.revenue > 0);
const unknownWithRevenue = withRevenue.filter(e => e.publisher === 'Unknown Publisher');
const inScope = entries.filter(e => e.scope === 'book');
const excluded = entries.filter(e => e.scope === 'excluded');

console.log(`\nCatalog built successfully (v${catalog.version})`);
console.log(`  Total entries: ${entries.length.toLocaleString()}`);
console.log(`  In scope: ${inScope.length.toLocaleString()}`);
console.log(`  Excluded: ${excluded.length.toLocaleString()}`);
console.log(`  With publisher: ${withPublisher.length.toLocaleString()} (${((withPublisher.length / entries.length) * 100).toFixed(1)}%)`);
console.log(`  With author: ${withAuthor.length.toLocaleString()} (${((withAuthor.length / entries.length) * 100).toFixed(1)}%)`);
console.log(`  Revenue-generating: ${withRevenue.length.toLocaleString()}`);
console.log(`  Unknown publisher with revenue: ${unknownWithRevenue.length.toLocaleString()}`);
console.log(`\nSaved to: ${CATALOG_PATH}`);
