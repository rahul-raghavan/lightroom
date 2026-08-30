// Core catalog build logic — shared between the CLI script and the API rebuild endpoint

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { CatalogEntry, MasterCatalog, MetadataSource } from './catalog-types';
import { getCatalogScope, isSecondHandCategory } from './catalog-scope';
import { applyKnownImprintMappings, ImprintMappingRecord, syncStructuredPublisherFields } from './catalog-imprints';
import {
  applySelfDistributorMappings,
  importPublisherDistributorMappingFile,
  reconcilePublisherDistributorMap,
} from './distributor-mapping';
import {
  addSearchAlias,
  cleanAuthorName,
  cleanPublisherNameForWrite,
  cleanTitleName,
  inferAuthorFromRawBrand,
  inferPublisherFromRawBrand,
  normalizeCatalogEntry,
} from './catalog-normalization';

// Raw row from Indian Stock Books.xlsx
interface IndianStockRow {
  ISB: string | number;
  Tittle: string;   // misspelled in the file
  Author: string;
  Publisher: string;
  Price: number;
  Language: string;
}

interface BuildPaths {
  inventoryPath: string;
  salesPath: string;
  indianStockPath: string;
  imprintMappingsPath?: string;
  distributorMappingsPath?: string;
}

function shouldPreserveSourceValue(source?: MetadataSource): boolean {
  return source === 'open-library' || source === 'india-isbn' || source === 'google-books' || source === 'manual';
}

/**
 * Extract author from the Brand column.
 * Patterns:
 *   "Author-Ruskin Bond / HarperCollins" → "Ruskin Bond"
 *   "Author-Enid Blyton" → "Enid Blyton"
 *   "A. A. Milne" (no prefix) → could be author but we can't be sure
 */
function extractAuthor(brand: string, subBrand: string): string {
  if (!brand) return '';

  const inferred = inferAuthorFromRawBrand(brand);
  if (inferred) {
    return inferred;
  }

  // Sub Brand sometimes has the author
  if (subBrand && subBrand !== brand) {
    return subBrand;
  }

  return '';
}

function cloneAliases(existing: CatalogEntry | undefined) {
  if (!existing?.searchAliases) return undefined;

  return {
    titles: [...existing.searchAliases.titles],
    authors: [...existing.searchAliases.authors],
    publishers: [...existing.searchAliases.publishers],
  };
}

function cloneLookupMappings(existing: CatalogEntry | undefined) {
  return {
    imprint: existing?.imprint,
    parentPublisher: existing?.parentPublisher,
  };
}

