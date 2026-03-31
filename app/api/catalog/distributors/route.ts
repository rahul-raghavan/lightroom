import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MasterCatalog, Distributor } from '@/lib/catalog-types';
import { reconcilePublisherDistributorMap } from '@/lib/distributor-mapping';

const CATALOG_PATH = path.join(process.cwd(), 'data', 'master-catalog.json');

function readCatalog(): MasterCatalog | null {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCatalog(catalog: MasterCatalog) {
  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

// GET — return distributors and publisher assignments
export async function GET() {
  const catalog = readCatalog();
  if (!catalog) {
    return NextResponse.json(
      { error: 'Catalog not found. Run `npm run build-catalog` first.' },
      { status: 404 }
    );
  }
  return NextResponse.json({
    distributors: catalog.distributors,
    publisherDistributors: catalog.publisherDistributors,
  });
}

// PATCH — update distributors and/or publisher-distributor assignments
export async function PATCH(request: NextRequest) {
  const catalog = readCatalog();
  if (!catalog) {
    return NextResponse.json(
      { error: 'Catalog not found. Run `npm run build-catalog` first.' },
      { status: 404 }
    );
  }

  const body = await request.json() as {
    distributors?: Distributor[];
    publisherDistributors?: Record<string, string[]>;
  };

  if (body.distributors !== undefined) {
    catalog.distributors = body.distributors;
  }

  if (body.publisherDistributors !== undefined) {
    catalog.publisherDistributors = body.publisherDistributors;
  }

  reconcilePublisherDistributorMap(catalog);

  writeCatalog(catalog);

  return NextResponse.json({
    distributors: catalog.distributors,
    publisherDistributors: catalog.publisherDistributors,
  });
}
