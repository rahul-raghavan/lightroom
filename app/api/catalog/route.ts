import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MasterCatalog, CatalogEntry } from '@/lib/catalog-types';
import {
  cleanTitleName,
  normalizeCatalogEntry,
  sanitizeTagData,
  setCanonicalAuthor,
  setCanonicalPublisher,
  setCanonicalTitle,
} from '@/lib/catalog-normalization';
import { syncStructuredPublisherFields } from '@/lib/catalog-imprints';

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
  for (const entry of Object.values(catalog.entries)) {
    normalizeCatalogEntry(entry);
  }
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

// GET — return the full catalog
export async function GET() {
  const catalog = readCatalog();
  if (!catalog) {
    return NextResponse.json(
      { error: 'Catalog not found. Run `npm run build-catalog` first.' },
      { status: 404 }
    );
  }
  return NextResponse.json(catalog);
}

// PATCH — batch-update entries (publisher fixes, author fixes, confirmations)
export async function PATCH(request: NextRequest) {
  const catalog = readCatalog();
  if (!catalog) {
    return NextResponse.json(
      { error: 'Catalog not found. Run `npm run build-catalog` first.' },
      { status: 404 }
    );
  }

  const body = await request.json() as {
    updates: Record<string, Partial<CatalogEntry>>;
  };

  if (!body.updates || typeof body.updates !== 'object') {
    return NextResponse.json({ error: 'Missing updates object' }, { status: 400 });
  }

  let updatedCount = 0;
  for (const [isbn, changes] of Object.entries(body.updates)) {
    const entry = catalog.entries[isbn];
    if (!entry) continue;

    // Only allow updating specific fields
    if (changes.publisher !== undefined) {
      if (changes.publisher.trim()) {
        setCanonicalPublisher(entry, changes.publisher, 'manual');
      } else {
        entry.publisher = 'Unknown Publisher';
      }
      entry.publisherConfirmed = true;
      entry.publisherSource = 'manual';
      // Clear suggestion once publisher is confirmed
      delete entry.suggestion;
    }
    if (changes.imprint !== undefined) {
      entry.imprint = changes.imprint?.trim() || undefined;
    }
    if (changes.parentPublisher !== undefined) {
      entry.parentPublisher = changes.parentPublisher?.trim() || undefined;
    }
    if (changes.author !== undefined) {
      if (changes.author.trim()) {
        setCanonicalAuthor(entry, changes.author, 'manual');
      } else {
        entry.author = '';
      }
      entry.authorConfirmed = true;
      entry.authorSource = 'manual';
    }
    if (changes.name !== undefined) {
      if (changes.name.trim()) {
        setCanonicalTitle(entry, changes.name, 'manual');
      }
      entry.titleSource = 'manual';
    }
    if (changes.rawName !== undefined) {
      entry.rawName = cleanTitleName(changes.rawName);
    }
    if (changes.publisherConfirmed !== undefined) {
      entry.publisherConfirmed = changes.publisherConfirmed;
    }
    if (changes.authorConfirmed !== undefined) {
      entry.authorConfirmed = changes.authorConfirmed;
    }
    if (changes.tagData !== undefined) {
      entry.tagData = sanitizeTagData(changes.tagData);
    }
    if (changes.searchAliases !== undefined) {
      entry.searchAliases = changes.searchAliases;
    }
    if (changes.titleSource !== undefined) {
      entry.titleSource = changes.titleSource;
    }
    if (changes.lookupState !== undefined) {
      entry.lookupState = changes.lookupState;
    }
    if (changes.tagsConfirmed !== undefined) {
      entry.tagsConfirmed = changes.tagsConfirmed;
    }
    syncStructuredPublisherFields(entry);
    normalizeCatalogEntry(entry);
    updatedCount++;
  }

  writeCatalog(catalog);

  return NextResponse.json({ updated: updatedCount, version: catalog.version });
}
