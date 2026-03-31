import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MasterCatalog } from '@/lib/catalog-types';
import {
  applyImprintMappingToEntry,
  getPublisherAssignmentKey,
  parseExplicitImprintLabel,
} from '@/lib/catalog-imprints';
import { normalizeCatalogEntry } from '@/lib/catalog-normalization';

const CATALOG_PATH = path.join(process.cwd(), 'data', 'master-catalog.json');
const IMPRINTS_PATH = path.join(process.cwd(), 'data', 'imprint-mappings.json');

interface ImprintMapping {
  imprint: string;
  parent: string;
  confidence: 'high' | 'medium';
  note: string;
}

type LegacyFormat = 'parentOnly' | 'imprintParent';

function matchesImprint(entryPublisher: string, entryImprint: string | undefined, imprint: string): boolean {
  const target = imprint.toLowerCase();
  if ((entryImprint || '').toLowerCase() === target) return true;
  if ((entryPublisher || '').toLowerCase() === target) return true;

  const parsed = parseExplicitImprintLabel(entryPublisher);
  return parsed?.imprint.toLowerCase() === target;
}

function mergeDistributorAssignments(
  catalog: MasterCatalog,
  oldKeys: string[],
  newKey: string
): void {
  const merged = new Set<string>(catalog.publisherDistributors[newKey] || []);

  for (const key of oldKeys) {
    for (const distributorId of catalog.publisherDistributors[key] || []) {
      merged.add(distributorId);
    }
    if (key !== newKey) {
      delete catalog.publisherDistributors[key];
    }
  }

  if (merged.size > 0) {
    catalog.publisherDistributors[newKey] = Array.from(merged);
  }
}

function readCatalog(): MasterCatalog | null {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function readImprints(): ImprintMapping[] {
  try {
    return JSON.parse(fs.readFileSync(IMPRINTS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

// GET — return imprint mappings with catalog match info
export async function GET() {
  const catalog = readCatalog();
  if (!catalog) {
    return NextResponse.json({ error: 'Catalog not found' }, { status: 404 });
  }

  const mappings = readImprints();
  const mappingByImprint = new Map(mappings.map(mapping => [mapping.imprint.toLowerCase(), mapping]));

  // Count books per imprint match, including already-structured entries.
  const publisherCounts = new Map<string, number>();
  for (const entry of Object.values(catalog.entries)) {
    for (const mapping of mappingByImprint.values()) {
      if (matchesImprint(entry.publisher, entry.imprint, mapping.imprint)) {
        const key = mapping.imprint.toLowerCase();
        publisherCounts.set(key, (publisherCounts.get(key) || 0) + 1);
        break;
      }
    }
  }

  // Match imprints against catalog publishers
  const matched = mappings
    .map(m => {
      const key = m.imprint.toLowerCase();
      const count = publisherCounts.get(key) || 0;
      return {
        ...m,
        bookCount: count,
        inCatalog: count > 0,
      };
    })
    .filter(m => m.inCatalog) // Only show imprints that exist in our catalog
    .sort((a, b) => b.bookCount - a.bookCount);

  // Group by parent
  const grouped: Record<string, typeof matched> = {};
  for (const m of matched) {
    if (!grouped[m.parent]) grouped[m.parent] = [];
    grouped[m.parent].push(m);
  }

  return NextResponse.json({
    mappings: matched,
    grouped,
    totalImprints: matched.length,
    totalBooks: matched.reduce((s, m) => s + m.bookCount, 0),
  });
}

// POST — apply selected imprint mappings (rename publishers)
export async function POST(request: NextRequest) {
  const catalog = readCatalog();
  if (!catalog) {
    return NextResponse.json({ error: 'Catalog not found' }, { status: 404 });
  }

  const body = await request.json() as {
    mappings: Array<{ imprint: string; parent: string; format: LegacyFormat }>;
  };

  if (!body.mappings?.length) {
    return NextResponse.json({ error: 'No mappings provided' }, { status: 400 });
  }

  let updated = 0;
  for (const mapping of body.mappings) {
    const publisherFieldMode = mapping.format === 'parentOnly' ? 'use-parent' : 'keep-imprint';
    const oldKeys = new Set<string>([mapping.imprint, `${mapping.imprint} (${mapping.parent})`].map(key => key.toLowerCase()));

    for (const entry of Object.values(catalog.entries)) {
      if (!matchesImprint(entry.publisher, entry.imprint, mapping.imprint)) continue;

      oldKeys.add(getPublisherAssignmentKey(entry).toLowerCase());
      if (applyImprintMappingToEntry(entry, mapping, { publisherFieldMode })) {
        updated++;
      } else {
        normalizeCatalogEntry(entry);
      }
    }

    const newDistributorKey = mapping.parent;
    mergeDistributorAssignments(catalog, Array.from(oldKeys), newDistributorKey);
  }

  // Save
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));

  return NextResponse.json({ updated, version: catalog.version });
}
