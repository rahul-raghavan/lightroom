#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { getPublisherAssignmentKey } from '../lib/catalog-imprints';
import {
  applySelfDistributorMappings,
  collectLivePublisherAssignmentKeys,
  reconcilePublisherDistributorMap,
} from '../lib/distributor-mapping';
import { MasterCatalog } from '../lib/catalog-types';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'master-catalog.json');
const COVERAGE_JSON_PATH = path.join(ROOT, 'data', 'publisher-distributor-coverage.json');
const COVERAGE_CSV_PATH = path.join(ROOT, 'data', 'publisher-distributor-coverage.csv');

interface CoverageRow {
  assignmentKey: string;
  mapped: boolean;
  count: number;
  revenue: number;
  distributors: string[];
  samplePublisher: string;
  sampleParent: string;
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function readCatalog(): MasterCatalog {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as MasterCatalog;
}

function writeCatalog(catalog: MasterCatalog): void {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

function buildCoverageRows(catalog: MasterCatalog): CoverageRow[] {
  const distributorLookup = new Map((catalog.distributors || []).map(distributor => [distributor.id, distributor.name]));
  const rows = new Map<string, CoverageRow>();

  for (const entry of Object.values(catalog.entries)) {
    if (entry.scope !== 'book') continue;
    const key = entry.publisher === 'Unknown Publisher'
      ? 'Unknown Publisher'
      : String(getPublisherAssignmentKey(entry) || '').trim();
    if (!key) continue;

    const current = rows.get(key) || {
      assignmentKey: key,
      mapped: false,
      count: 0,
      revenue: 0,
      distributors: [],
      samplePublisher: entry.publisher,
      sampleParent: entry.parentPublisher || '',
    };

    current.count++;
    current.revenue += Number(entry.revenue || 0);
    rows.set(key, current);
  }

  for (const row of rows.values()) {
    const assignedIds = catalog.publisherDistributors[row.assignmentKey] || [];
    row.distributors = assignedIds.map(id => distributorLookup.get(id) || id);
    row.mapped = row.distributors.length > 0;
  }

  return Array.from(rows.values())
    .sort((left, right) => Number(right.mapped) - Number(left.mapped) || right.revenue - left.revenue || right.count - left.count || left.assignmentKey.localeCompare(right.assignmentKey));
}

function writeCoverageReport(catalog: MasterCatalog): CoverageRow[] {
  const rows = buildCoverageRows(catalog);
  fs.writeFileSync(
    COVERAGE_JSON_PATH,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      rows,
    }, null, 2)
  );

  const csvRows = [
    'Assignment Key,Mapped,Books,Revenue,Primary Distributor,Secondary Distributor,Publisher Sample,Parent Sample',
  ];
  for (const row of rows) {
    csvRows.push([
      escapeCsv(row.assignmentKey),
      row.mapped ? 'yes' : 'no',
      row.count,
      row.revenue.toFixed(2),
      escapeCsv(row.distributors[0] || ''),
      escapeCsv(row.distributors[1] || ''),
      escapeCsv(row.samplePublisher),
      escapeCsv(row.sampleParent),
    ].join(','));
  }
  fs.writeFileSync(COVERAGE_CSV_PATH, csvRows.join('\n'));

  return rows;
}

function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('Catalog not found. Run `npm run build-catalog` first.');
    process.exit(1);
  }

  const catalog = readCatalog();
  const beforeKeys = Object.keys(catalog.publisherDistributors || {}).length;
  const result = reconcilePublisherDistributorMap(catalog);
  const selfMappings = applySelfDistributorMappings(catalog);
  const coverageRows = writeCoverageReport(catalog);

  if (result.changed || selfMappings.appliedKeys.length > 0) {
    writeCatalog(catalog);
  }

  const mappedRows = coverageRows.filter(row => row.mapped);
  const mappedBooks = mappedRows.reduce((sum, row) => sum + row.count, 0);
  const totalBooks = coverageRows.reduce((sum, row) => sum + row.count, 0);
  const mappedRevenue = mappedRows.reduce((sum, row) => sum + row.revenue, 0);
  const totalRevenue = coverageRows.reduce((sum, row) => sum + row.revenue, 0);

  console.log(`Distributor mappings reconciled: ${result.changed ? 'yes' : 'no changes needed'}`);
  console.log(`Stored mapping keys: ${beforeKeys} -> ${Object.keys(catalog.publisherDistributors || {}).length}`);
  console.log(`Migrated keys: ${result.migratedKeys.length}`);
  console.log(`Merged keys: ${result.mergedKeys.length}`);
  console.log(`Self-distributor mappings applied: ${selfMappings.appliedKeys.length}`);
  console.log(`Unresolved non-live keys retained: ${result.unresolvedKeys.length}`);
  console.log(`Live mapped publishers: ${mappedRows.length}/${collectLivePublisherAssignmentKeys(catalog).length}`);
  console.log(`Book coverage: ${mappedBooks}/${totalBooks} (${((mappedBooks / Math.max(totalBooks, 1)) * 100).toFixed(1)}%)`);
  console.log(`Revenue coverage: ${mappedRevenue.toFixed(2)}/${totalRevenue.toFixed(2)} (${((mappedRevenue / Math.max(totalRevenue, 1)) * 100).toFixed(1)}%)`);
  console.log(`Coverage report saved: ${COVERAGE_JSON_PATH}`);
  console.log(`Coverage CSV saved: ${COVERAGE_CSV_PATH}`);
}

main();
