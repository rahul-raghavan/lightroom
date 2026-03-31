import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MasterCatalog } from '@/lib/catalog-types';
import { WorkspaceFilters, searchWorkspace } from '@/lib/workspace';

const CATALOG_PATH = path.join(process.cwd(), 'data', 'master-catalog.json');

function readCatalog(): MasterCatalog | null {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as MasterCatalog;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const catalog = readCatalog();
  if (!catalog) {
    return NextResponse.json(
      { error: 'Catalog not found. Run `npm run build-catalog` first.' },
      { status: 404 }
    );
  }

  const body = await request.json() as { filters?: WorkspaceFilters };
  const filters = body.filters || {};
  const results = searchWorkspace(catalog, filters);

  return NextResponse.json({
    filters,
    count: results.length,
    results,
  });
}