export function buildCatalog(
  inventoryBuffer: ArrayBuffer,
  salesBuffer: ArrayBuffer,
  indianStockBuffer: ArrayBuffer,
  existingCatalog: MasterCatalog | null,
): MasterCatalog {
  // 1. Parse Indian Stock Books
  const indianWb = XLSX.read(indianStockBuffer, { type: 'array' });
  const indianData = XLSX.utils.sheet_to_json<IndianStockRow>(indianWb.Sheets[indianWb.SheetNames[0]]);

  const indianMap = new Map<string, { author: string; publisher: string; language: string }>();
  for (const row of indianData) {
    const isbn = String(row.ISB || '').trim();
    if (!isbn) continue;
    indianMap.set(isbn, {
      author: String(row.Author || '').trim(),
      publisher: String(row.Publisher || '').trim(),
      language: String(row.Language || '').trim(),
    });
  }

  // 2. Parse Inventory
  const invWb = XLSX.read(inventoryBuffer, { type: 'array' });
  const invData = XLSX.utils.sheet_to_json<Record<string, unknown>>(invWb.Sheets[invWb.SheetNames[0]]);

  // 3. Parse Sales (header in row 5)
  const salesWb = XLSX.read(salesBuffer, { type: 'array' });
  const salesSheet = salesWb.Sheets[salesWb.SheetNames[0]];
  const salesData = XLSX.utils.sheet_to_json<Record<string, unknown>>(salesSheet, { range: 4 });

  const salesMap = new Map<string, { qtySold: number; revenue: number }>();
  for (const row of salesData) {
    const isbn = String(row['Item Code'] || '').trim();
    const qtySold = Number(row['Quantity Sold']) || 0;
    const revenue = Number(row['Total']) || 0;
    if (!isbn || qtySold <= 0) continue;
    // Accumulate in case of duplicates
    const existing = salesMap.get(isbn);
    if (existing) {
      existing.qtySold += qtySold;
      existing.revenue += revenue;
    } else {
      salesMap.set(isbn, { qtySold, revenue });
    }
  }

  // 4. Group inventory batches by ISBN. ERP exports one row per batch, so the
  // current stock for a title is the sum of all eligible batch quantities.
  const inventoryGroups = new Map<string, Record<string, unknown>[]>();
  for (const row of invData) {
    const isbn = String(row['ItemCode'] || '').trim();
    if (!isbn) continue;

    const qty = Number(row['Qty']) || 0;
    if (qty < 0) continue;

    const category = String(row['Category'] || '').trim();
    if (isSecondHandCategory(category)) continue;

    const group = inventoryGroups.get(isbn) || [];
    group.push(row);
    inventoryGroups.set(isbn, group);
  }

  // 5. Build entries from grouped inventory
  const entries: Record<string, CatalogEntry> = {};

  for (const [isbn, rows] of inventoryGroups) {
    const row = [...rows].reverse().find(candidate => (Number(candidate['Qty']) || 0) > 0)
      || rows[rows.length - 1];
    const qty = rows.reduce((sum, candidate) => sum + (Number(candidate['Qty']) || 0), 0);
    const category = String(row['Category'] || '').trim();

    const rawBrand = String(row['Brand'] || '').trim();
    const subBrand = String(row['Sub Brand'] || '').trim();
    const inventoryName = cleanTitleName(String(row['Name'] || '').trim());
    const mrp = Number(row['MRP'] || row['Mrp']) || 0;
    const sellingPrice = Number(row['Selling Price']) || mrp || 0;

    const scopeInfo = getCatalogScope(isbn, category);

    // Check if existing entry was confirmed by a human or accepted from APIs — preserve it
    const existing = existingCatalog?.entries[isbn];

    // Determine publisher
    const indianEntry = indianMap.get(isbn);
    let publisher: string;
    let publisherSource: MetadataSource | undefined;
    const brandPublisher = inferPublisherFromRawBrand(rawBrand);

    if (brandPublisher === 'Unknown Publisher' && indianEntry?.publisher) {
      // Indian Stock Books has a publisher for this ISBN and Brand is unknown
      publisher = cleanPublisherNameForWrite(indianEntry.publisher).value;
      publisherSource = publisher !== 'Unknown Publisher' ? 'indian-stock' : undefined;
    } else {
      publisher = brandPublisher;
      publisherSource = publisher !== 'Unknown Publisher' ? 'inventory' : undefined;
    }

    // Preserve manually confirmed or accepted API publisher data.
    if (
      existing?.publisher &&
      (existing.publisherConfirmed || shouldPreserveSourceValue(existing.publisherSource))
    ) {
      publisher = existing.publisher;
      publisherSource = existing.publisherSource || (existing.publisherConfirmed ? 'manual' : publisherSource);
    }

    // Determine author
    const inventoryAuthor = cleanAuthorName(extractAuthor(rawBrand, subBrand));
    let author = inventoryAuthor;
    let authorSource: MetadataSource | undefined = author ? 'inventory' : undefined;
    if (!author && indianEntry?.author) {
      author = cleanAuthorName(indianEntry.author);
      authorSource = 'indian-stock';
    }

    // Preserve manually confirmed or accepted API author data.
    if (
      existing?.author &&
      (existing.authorConfirmed || shouldPreserveSourceValue(existing.authorSource))
    ) {
      author = existing.author;
      authorSource = existing.authorSource || (existing.authorConfirmed ? 'manual' : authorSource);
    }

    const sale = salesMap.get(isbn);
    const existingHierarchy = cloneLookupMappings(existing);
    const entry: CatalogEntry = {
      isbn,
      name: inventoryName,
      rawName: inventoryName || existing?.rawName || undefined,
      titleSource: 'inventory',
      author,
      authorSource,
      publisher,
      ...(existingHierarchy.imprint ? { imprint: existingHierarchy.imprint } : {}),
      ...(existingHierarchy.parentPublisher ? { parentPublisher: existingHierarchy.parentPublisher } : {}),
      publisherSource,
      scope: scopeInfo.scope,
      ...(scopeInfo.exclusionReason ? { exclusionReason: scopeInfo.exclusionReason } : {}),
      language: indianEntry?.language || existing?.language || undefined,
      category: category || undefined,
      rawBrand,
      subBrand,
      currentStock: qty,
      mrp: mrp || undefined,
      sellingPrice: sellingPrice || undefined,
      publisherConfirmed: existing?.publisherConfirmed || false,
      authorConfirmed: existing?.authorConfirmed || false,
      revenue: sale?.revenue || 0,
      qtySold: sale?.qtySold || 0,
      // Preserve lookup suggestions from previous runs
      ...(existing?.suggestion ? { suggestion: existing.suggestion } : {}),
      // Preserve tag data from previous runs
      ...(existing?.tagData ? { tagData: existing.tagData } : {}),
      ...(cloneAliases(existing) ? { searchAliases: cloneAliases(existing) } : {}),
      ...(existing?.lookupState ? { lookupState: existing.lookupState } : {}),
      tagsConfirmed: existing?.tagsConfirmed || false,
    };

    if (
      existing?.name &&
      existing.titleSource &&
      existing.titleSource !== 'inventory'
    ) {
      entry.name = cleanTitleName(existing.name);
      entry.titleSource = existing.titleSource;
      if (inventoryName && inventoryName !== entry.name) {
        addSearchAlias(entry, 'titles', inventoryName, [entry.name, entry.rawName]);
      }
    }

    if (existing?.author && existing.author !== entry.author) {
      addSearchAlias(entry, 'authors', existing.author, [entry.author]);
    }
    if (inventoryAuthor && inventoryAuthor !== entry.author) {
      addSearchAlias(entry, 'authors', inventoryAuthor, [entry.author]);
    }
    if (indianEntry?.author && cleanAuthorName(indianEntry.author) !== entry.author) {
      addSearchAlias(entry, 'authors', indianEntry.author, [entry.author]);
    }

    if (existing?.publisher && existing.publisher !== entry.publisher) {
      addSearchAlias(entry, 'publishers', existing.publisher, [entry.publisher]);
    }

    if (rawBrand && rawBrand !== 'Not found' && entry.publisher !== 'Unknown Publisher') {
      addSearchAlias(entry, 'publishers', rawBrand, [entry.publisher]);
    }

    normalizeCatalogEntry(entry);
    syncStructuredPublisherFields(entry);
    entries[isbn] = entry;
  }

  // Inventory exports may contain only the current stock snapshot rather than
  // every product ever cataloged. Keep known records searchable and mark items
  // absent from the latest snapshot as out of stock.
  if (existingCatalog) {
    for (const [isbn, existing] of Object.entries(existingCatalog.entries)) {
      if (entries[isbn]) continue;

      const sale = salesMap.get(isbn);
      const retained: CatalogEntry = {
        ...existing,
        currentStock: 0,
        revenue: sale?.revenue || 0,
        qtySold: sale?.qtySold || 0,
        ...(existing.tagData
          ? {
              tagData: {
                ...existing.tagData,
                categories: [...existing.tagData.categories],
                subjects: [...existing.tagData.subjects],
                ...(existing.tagData.rawCategories
                  ? { rawCategories: [...existing.tagData.rawCategories] }
                  : {}),
              },
            }
          : {}),
        ...(cloneAliases(existing) ? { searchAliases: cloneAliases(existing) } : {}),
      };

      normalizeCatalogEntry(retained);
      syncStructuredPublisherFields(retained);
      entries[isbn] = retained;
    }
  }

  return {
    version: (existingCatalog?.version || 0) + 1,
    lastBuilt: new Date().toISOString(),
    entries,
    distributors: existingCatalog?.distributors || [],
    publisherDistributors: existingCatalog?.publisherDistributors || {},
    sourceFiles: existingCatalog?.sourceFiles || {},
    enrichmentState: existingCatalog?.enrichmentState || {},
  };
}

