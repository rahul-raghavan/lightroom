import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { buildCatalogFromPaths } from '@/lib/catalog-builder';
import { resolveCatalogSourcePaths } from '@/lib/catalog-source-paths';
import { MasterCatalog } from '@/lib/catalog-types';

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, 'data', 'master-catalog.json');

// POST — rebuild catalog from Excel files, preserving confirmed entries
export async function POST() {
  let paths;
  try {
    paths = resolveCatalogSourcePaths(ROOT);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Missing required ERP files' },
      { status: 400 }
    );
  }

  // Load existing catalog if present
  let existingCatalog: MasterCatalog | null = null;
  if (fs.existsSync(CATALOG_PATH)) {
    try {
      existingCatalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
    } catch {
      existingCatalog = null;
    }
  }

  const catalog = buildCatalogFromPaths(paths, existingCatalog);

  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));

  const entries = Object.values(catalog.entries);
  return NextResponse.json({
    version: catalog.version,
    totalEntries: entries.length,
    inScopeEntries: entries.filter(e => e.scope === 'book').length,
    excludedEntries: entries.filter(e => e.scope === 'excluded').length,
    withPublisher: entries.filter(e => e.publisher !== 'Unknown Publisher').length,
    withAuthor: entries.filter(e => e.author).length,
    confirmed: entries.filter(e => e.publisherConfirmed || e.authorConfirmed).length,
  });
}
