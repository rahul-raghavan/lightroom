#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import {
  CatalogEntry,
  MasterCatalog,
} from '../lib/catalog-types';
import {
  classifyTitleSuggestion,
  getAuthorNormalizationSuggestion,
  getPublisherSuggestionAutofill,
  getPublisherNormalizationSuggestion,
  getTagHygieneSuggestion,
  getTitleNormalizationSuggestion,
  normalizeCatalogEntry,
  sanitizeTagData,
  setCanonicalPublisher,
} from '../lib/catalog-normalization';
import { isBookEntry } from '../lib/catalog-enrichment';
import {
  buildPublisherTagProfiles,
  inferCatalogHeuristicTagData,
} from '../lib/tag-mapper';
import {
  applyCuratedAuthorOverrides,
  applyCuratedPublisherOverrides,
  applyCuratedTagOverrides,
} from '../lib/catalog-curation';
import {
  applyKnownImprintMappings,
  ImprintMappingRecord,
} from '../lib/catalog-imprints';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'master-catalog.json');
const REPORT_PATH = path.join(ROOT, 'data', 'catalog-normalization-report.json');
const IMPRINT_MAPPINGS_PATH = path.join(ROOT, 'data', 'imprint-mappings.json');

interface TitleReviewItem {
  isbn: string;
  name: string;
  rawName?: string;
  suggestedTitle: string;
  kind: 'likely-typo' | 'source-variant';
  titleSource?: string;
  revenue: number;
  author: string;
  publisher: string;
  aliases: string[];
}

interface AmbiguousPublisherItem {
  isbn: string;
  publisher: string;
  suggestedPublisher: string;
  revenue: number;
  name: string;
}

function readCatalog(): MasterCatalog {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as MasterCatalog;
}