/**
 * Build catalog from file paths on disk (used by CLI script and API rebuild).
 */
export function buildCatalogFromPaths(
  paths: BuildPaths,
  existingCatalog: MasterCatalog | null,
): MasterCatalog {
  const inventoryBuffer = fs.readFileSync(paths.inventoryPath);
  const salesBuffer = fs.readFileSync(paths.salesPath);
  const indianStockBuffer = fs.readFileSync(paths.indianStockPath);

  const catalog = buildCatalog(
    inventoryBuffer.buffer.slice(inventoryBuffer.byteOffset, inventoryBuffer.byteOffset + inventoryBuffer.byteLength),
    salesBuffer.buffer.slice(salesBuffer.byteOffset, salesBuffer.byteOffset + salesBuffer.byteLength),
    indianStockBuffer.buffer.slice(indianStockBuffer.byteOffset, indianStockBuffer.byteOffset + indianStockBuffer.byteLength),
    existingCatalog,
  );

  if (paths.imprintMappingsPath && fs.existsSync(paths.imprintMappingsPath)) {
    try {
      const mappings = JSON.parse(fs.readFileSync(paths.imprintMappingsPath, 'utf-8')) as ImprintMappingRecord[];
      applyKnownImprintMappings(Object.values(catalog.entries), mappings, { publisherFieldMode: 'keep-imprint' });
    } catch {
      // Ignore invalid mapping files during rebuild; the catalog itself remains valid.
    }
  }

  if (paths.distributorMappingsPath && fs.existsSync(paths.distributorMappingsPath)) {
    importPublisherDistributorMappingFile(catalog, paths.distributorMappingsPath);
  }

  reconcilePublisherDistributorMap(catalog);
  applySelfDistributorMappings(catalog);
  catalog.sourceFiles = {
    inventoryFile: path.basename(paths.inventoryPath),
    salesFile: path.basename(paths.salesPath),
    ...(paths.distributorMappingsPath ? { distributorMappingFile: path.basename(paths.distributorMappingsPath) } : {}),
  };

  return catalog;
}