function writeCatalog(catalog: MasterCatalog): void {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

function snapshot(entry: CatalogEntry): string {
  return JSON.stringify({
    name: entry.name,
    rawName: entry.rawName,
    titleSource: entry.titleSource,
    author: entry.author,
    authorSource: entry.authorSource,
    publisher: entry.publisher,
    imprint: entry.imprint,
    parentPublisher: entry.parentPublisher,
    publisherSource: entry.publisherSource,
    tagData: entry.tagData,
    searchAliases: entry.searchAliases,
  });
}

function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('Catalog not found. Run `npm run build-catalog` first.');
    process.exit(1);
  }

  const catalog = readCatalog();
  const imprintMappings = fs.existsSync(IMPRINT_MAPPINGS_PATH)
    ? JSON.parse(fs.readFileSync(IMPRINT_MAPPINGS_PATH, 'utf-8')) as ImprintMappingRecord[]
    : [];
  const titleReview: TitleReviewItem[] = [];
  const ambiguousPublishers: AmbiguousPublisherItem[] = [];
  const originalSnapshots = new Map<string, string>();

  let changedEntries = 0;
  let authorFixes = 0;
  let publisherFixes = 0;
  let tagFixes = 0;
  let tagBackfills = 0;
  let imprintFixes = 0;
  let curatedPublisherFixes = 0;
  let curatedAuthorFixes = 0;
  let curatedTagBackfills = 0;
  let likelyTypoTitles = 0;
  let sourceVariantTitles = 0;

  for (const entry of Object.values(catalog.entries)) {
    originalSnapshots.set(entry.isbn, snapshot(entry));
  }

  for (const entry of Object.values(catalog.entries)) {
    if (!isBookEntry(entry)) continue;
    if (applyCuratedAuthorOverrides(entry)) {
      curatedAuthorFixes++;
    }
    if (applyCuratedPublisherOverrides(entry)) {
      curatedPublisherFixes++;
    }
  }

  if (imprintMappings.length > 0) {
    imprintFixes = applyKnownImprintMappings(Object.values(catalog.entries), imprintMappings, {
      publisherFieldMode: 'keep-imprint',
    });
  }

  const publisherProfiles = buildPublisherTagProfiles(
    Object.values(catalog.entries).filter(isBookEntry)
  );

  for (const entry of Object.values(catalog.entries)) {
    if (!isBookEntry(entry)) continue;

    const before = originalSnapshots.get(entry.isbn) || snapshot(entry);
    const beforeAuthor = entry.author;
    if (applyCuratedTagOverrides(entry)) {
      curatedTagBackfills++;
    }

    const publisherAutofill = getPublisherSuggestionAutofill(entry);
    if (publisherAutofill) {
      setCanonicalPublisher(entry, publisherAutofill.publisher, 'manual');
      publisherFixes++;
    }

    const authorSuggestion = getAuthorNormalizationSuggestion(entry);
    const publisherSuggestion = getPublisherNormalizationSuggestion(entry);
    const tagSuggestion = getTagHygieneSuggestion(entry);
    const titleSuggestion = getTitleNormalizationSuggestion(entry);

    if (authorSuggestion) authorFixes++;
    if (publisherSuggestion?.confidence === 'high') publisherFixes++;
    if (tagSuggestion) tagFixes++;

    if (publisherSuggestion?.confidence === 'medium') {
      ambiguousPublishers.push({
        isbn: entry.isbn,
        publisher: entry.publisher,
        suggestedPublisher: publisherSuggestion.publisher,
        revenue: entry.revenue,
        name: entry.name,
      });
    }

    if (titleSuggestion) {
      const kind = classifyTitleSuggestion(entry.name, titleSuggestion.title);
      if (kind === 'likely-typo') likelyTypoTitles++;
      else sourceVariantTitles++;

      titleReview.push({
        isbn: entry.isbn,
        name: entry.name,
        rawName: entry.rawName,
        suggestedTitle: titleSuggestion.title,
        kind,
        titleSource: entry.titleSource,
        revenue: entry.revenue,
        author: entry.author,
        publisher: entry.publisher,
        aliases: entry.searchAliases?.titles || [],
      });
    }

    if (!entry.tagData || (!entry.tagData.ageGroup && entry.tagData.categories.length === 0 && entry.tagData.subjects.length === 0)) {
      const heuristicTagData = inferCatalogHeuristicTagData(entry, publisherProfiles);
      if (heuristicTagData) {
        const sanitized = sanitizeTagData(heuristicTagData);
        if (sanitized && (sanitized.ageGroup || sanitized.categories.length > 0 || sanitized.subjects.length > 0)) {
          entry.tagData = sanitized;
          tagBackfills++;
        }
      }
    }

    normalizeCatalogEntry(entry);

    if (!beforeAuthor && entry.author) {
      authorFixes++;
    }

    if (snapshot(entry) !== before) {
      changedEntries++;
    }
  }

  titleReview.sort((a, b) => b.revenue - a.revenue || a.isbn.localeCompare(b.isbn));
  ambiguousPublishers.sort((a, b) => b.revenue - a.revenue || a.isbn.localeCompare(b.isbn));

  writeCatalog(catalog);
  fs.writeFileSync(
    REPORT_PATH,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        changedEntries,
        curatedAuthorFixes,
        curatedPublisherFixes,
        imprintFixes,
        authorFixes,
        publisherFixes,
        tagFixes,
        curatedTagBackfills,
        tagBackfills,
        titleReviewCount: titleReview.length,
        likelyTypoTitles,
      sourceVariantTitles,
      ambiguousPublisherCount: ambiguousPublishers.length,
      titleReview: titleReview.slice(0, 1000),
      ambiguousPublishers: ambiguousPublishers.slice(0, 500),
    }, null, 2)
  );

  console.log(`Catalog normalized: ${changedEntries} entries changed`);
  console.log(`Curated author fixes applied: ${curatedAuthorFixes}`);
  console.log(`Curated publisher fixes applied: ${curatedPublisherFixes}`);
  console.log(`Structured imprint fixes applied: ${imprintFixes}`);
  console.log(`Deterministic author fixes seen: ${authorFixes}`);
  console.log(`Deterministic publisher fixes seen: ${publisherFixes}`);
  console.log(`Tag hygiene fixes seen: ${tagFixes}`);
  console.log(`Curated tag backfills applied: ${curatedTagBackfills}`);
  console.log(`Heuristic tag backfills applied: ${tagBackfills}`);
  console.log(`Title review candidates: ${titleReview.length}`);
  console.log(`Likely typo titles: ${likelyTypoTitles}`);
  console.log(`Source variant titles: ${sourceVariantTitles}`);
  console.log(`Ambiguous publisher review candidates: ${ambiguousPublishers.length}`);
  console.log(`Saved report: ${REPORT_PATH}`);
}

main();
