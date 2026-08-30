import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { buildCatalog } from '../lib/catalog-builder';
import { getCatalogScope, isSecondHandCategory } from '../lib/catalog-scope';
import {
  applyGoogleRateLimitState,
  applyResidualPublisherSuggestions,
  determineEnrichmentPhase,
  getManualExceptionCounts,
  isLookupEligible,
  selectEnrichmentCandidates,
} from '../lib/catalog-enrichment';
import {
  applyImprintMappingToEntry,
  applyKnownImprintMappings,
  getPublisherAssignmentKey,
  parseExplicitImprintLabel,
  syncStructuredPublisherFields,
} from '../lib/catalog-imprints';
import {
  applySelfDistributorMappings,
  importPublisherDistributorMappingFile,
  reconcilePublisherDistributorMap,
} from '../lib/distributor-mapping';
import {
  normalizeIndiaIsbnAuthors,
  parseIndiaIsbnSearchResult,
} from '../lib/india-isbn';
import { CatalogEntry, MasterCatalog } from '../lib/catalog-types';
import { buildWorkspaceOrderDraft, searchWorkspace } from '../lib/workspace';
import { parseWorkspaceNaturalLanguage } from '../lib/workspace-nl';
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
  addSearchAlias,
  applyTitleCandidate,
  classifyTitleSuggestion,
  cleanAuthorName,
  cleanPublisherNameForWrite,
  inferPublisherFromSearchAliases,
  getPublisherSuggestionAutofill,
  getTagHygieneSuggestion,
  inferAuthorFromRawBrand,
  inferPublisherFromRawBrand,
  sanitizeTagData,
} from '../lib/catalog-normalization';

function inventoryBuffer(rows: Array<Record<string, unknown>>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

function salesBuffer(rows: Array<Record<string, unknown>>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    [],
    [],
    [],
    [],
    ['Item Code', 'Quantity Sold', 'Total'],
    ...rows.map(row => [row['Item Code'], row['Quantity Sold'], row['Total']]),
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sales');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

function indianStockBuffer(rows: Array<Record<string, unknown>>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Indian Stock');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

function makeEntry(overrides: Partial<CatalogEntry>): CatalogEntry {
  return {
    isbn: '9781234567890',
    name: 'Example Book',
    author: '',
    publisher: 'Unknown Publisher',
    scope: 'book',
    language: undefined,
    category: 'NEW',
    rawBrand: 'Not found',
    subBrand: '',
    publisherConfirmed: false,
    authorConfirmed: false,
    revenue: 0,
    qtySold: 0,
    tagsConfirmed: false,
    ...overrides,
  };
}

function makeCatalog(entries: CatalogEntry[]): MasterCatalog {
  return {
    version: 1,
    lastBuilt: '2026-03-29T00:00:00.000Z',
    entries: Object.fromEntries(entries.map(entry => [entry.isbn, entry])),
    distributors: [],
    publisherDistributors: {},
    enrichmentState: {},
  };
}

test('getCatalogScope classifies valid books, products, and invalid codes', () => {
  assert.deepEqual(getCatalogScope('9780143473060', 'NEW'), { scope: 'book' });
  assert.deepEqual(getCatalogScope('9780143473060', 'PRODUCTS'), {
    scope: 'excluded',
    exclusionReason: 'product_category',
  });
  assert.deepEqual(getCatalogScope('LB0109', 'NEW'), {
    scope: 'excluded',
    exclusionReason: 'invalid_isbn',
  });
});

test('isSecondHandCategory handles ERP naming variants', () => {
  assert.equal(isSecondHandCategory('SECOND HAND BOOKS'), true);
  assert.equal(isSecondHandCategory('secondhand'), true);
  assert.equal(isSecondHandCategory('Second-hand books'), true);
  assert.equal(isSecondHandCategory('new'), false);
});

test('buildCatalog preserves accepted API author/publisher values across rebuilds', () => {
  const isbn = '9780143473060';
  const existing = makeCatalog([
    makeEntry({
      isbn,
      name: 'Mother Mary Comes to Me',
      author: 'Arundhati Roy',
      authorSource: 'open-library',
      publisher: 'Penguin Random House',
      publisherSource: 'google-books',
      lookupState: {
        openLibrary: {
          status: 'hit',
          attempts: 1,
          lastAttemptAt: '2026-03-29T00:00:00.000Z',
          fieldsResolved: ['author'],
        },
      },
    }),
  ]);

  const catalog = buildCatalog(
    inventoryBuffer([{
      ItemCode: isbn,
      Qty: 5,
      Category: 'NEW',
      Brand: 'Not found',
      'Sub Brand': '',
      Name: 'Mother Mary Comes to Me',
    }]),
    salesBuffer([{ 'Item Code': isbn, 'Quantity Sold': 3, 'Total': 7192 }]),
    indianStockBuffer([]),
    existing
  );

  const entry = catalog.entries[isbn];
  assert.equal(entry.scope, 'book');
  assert.equal(entry.author, 'Arundhati Roy');
  assert.equal(entry.authorSource, 'open-library');
  assert.equal(entry.publisher, 'Penguin Random House');
  assert.equal(entry.publisherSource, 'google-books');
  assert.equal(entry.lookupState?.openLibrary?.status, 'hit');
  assert.equal(entry.revenue, 7192);
});

test('buildCatalog preserves India ISBN-sourced metadata across rebuilds', () => {
  const isbn = '9789353092511';
  const existing = makeCatalog([
    makeEntry({
      isbn,
      name: "Nani's Walk to the Park",
      author: 'Deepa Balsavar',
      authorSource: 'india-isbn',
      publisher: 'Pratham Books',
      publisherSource: 'india-isbn',
    }),
  ]);

  const catalog = buildCatalog(
    inventoryBuffer([{
      ItemCode: isbn,
      Qty: 5,
      Category: 'NEW',
      Brand: 'Not found',
      'Sub Brand': '',
      Name: "Nani's Walk to the Park",
    }]),
    salesBuffer([]),
    indianStockBuffer([]),
    existing
  );

  const entry = catalog.entries[isbn];
  assert.equal(entry.author, 'Deepa Balsavar');
  assert.equal(entry.authorSource, 'india-isbn');
  assert.equal(entry.publisher, 'Pratham Books');
  assert.equal(entry.publisherSource, 'india-isbn');
});

test('buildCatalog retains known books missing from a partial inventory snapshot at zero stock', () => {
  const retainedIsbn = '9789353092511';
  const currentIsbn = '9780143473060';
  const existing = makeCatalog([
    makeEntry({
      isbn: retainedIsbn,
      name: 'A Known Book',
      author: 'Known Author',
      publisher: 'Tulika',
      currentStock: 7,
      revenue: 250,
      qtySold: 2,
      tagData: {
        ageGroup: 'Picture Book (3-6)',
        categories: ['Fiction'],
        subjects: ['Friendship'],
        source: 'manual',
        confidence: 'high',
        taggedAt: '2026-03-29T00:00:00.000Z',
      },
    }),
  ]);

  const catalog = buildCatalog(
    inventoryBuffer([{
      ItemCode: currentIsbn,
      Qty: 4,
      Category: 'NEW',
      Brand: 'Penguin',
      'Sub Brand': 'Arundhati Roy',
      Name: 'Mother Mary Comes to Me',
    }]),
    salesBuffer([{ 'Item Code': retainedIsbn, 'Quantity Sold': 3, 'Total': 375 }]),
    indianStockBuffer([]),
    existing
  );

  assert.equal(catalog.entries[currentIsbn].currentStock, 4);
  assert.equal(catalog.entries[retainedIsbn].currentStock, 0);
  assert.equal(catalog.entries[retainedIsbn].author, 'Known Author');
  assert.equal(catalog.entries[retainedIsbn].publisher, 'Tulika');
  assert.deepEqual(catalog.entries[retainedIsbn].tagData?.subjects, ['Friendship']);
  assert.equal(catalog.entries[retainedIsbn].qtySold, 3);
  assert.equal(catalog.entries[retainedIsbn].revenue, 375);
});

test('buildCatalog preserves structured imprint fields across rebuilds', () => {
  const isbn = '9780143473060';
  const existing = makeCatalog([
    makeEntry({
      isbn,
      name: 'Mother Mary Comes to Me',
      publisher: 'Duckbill Books',
      imprint: 'Duckbill Books',
      parentPublisher: 'Penguin Random House',
      publisherSource: 'manual',
    }),
  ]);

  const catalog = buildCatalog(
    inventoryBuffer([{
      ItemCode: isbn,
      Qty: 5,
      Category: 'NEW',
      Brand: 'Duckbill Books',
      'Sub Brand': '',
      Name: 'Mother Mary Comes to Me',
    }]),
    salesBuffer([]),
    indianStockBuffer([]),
    existing
  );

  const entry = catalog.entries[isbn];
  assert.equal(entry.publisher, 'Duckbill Books');
  assert.equal(entry.imprint, 'Duckbill Books');
  assert.equal(entry.parentPublisher, 'Penguin Random House');
});

test('selectEnrichmentCandidates ignores excluded rows and sorts by revenue then missing fields', () => {
  const candidates = selectEnrichmentCandidates([
    makeEntry({
      isbn: '9781111111111',
      revenue: 100,
      author: '',
      publisher: 'Unknown Publisher',
      tagData: undefined,
    }),
    makeEntry({
      isbn: '9782222222222',
      revenue: 500,
      author: '',
      publisher: 'Known Publisher',
      tagData: undefined,
    }),
    makeEntry({
      isbn: 'LB0001',
      scope: 'excluded',
      exclusionReason: 'invalid_isbn',
      revenue: 999,
      author: '',
      publisher: 'Unknown Publisher',
      tagData: undefined,
    }),
  ]);

  assert.deepEqual(candidates.map(entry => entry.isbn), ['9782222222222', '9781111111111']);
});

test('structured imprint helpers parse and apply parent publishers cleanly', () => {
  assert.deepEqual(parseExplicitImprintLabel('Yearling (Penguin Random House)'), {
    imprint: 'Yearling',
    parentPublisher: 'Penguin Random House',
  });

  const explicit = makeEntry({
    publisher: 'Yearling (Penguin Random House)',
  });
  syncStructuredPublisherFields(explicit);
  assert.equal(explicit.publisher, 'Yearling');
  assert.equal(explicit.imprint, 'Yearling');
  assert.equal(explicit.parentPublisher, 'Penguin Random House');

  const mapped = makeEntry({
    publisher: 'Duckbill Books',
  });
  applyImprintMappingToEntry(mapped, { imprint: 'Duckbill Books', parent: 'Penguin Random House' });
  assert.equal(mapped.publisher, 'Duckbill Books');
  assert.equal(mapped.imprint, 'Duckbill Books');
  assert.equal(mapped.parentPublisher, 'Penguin Random House');
  assert.equal(getPublisherAssignmentKey(mapped), 'Penguin Random House');
});

test('applyKnownImprintMappings backfills exact imprint matches without changing the imprint label', () => {
  const entry = makeEntry({
    isbn: '9780143333333',
    publisher: 'Yearling',
  });

  const changed = applyKnownImprintMappings([entry], [
    { imprint: 'Yearling', parent: 'Penguin Random House' },
  ]);

  assert.equal(changed, 1);
  assert.equal(entry.publisher, 'Yearling');
  assert.equal(entry.imprint, 'Yearling');
  assert.equal(entry.parentPublisher, 'Penguin Random House');
});

test('applyKnownImprintMappings resolves mapped imprints hidden inside composite publisher strings', () => {
  const entry = makeEntry({
    isbn: '9780061122415',
    publisher: 'Author-Lois Lowry / Clarion Books',
  });

  const changed = applyKnownImprintMappings([entry], [
    { imprint: 'Clarion Books', parent: 'HarperCollins' },
  ]);

  assert.equal(changed, 1);
  assert.equal(entry.publisher, 'Clarion Books');
  assert.equal(entry.imprint, 'Clarion Books');
  assert.equal(entry.parentPublisher, 'HarperCollins');
});

test('reconcilePublisherDistributorMap migrates stale distributor keys onto live parent publishers', () => {
  const catalog = makeCatalog([
    makeEntry({
      isbn: '9780143473060',
      publisher: 'Puffin',
      imprint: 'Puffin',
      parentPublisher: 'Penguin Random House',
    }),
    makeEntry({
      isbn: '9789353092511',
      publisher: 'Pratham Books',
    }),
    makeEntry({
      isbn: '9780061120084',
      publisher: 'HarperCollins',
    }),
    makeEntry({
      isbn: '9788197715181',
      publisher: 'Daffdill Lane',
    }),
    makeEntry({
      isbn: '9781783447695',
      publisher: 'Pan Macmillan',
    }),
  ]);

  catalog.publisherDistributors = {
    Penguin: ['dist_pbd'],
    Pratham: ['dist_pratham'],
    'Harper Collins': ['dist_pbd'],
    'Daffodil Lane': ['dist_independents'],
    'Pan Macmillian': ['dist_ibd'],
    'Pan Macmillan': ['dist_pbd'],
    'Unused Legacy': ['dist_misc'],
  };

  const result = reconcilePublisherDistributorMap(catalog);

  assert.equal(result.changed, true);
  assert.deepEqual(catalog.publisherDistributors['Penguin Random House'], ['dist_pbd']);
  assert.deepEqual(catalog.publisherDistributors['Pratham Books'], ['dist_pratham']);
  assert.deepEqual(catalog.publisherDistributors.HarperCollins, ['dist_pbd']);
  assert.deepEqual(catalog.publisherDistributors['Daffdill Lane'], ['dist_independents']);
  assert.deepEqual(catalog.publisherDistributors['Pan Macmillan'], ['dist_ibd', 'dist_pbd']);
  assert.equal(catalog.publisherDistributors.Penguin, undefined);
  assert.equal(catalog.publisherDistributors.Pratham, undefined);
  assert.deepEqual(result.unresolvedKeys, ['Unused Legacy']);
});

test('applySelfDistributorMappings assigns publishers to matching distributor names', () => {
  const catalog = makeCatalog([
    makeEntry({
      isbn: '9789392130427',
      publisher: 'Roli Books',
    }),
    makeEntry({
      isbn: '9780143473060',
      publisher: 'Penguin Random House',
    }),
  ]);

  catalog.distributors = [
    { id: 'dist_roli_books', name: 'Roli Books' },
    { id: 'dist_pbd', name: 'PBD' },
  ];
  catalog.publisherDistributors = {
    'Penguin Random House': ['dist_pbd'],
  };

  const result = applySelfDistributorMappings(catalog);

  assert.deepEqual(result.appliedKeys, ['Roli Books']);
  assert.deepEqual(catalog.publisherDistributors['Roli Books'], ['dist_roli_books']);
});

test('isLookupEligible skips misses unless explicitly retried and respects nextEligibleAt', () => {
  const now = new Date('2026-03-29T12:00:00.000Z');

  assert.equal(isLookupEligible(undefined, now, false), true);
  assert.equal(isLookupEligible({
    status: 'miss',
    attempts: 1,
    lastAttemptAt: '2026-03-29T10:00:00.000Z',
    fieldsResolved: [],
  }, now, false), false);
  assert.equal(isLookupEligible({
    status: 'miss',
    attempts: 1,
    lastAttemptAt: '2026-03-29T10:00:00.000Z',
    fieldsResolved: [],
  }, now, true), true);
  assert.equal(isLookupEligible({
    status: 'error',
    attempts: 1,
    lastAttemptAt: '2026-03-29T10:00:00.000Z',
    nextEligibleAt: '2026-03-29T13:00:00.000Z',
    fieldsResolved: [],
  }, now, false), false);
  assert.equal(isLookupEligible({
    status: 'rate_limited',
    attempts: 1,
    lastAttemptAt: '2026-03-29T10:00:00.000Z',
    nextEligibleAt: '2026-03-29T11:00:00.000Z',
    fieldsResolved: [],
  }, now, false), true);
});

test('applyGoogleRateLimitState stores the global cooldown and per-entry state', () => {
  const entry = makeEntry({ isbn: '9783333333333' });
  const catalog = makeCatalog([entry]);

  const blockedUntil = applyGoogleRateLimitState(catalog, entry, '2026-03-29T10:00:00.000Z');

  assert.equal(catalog.enrichmentState?.googleBooksBlockedUntil, blockedUntil);
  assert.equal(entry.lookupState?.googleBooks?.status, 'rate_limited');
  assert.equal(entry.lookupState?.googleBooks?.nextEligibleAt, blockedUntil);
  assert.equal(entry.lookupState?.googleBooks?.attempts, 1);
});

test('applyResidualPublisherSuggestions only suggests for exhausted unknown publishers', () => {
  const known1 = makeEntry({
    isbn: '9781234500001',
    publisher: 'Known House',
  });
  const known2 = makeEntry({
    isbn: '9781234500002',
    publisher: 'Known House',
  });
  const unknownReady = makeEntry({
    isbn: '9781234500003',
    lookupState: {
      openLibrary: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:00:00.000Z',
        fieldsResolved: [],
      },
      googleBooks: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:05:00.000Z',
        fieldsResolved: [],
      },
    },
  });
  const unknownPending = makeEntry({
    isbn: '9781234500004',
    lookupState: {
      openLibrary: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:00:00.000Z',
        fieldsResolved: [],
      },
    },
  });
  const indiaKnown1 = makeEntry({
    isbn: '9789353000001',
    publisher: 'Pratham Books',
  });
  const indiaKnown2 = makeEntry({
    isbn: '9789353000002',
    publisher: 'Pratham Books',
  });
  const indiaUnknownPending = makeEntry({
    isbn: '9789353000003',
    lookupState: {
      openLibrary: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:00:00.000Z',
        fieldsResolved: [],
      },
      googleBooks: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:05:00.000Z',
        fieldsResolved: [],
      },
    },
  });

  const catalog = makeCatalog([
    known1,
    known2,
    unknownReady,
    unknownPending,
    indiaKnown1,
    indiaKnown2,
    indiaUnknownPending,
  ]);
  const suggestionCount = applyResidualPublisherSuggestions(catalog);

  assert.equal(suggestionCount, 1);
  assert.equal(catalog.entries['9781234500003'].suggestion?.publisher, 'Known House');
  assert.equal(catalog.entries['9781234500003'].suggestion?.source, 'isbn-prefix');
  assert.equal(catalog.entries['9781234500004'].suggestion, undefined);
  assert.equal(catalog.entries['9789353000003'].suggestion, undefined);
});

test('applyResidualPublisherSuggestions allows post-India suggestions when Google is skipped', () => {
  const known = makeEntry({
    isbn: '9781234500001',
    publisher: 'Known House',
    lookupState: {
      openLibrary: {
        status: 'hit',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:00:00.000Z',
        fieldsResolved: ['publisher'],
      },
    },
  });
  const unknown = makeEntry({
    isbn: '9781234500002',
    lookupState: {
      openLibrary: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:00:00.000Z',
        fieldsResolved: [],
      },
    },
  });

  const catalog = makeCatalog([known, unknown]);
  catalog.enrichmentState = {
    googleBooksSkippedAt: '2026-03-29T15:00:00.000Z',
  };

  const suggestionCount = applyResidualPublisherSuggestions(catalog);

  assert.equal(suggestionCount, 1);
  assert.equal(catalog.entries['9781234500002'].suggestion?.publisher, 'Known House');
});

test('getManualExceptionCounts includes a pending India ISBN stage for eligible ISBNs', () => {
  const pendingIndia = makeEntry({
    isbn: '9789353092511',
    author: '',
    lookupState: {
      openLibrary: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:00:00.000Z',
        fieldsResolved: [],
      },
    },
  });
  const pendingGoogle = makeEntry({
    isbn: '9780143473060',
    author: '',
    lookupState: {
      openLibrary: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:00:00.000Z',
        fieldsResolved: [],
      },
    },
  });

  const counts = getManualExceptionCounts([pendingIndia, pendingGoogle]);

  assert.equal(counts.pendingOpenLibrary, 0);
  assert.equal(counts.pendingIndiaIsbn, 1);
  assert.equal(counts.pendingGoogleBooks, 1);
  assert.equal(counts.manualOnly, 0);
});

test('getManualExceptionCounts moves skipped Google work into the manual tail', () => {
  const pendingGoogle = makeEntry({
    isbn: '9780143473060',
    author: '',
    lookupState: {
      openLibrary: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:00:00.000Z',
        fieldsResolved: [],
      },
    },
  });

  const counts = getManualExceptionCounts([pendingGoogle], {
    googleBooksSkippedAt: '2026-03-29T15:00:00.000Z',
  });

  assert.equal(counts.pendingGoogleBooks, 0);
  assert.equal(counts.manualOnly, 1);
});

test('determineEnrichmentPhase keeps Google behind Open Library and India ISBN', () => {
  const pendingOl = makeEntry({
    isbn: '9781111111111',
    author: '',
  });
  assert.equal(determineEnrichmentPhase([pendingOl]), 'open-library');

  const pendingIndia = makeEntry({
    isbn: '9789353092511',
    author: '',
    lookupState: {
      openLibrary: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:00:00.000Z',
        fieldsResolved: [],
      },
    },
  });
  assert.equal(determineEnrichmentPhase([pendingIndia]), 'india-isbn');

  const pendingGoogle = makeEntry({
    isbn: '9780143473060',
    author: '',
    lookupState: {
      openLibrary: {
        status: 'miss',
        attempts: 1,
        lastAttemptAt: '2026-03-29T09:00:00.000Z',
        fieldsResolved: [],
      },
      googleBooks: {
        status: 'pending',
        attempts: 0,
        lastAttemptAt: '2026-03-29T09:05:00.000Z',
        fieldsResolved: [],
      },
    },
  });
  assert.equal(determineEnrichmentPhase([pendingGoogle]), 'google-books');
  assert.equal(
    determineEnrichmentPhase([pendingGoogle], {
      googleBooksSkippedAt: '2026-03-29T15:00:00.000Z',
    }),
    'done'
  );
});

test('cleanAuthorName removes prefixes, placeholders, and normalizes casing', () => {
  assert.equal(cleanAuthorName('Author-Jane Goodall'), 'Jane Goodall');
  assert.equal(cleanAuthorName('Nill'), '');
  assert.equal(cleanAuthorName('BHIKTI MATHUR'), 'Bhikti Mathur');
  assert.equal(cleanAuthorName('Shashi Tharoor , Joseph Zacharias'), 'Shashi Tharoor, Joseph Zacharias');
});

test('inferAuthorFromRawBrand extracts authors from composite inventory brands conservatively', () => {
  assert.equal(
    inferAuthorFromRawBrand('Michael Morpurgo / Barrington Stoke', 'Barrington Stoke'),
    'Michael Morpurgo'
  );
  assert.equal(
    inferAuthorFromRawBrand('Author-Arundhati Venkatesh / Not found'),
    'Arundhati Venkatesh'
  );
  assert.equal(inferAuthorFromRawBrand('Matt / Classic Football Heroes'), '');
});

test('inferPublisherFromRawBrand extracts canonical publishers from direct and composite brands', () => {
  assert.equal(inferPublisherFromRawBrand('magic cat'), 'Magic Cat');
  assert.equal(inferPublisherFromRawBrand('BARBARA BASH / Gibbs Smith'), 'Gibbs Smith');
  assert.equal(inferPublisherFromRawBrand('Author-Ashok Rajagopalan / Not found'), 'Unknown Publisher');
});

test('inferPublisherFromSearchAliases promotes a single canonical publisher from alias history', () => {
  const aliasOnly = makeEntry({
    publisher: 'Unknown Publisher',
    searchAliases: {
      titles: [],
      authors: [],
      publishers: ['Unknown', 'Eklavya Foundation'],
    },
  });

  assert.equal(inferPublisherFromSearchAliases(aliasOnly), 'Eklavya');

  const conflicting = makeEntry({
    publisher: 'Unknown Publisher',
    searchAliases: {
      titles: [],
      authors: [],
      publishers: ['Magic Cat', 'Innovation Press, The'],
    },
  });

  assert.equal(inferPublisherFromSearchAliases(conflicting), 'Unknown Publisher');
});

test('classifyTitleSuggestion separates likely typos from noisy source variants', () => {
  assert.equal(
    classifyTitleSuggestion(
      'Twinkles, Arthur and Puss',
      'Twinkle, Arthur and Puss'
    ),
    'likely-typo'
  );
  assert.equal(
    classifyTitleSuggestion(
      'The Lion The Witch And The Wardrobe',
      'The Lion, the Witch and the Wardrobe [Paperback] [Jan 01, 2010] C S LEWIS'
    ),
    'source-variant'
  );
});

test('cleanPublisherNameForWrite normalizes deterministic variants but preserves ambiguous composites', () => {
  assert.deepEqual(cleanPublisherNameForWrite('Speaking Tiger Books Llp'), {
    value: 'Speaking Tiger',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Speaking Tiger Publishing Ltd'), {
    value: 'Speaking Tiger',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Picadilly Press'), {
    value: 'Piccadilly Press',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Seagull Books Pvt.ltd ,india'), {
    value: 'Seagull Books',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Amar Chitra Katha Private Limited'), {
    value: 'Amar Chitra Katha',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Amar Chitra Katha Pvt'), {
    value: 'Amar Chitra Katha',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Blaft Publications Pvt. Limited'), {
    value: 'Blaft',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Aleph Book Company Private Limited'), {
    value: 'Aleph Book Company',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Tara Books Pvt Ltd'), {
    value: 'Tara Books',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Author-Arshia Sattar / Juggernaut Books'), {
    value: 'Juggernaut Books',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Mike Barfield / Buster Books'), {
    value: 'Buster Books',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Harry N. Abrams'), {
    value: 'Abrams',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Abramas comicarts'), {
    value: 'Abrams',
  });
  assert.deepEqual(cleanPublisherNameForWrite('magic cat'), {
    value: 'Magic Cat',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Manas Pratim Saikia Speaking Tiger Books Llp'), {
    value: 'Manas Pratim Saikia Speaking Tiger Books Llp',
    reviewCanonical: 'Speaking Tiger',
  });
  assert.deepEqual(cleanPublisherNameForWrite('Marion Billet / Listen to the'), {
    value: 'Marion Billet / Listen to the',
    reviewCanonical: 'Listen to the',
  });
});

test('getPublisherSuggestionAutofill only promotes medium prefix suggestions on placeholder brands', () => {
  const promotable = makeEntry({
    publisher: 'Unknown Publisher',
    rawBrand: 'Author-Ashok Rajagopalan / Not found',
    suggestion: {
      publisher: 'Tulika',
      source: 'isbn-prefix',
      confidence: 'medium',
      lookedUpAt: '2026-03-30T00:00:00.000Z',
    },
  });

  assert.deepEqual(getPublisherSuggestionAutofill(promotable), {
    publisher: 'Tulika',
    confidence: 'medium',
    reason: 'Medium-confidence ISBN-prefix suggestion on a placeholder inventory publisher',
  });

  const nonPlaceholder = makeEntry({
    publisher: 'Unknown Publisher',
    rawBrand: 'magic cat',
    suggestion: {
      publisher: 'Scribblers',
      source: 'isbn-prefix',
      confidence: 'medium',
      lookedUpAt: '2026-03-30T00:00:00.000Z',
    },
  });

  assert.equal(getPublisherSuggestionAutofill(nonPlaceholder), null);
});

test('applyTitleCandidate only auto-fixes on two-source agreement or India ISBN authority', () => {
  const entry = makeEntry({
    isbn: '9789999999999',
    name: 'Hapiness City',
    rawName: 'Hapiness City',
    titleSource: 'inventory',
  });

  assert.equal(applyTitleCandidate(entry, 'Happiness City', 'open-library'), false);
  assert.equal(entry.name, 'Hapiness City');
  assert.deepEqual(entry.searchAliases?.titles, ['Happiness City']);

  assert.equal(applyTitleCandidate(entry, 'Happiness City', 'google-books'), true);
  assert.equal(entry.name, 'Happiness City');
  assert.equal(entry.titleSource, 'google-books');

  const indiaEntry = makeEntry({
    isbn: '9788888888888',
    name: 'Bad Ttile',
    rawName: 'Bad Ttile',
    titleSource: 'inventory',
  });

  assert.equal(applyTitleCandidate(indiaEntry, 'Bad Title', 'india-isbn', { authoritative: true }), true);
  assert.equal(indiaEntry.name, 'Bad Title');
  assert.equal(indiaEntry.titleSource, 'india-isbn');
});

test('search aliases dedupe case-insensitively and cap at five values', () => {
  const entry = makeEntry({});

  addSearchAlias(entry, 'publishers', 'Speaking Tiger');
  addSearchAlias(entry, 'publishers', ' speaking tiger ');
  addSearchAlias(entry, 'publishers', 'Speaking Tiger Books LLP');
  addSearchAlias(entry, 'publishers', 'Speaking Tiger Books Llp');
  addSearchAlias(entry, 'publishers', 'ST');
  addSearchAlias(entry, 'publishers', 'Speaking Tiger India');
  addSearchAlias(entry, 'publishers', 'Tiger Books');

  assert.equal(entry.searchAliases?.publishers.length, 5);
  assert.deepEqual(entry.searchAliases?.publishers, [
    'Speaking Tiger',
    'Speaking Tiger Books LLP',
    'ST',
    'Speaking Tiger India',
    'Tiger Books',
  ]);
});

test('tag hygiene removes boilerplate and caps categories and subjects', () => {
  const sanitized = sanitizeTagData({
    ageGroup: 'Middle Grade (8-12)',
    categories: ['History', 'History', 'Science', 'Fantasy', 'Art', 'Biography'],
    subjects: [
      'Open Library Staff Picks',
      'NYT: Bestseller',
      'Animals',
      'Animals',
      'Series: Dog Man',
      'Friendship',
      'School',
      'Adventure',
      'Mystery',
      'Humor',
      'Courage',
    ],
    source: 'open-library',
    confidence: 'high',
    taggedAt: '2026-03-29T00:00:00.000Z',
  });

  assert.deepEqual(sanitized?.categories, ['History', 'Science', 'Fantasy', 'Art']);
  assert.deepEqual(sanitized?.subjects, [
    'Animals',
    'Friendship',
    'School',
    'Adventure',
    'Mystery',
    'Humor',
    'Courage',
  ]);
});

test('sanitizeTagData drops empty tag shells after cleanup', () => {
  assert.equal(sanitizeTagData({
    categories: [],
    subjects: ['Open Library Staff Picks'],
    source: 'open-library',
    confidence: 'high',
    taggedAt: '2026-03-29T00:00:00.000Z',
  }), undefined);
});

test('getTagHygieneSuggestion only returns a value when pruning changes tags', () => {
  const entry = makeEntry({
    tagData: {
      ageGroup: 'Adult (18+)',
      categories: ['History', 'History'],
      subjects: ['Open Library Staff Picks', 'Politics'],
      source: 'open-library',
      confidence: 'high',
      taggedAt: '2026-03-29T00:00:00.000Z',
    },
  });

  assert.deepEqual(getTagHygieneSuggestion(entry), {
    ageGroup: 'Adult (18+)',
    categories: ['History'],
    subjects: ['Politics'],
    source: 'open-library',
    confidence: 'high',
    taggedAt: '2026-03-29T00:00:00.000Z',
  });
});

test('inferCatalogHeuristicTagData uses title signals first and publisher profiles as age fallback', () => {
  const profileEntries = [
    ...Array.from({ length: 8 }, (_, index) => makeEntry({
      isbn: `97800000000${index + 10}`,
      publisher: 'Pratham Books',
      tagData: {
        ageGroup: 'Picture Book (3-6)',
        categories: [],
        subjects: [],
        source: 'manual',
        confidence: 'high',
        taggedAt: '2026-03-29T00:00:00.000Z',
      },
    })),
  ];
  const profiles = buildPublisherTagProfiles(profileEntries);

  const activityEntry = makeEntry({
    isbn: '9789999999998',
    name: 'Amazing Women A Memory Game',
    publisher: 'Duckbill Books',
  });
  const activityTags = inferCatalogHeuristicTagData(activityEntry, profiles, new Date('2026-03-30T00:00:00.000Z'));
  assert.deepEqual(activityTags, {
    ageGroup: 'Middle Grade (8-12)',
    categories: ['Activity Book'],
    subjects: ['Activities'],
    source: 'catalog-heuristic',
    confidence: 'medium',
    taggedAt: '2026-03-30T00:00:00.000Z',
  });

  const profileFallbackEntry = makeEntry({
    isbn: '9789999999997',
    name: 'A Quiet New Story',
    publisher: 'Pratham Books',
  });
  const profileFallbackTags = inferCatalogHeuristicTagData(profileFallbackEntry, profiles, new Date('2026-03-30T00:00:00.000Z'));
  assert.deepEqual(profileFallbackTags, {
    ageGroup: 'Picture Book (3-6)',
    categories: [],
    subjects: [],
    source: 'catalog-heuristic',
    confidence: 'low',
    taggedAt: '2026-03-30T00:00:00.000Z',
  });

  const minecraftEntry = makeEntry({
    isbn: '9789999999996',
    name: 'Diary Of A Minecraft Zombie Box Set',
    publisher: '4u2read',
  });
  const minecraftTags = inferCatalogHeuristicTagData(minecraftEntry, profiles, new Date('2026-03-30T00:00:00.000Z'));
  assert.deepEqual(minecraftTags, {
    ageGroup: 'Middle Grade (8-12)',
    categories: ['Fiction'],
    subjects: [],
    source: 'catalog-heuristic',
    confidence: 'medium',
    taggedAt: '2026-03-30T00:00:00.000Z',
  });
});

test('applyCuratedPublisherOverrides resolves safe composite publisher strings', () => {
  const nosyCrow = makeEntry({
    isbn: '9781839947599',
    publisher: 'Marion Billet / Listen to the',
  });
  assert.equal(applyCuratedPublisherOverrides(nosyCrow), true);
  assert.equal(nosyCrow.publisher, 'Nosy Crow');
  assert.deepEqual(nosyCrow.searchAliases?.publishers, ['Nosy Crow', 'Marion Billet / Listen to the']);

  const dreamers = makeEntry({
    isbn: '9788195697618',
    publisher: 'Lavanya Karthik / Dreamers',
  });
  assert.equal(applyCuratedPublisherOverrides(dreamers), true);
  assert.equal(dreamers.publisher, 'Kalpavriksh');

  const exactUnknown = makeEntry({
    isbn: '9789384375331',
    publisher: 'Unknown Publisher',
  });
  assert.equal(applyCuratedPublisherOverrides(exactUnknown), true);
  assert.equal(exactUnknown.publisher, 'Ektara');
});

test('applyCuratedAuthorOverrides fills curated high-value missing authors', () => {
  const littlePeople = makeEntry({
    isbn: '9780711286900',
    name: 'Little People, Big Dreams Dwayne Johnson',
    publisher: 'HarperCollins',
  });
  assert.equal(applyCuratedAuthorOverrides(littlePeople), true);
  assert.equal(littlePeople.author, 'Maria Isabel Sanchez Vegara');
  assert.equal(littlePeople.authorSource, 'manual');
  assert.equal(littlePeople.authorConfirmed, true);

  const exact = makeEntry({
    isbn: '9781805134312',
    name: 'The Dog is Full of Love',
    publisher: 'Nosy Crow',
  });
  assert.equal(applyCuratedAuthorOverrides(exact), true);
  assert.equal(exact.author, 'Lou Peacock');
});

test('applyCuratedTagOverrides prefers exact/title matches before publisher defaults', () => {
  const now = new Date('2026-03-30T00:00:00.000Z');

  const exactMatch = makeEntry({
    isbn: '9780711286887',
    name: 'Maya Angelou',
    publisher: 'Frances Lincoln',
  });
  assert.equal(applyCuratedTagOverrides(exactMatch, now), true);
  assert.deepEqual(exactMatch.tagData, {
    ageGroup: 'Middle Grade (8-12)',
    categories: ['Biography'],
    subjects: [],
    source: 'manual',
    confidence: 'high',
    taggedAt: '2026-03-30T00:00:00.000Z',
  });
  assert.equal(exactMatch.tagsConfirmed, true);

  const titleMatch = makeEntry({
    isbn: '9781234567890',
    name: 'Atomic Habits',
    publisher: 'Penguin Random House',
  });
  assert.equal(applyCuratedTagOverrides(titleMatch, now), true);
  assert.deepEqual(titleMatch.tagData, {
    ageGroup: 'Adult (18+)',
    categories: ['Self-Help'],
    subjects: [],
    source: 'manual',
    confidence: 'high',
    taggedAt: '2026-03-30T00:00:00.000Z',
  });

  const curatedExact = makeEntry({
    isbn: '9780241667828',
    name: "Unstoppable Us Why The World Isn't Fair",
    publisher: 'Penguin Random House',
  });
  assert.equal(applyCuratedTagOverrides(curatedExact, now), true);
  assert.deepEqual(curatedExact.tagData, {
    ageGroup: 'Middle Grade (8-12)',
    categories: ['History', 'Education'],
    subjects: [],
    source: 'manual',
    confidence: 'high',
    taggedAt: '2026-03-30T00:00:00.000Z',
  });

  const publisherDefault = makeEntry({
    isbn: '9789999999996',
    name: 'A Quiet Story',
    publisher: 'Little Latitude',
  });
  assert.equal(applyCuratedTagOverrides(publisherDefault, now), true);
  assert.deepEqual(publisherDefault.tagData, {
    ageGroup: 'Picture Book (3-6)',
    categories: [],
    subjects: [],
    source: 'manual',
    confidence: 'low',
    taggedAt: '2026-03-30T00:00:00.000Z',
  });

  const graphicMatch = makeEntry({
    isbn: '9781302932831',
    name: 'X-MEN RED BY AL EWING VOL. 1',
    publisher: '4u2read',
  });
  assert.equal(applyCuratedTagOverrides(graphicMatch, now), true);
  assert.deepEqual(graphicMatch.tagData, {
    ageGroup: 'Young Adult (12-18)',
    categories: ['Graphic Novel', 'Fiction'],
    subjects: [],
    source: 'manual',
    confidence: 'high',
    taggedAt: '2026-03-30T00:00:00.000Z',
  });
});

test('normalizeIndiaIsbnAuthors splits co-authors and removes labels', () => {
  assert.deepEqual(
    normalizeIndiaIsbnAuthors('Author : Bhawna Jaimini, Co-Author :Deepa Balsavar'),
    ['Bhawna Jaimini', 'Deepa Balsavar']
  );
});

test('parseIndiaIsbnSearchResult extracts author, publisher, and language from HTML table rows', () => {
  const html = `
    <div class="table-responsive">
      <table id="example">
        <tbody class="text-center">
          <tr>
            <td>1</td>
            <td>Happiness City</td>
            <td class="text-left">978-93-341-3202-1</td>
            <td>Paperback / softback</td>
            <td>English</td>
            <td class="text-left">People Place Project</td>
            <td class="text-left">Author : Bhawna Jaimini, Co-Author :Deepa Balsavar</td>
            <td class="text-left">23-09-2024</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  assert.deepEqual(parseIndiaIsbnSearchResult(html, '9789334132021'), {
    title: 'Happiness City',
    isbn: '9789334132021',
    productForm: 'Paperback / softback',
    language: 'English',
    publisher: 'People Place Project',
    authors: ['Bhawna Jaimini', 'Deepa Balsavar'],
    allottedDate: '23-09-2024',
  });
  assert.equal(parseIndiaIsbnSearchResult(html, '9780000000000'), null);
});

test('importPublisherDistributorMappingFile prefers live imprint keys and falls back to live parent keys', () => {
  const catalog = makeCatalog([
    makeEntry({
      isbn: '9781839947599',
      publisher: 'Nosy Crow',
    }),
    makeEntry({
      isbn: '9781250356897',
      publisher: 'First Second',
      imprint: 'First Second',
      parentPublisher: 'Pan Macmillan',
    }),
  ]);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightroom-dist-map-'));
  const filePath = path.join(tempDir, 'publisher-distributor.csv');
  fs.writeFileSync(filePath, [
    'Publisher,Distributor',
    'Nosy Crow (Harper Collins),PBD',
    'First Second (Pan Macmillian),IBD',
  ].join('\n'));

  const summary = importPublisherDistributorMappingFile(catalog, filePath);

  assert.equal(summary.appliedMappings, 2);
  assert.equal(summary.createdDistributors, 2);
  assert.deepEqual(summary.unresolvedPublishers, []);
  assert.deepEqual(catalog.publisherDistributors['Nosy Crow'], ['dist_pbd']);
  assert.deepEqual(catalog.publisherDistributors['Pan Macmillan'], ['dist_ibd']);
  assert.equal(catalog.distributors.find(distributor => distributor.name === 'PBD')?.id, 'dist_pbd');
  assert.equal(catalog.distributors.find(distributor => distributor.name === 'IBD')?.id, 'dist_ibd');
});

test('searchWorkspace filters on publisher assignment, stock state, and cleanup gaps', () => {
  const pratham = makeEntry({
    isbn: '9789353092511',
    name: "Nani's Walk to the Park",
    author: 'Deepa Balsavar',
    publisher: 'Pratham Books',
    currentStock: 3,
    revenue: 1200,
    qtySold: 12,
    tagData: {
      ageGroup: 'Picture Book (3-6)',
      categories: ['Fiction'],
      subjects: ['Family'],
      source: 'manual',
      confidence: 'high',
      taggedAt: '2026-03-30T00:00:00.000Z',
    },
  });
  const harper = makeEntry({
    isbn: '9781839947599',
    name: 'Listen to the Birds',
    publisher: 'Nosy Crow',
    imprint: 'Nosy Crow',
    parentPublisher: 'HarperCollins',
    currentStock: 0,
    revenue: 400,
    qtySold: 4,
    tagData: {
      ageGroup: 'Picture Book (3-6)',
      categories: ['Nature'],
      subjects: ['Birds'],
      source: 'manual',
      confidence: 'high',
      taggedAt: '2026-03-30T00:00:00.000Z',
    },
  });
  const missingTags = makeEntry({
    isbn: '9780143473060',
    name: 'Unfinished Book',
    author: 'Someone',
    publisher: 'Pratham Books',
    currentStock: 9,
    revenue: 50,
    qtySold: 1,
  });

  const catalog = makeCatalog([pratham, harper, missingTags]);
  catalog.distributors = [
    { id: 'dist_pratham', name: 'Pratham Distribution' },
    { id: 'dist_pbd', name: 'PBD' },
  ];
  catalog.publisherDistributors = {
    'Pratham Books': ['dist_pratham'],
    HarperCollins: ['dist_pbd'],
  };

  const publisherResults = searchWorkspace(catalog, {
    publisher: 'Pratham',
    stock: 'low',
    mapped: 'mapped',
    cleanup: 'clean',
  });
  assert.deepEqual(publisherResults.map(row => row.isbn), ['9789353092511']);

  const cleanupResults = searchWorkspace(catalog, {
    publisher: 'Pratham Books',
    missing: ['tags'],
  });
  assert.deepEqual(cleanupResults.map(row => row.isbn), ['9780143473060']);

  const distributorResults = searchWorkspace(catalog, {
    distributor: 'PBD',
    stock: 'out',
  });
  assert.deepEqual(distributorResults.map(row => row.isbn), ['9781839947599']);
});

test('searchWorkspace supports numeric stock thresholds', () => {
  const highStock = makeEntry({
    isbn: '9781509804757',
    name: 'The Gruffalo',
    author: 'Julia Donaldson',
    publisher: 'Scholastic',
    currentStock: 9,
  });
  const lowStock = makeEntry({
    isbn: '9781509812523',
    name: 'The Snail and the Whale',
    author: 'Julia Donaldson',
    publisher: 'Scholastic',
    currentStock: 4,
  });

  const catalog = makeCatalog([highStock, lowStock]);
  const results = searchWorkspace(catalog, {
    query: 'Julia Donaldson',
    stock: 'in',
    stockMin: 6,
  });

  assert.deepEqual(results.map(row => row.isbn), ['9781509804757']);
});

test('searchWorkspace supports author and theme specific filters', () => {
  const warBook = makeEntry({
    isbn: '9780143333005',
    name: 'A Child at War',
    author: 'Naima Pathak',
    publisher: 'Duckbill Books',
    tagData: {
      ageGroup: 'Picture Book (3-6)',
      categories: ['Fiction'],
      subjects: ['War', 'Conflict'],
      source: 'manual',
      confidence: 'high',
      taggedAt: '2026-03-30T00:00:00.000Z',
    },
  });
  const donaldson = makeEntry({
    isbn: '9781509804757',
    name: 'The Gruffalo',
    author: 'Julia Donaldson',
    publisher: 'Scholastic',
    currentStock: 9,
  });

  const catalog = makeCatalog([warBook, donaldson]);

  assert.deepEqual(
    searchWorkspace(catalog, { authorQuery: 'Julia Donaldson' }).map(row => row.isbn),
    ['9781509804757']
  );
  assert.deepEqual(
    searchWorkspace(catalog, { themeQuery: 'war', ageGroup: 'Picture Book (3-6)' }).map(row => row.isbn),
    ['9780143333005']
  );
});

test('searchWorkspace supports stock and sales sorting', () => {
  const highStockLowSales = makeEntry({
    isbn: '9781509804757',
    name: 'The Gruffalo',
    author: 'Julia Donaldson',
    publisher: 'Scholastic',
    currentStock: 9,
    qtySold: 3,
    revenue: 1000,
  });
  const lowStockHighSales = makeEntry({
    isbn: '9781509812523',
    name: 'The Snail and the Whale',
    author: 'Julia Donaldson',
    publisher: 'Scholastic',
    currentStock: 4,
    qtySold: 14,
    revenue: 5702,
  });

  const catalog = makeCatalog([highStockLowSales, lowStockHighSales]);

  assert.deepEqual(
    searchWorkspace(catalog, { sort: 'stock_desc' }).map(row => row.isbn),
    ['9781509804757', '9781509812523']
  );
  assert.deepEqual(
    searchWorkspace(catalog, { sort: 'sales_desc' }).map(row => row.isbn),
    ['9781509812523', '9781509804757']
  );
});

test('searchWorkspace matches any clause in queryAny', () => {
  const roy = makeEntry({
    isbn: '9780670091157',
    name: 'The Ministry of Utmost Happiness',
    author: 'Arundhati Roy',
    publisher: 'Penguin Random House',
    currentStock: 6,
  });
  const donaldson = makeEntry({
    isbn: '9781509804757',
    name: 'The Gruffalo',
    author: 'Julia Donaldson',
    publisher: 'Scholastic',
    currentStock: 9,
  });
  const other = makeEntry({
    isbn: '9789353092511',
    name: "Nani's Walk to the Park",
    author: 'Deepa Balsavar',
    publisher: 'Pratham Books',
    currentStock: 9,
  });

  const catalog = makeCatalog([roy, donaldson, other]);
  const results = searchWorkspace(catalog, {
    queryAny: ['arundhati roy', 'julia donaldson'],
    stockMin: 4,
  });

  assert.deepEqual(results.map(row => row.isbn), ['9780670091157', '9781509804757']);
});

test('searchWorkspace matches author clauses despite spacing-only name splits', () => {
  const roy = makeEntry({
    isbn: '9780143473060',
    name: 'Mother Mary Comes to Me',
    author: 'Arundhati Roy',
    publisher: 'Penguin Random House',
    currentStock: 6,
    revenue: 2000,
  });
  const other = makeEntry({
    isbn: '9789353092511',
    name: "Nani's Walk to the Park",
    author: 'Deepa Balsavar',
    publisher: 'Pratham Books',
    currentStock: 6,
    revenue: 1000,
  });

  const catalog = makeCatalog([roy, other]);
  const results = searchWorkspace(catalog, {
    authorQueryAny: ['arun dhati roy'],
  });

  assert.deepEqual(results.map(row => row.isbn), ['9780143473060']);
});

test('searchWorkspace interleaves OR author clauses so both sides appear early', () => {
  const roy = makeEntry({
    isbn: '9780143473060',
    name: 'Mother Mary Comes to Me',
    author: 'Arundhati Roy',
    publisher: 'Penguin Random House',
    currentStock: 6,
    revenue: 100,
  });
  const donaldsonA = makeEntry({
    isbn: '9781509804757',
    name: 'The Gruffalo',
    author: 'Julia Donaldson',
    publisher: 'Scholastic',
    currentStock: 9,
    revenue: 5000,
  });
  const donaldsonB = makeEntry({
    isbn: '9781509812523',
    name: 'The Snail and the Whale',
    author: 'Julia Donaldson',
    publisher: 'Scholastic',
    currentStock: 4,
    revenue: 4000,
  });

  const catalog = makeCatalog([donaldsonA, donaldsonB, roy]);
  const results = searchWorkspace(catalog, {
    authorQueryAny: ['julia donaldson', 'arundhati roy'],
    limit: 3,
  });

  assert.deepEqual(results.slice(0, 2).map(row => row.author), ['Julia Donaldson', 'Arundhati Roy']);
});

test('searchWorkspace exposes match basis and tag source for thematic queries', () => {
  const friendshipBook = makeEntry({
    isbn: '9781408331606',
    name: 'The Lion Inside',
    author: 'Rachel Bright',
    publisher: 'Orchard Books',
    tagData: {
      ageGroup: 'Middle Grade (8-12)',
      categories: ['Fiction'],
      subjects: ['Friendship', 'Self-Confidence'],
      source: 'open-library',
      confidence: 'medium',
      taggedAt: '2026-03-30T00:00:00.000Z',
    },
  });

  const catalog = makeCatalog([friendshipBook]);
  const [result] = searchWorkspace(catalog, {
    query: 'friendship',
    ageGroup: 'Middle Grade (8-12)',
  });

  assert.equal(result.matchConfidence, 'medium');
  assert.match(result.matchBasis.join(' | '), /Subject tag: Friendship/);
  assert.match(result.matchBasis.join(' | '), /Tag source: open-library \(medium\)/);
});

test('searchWorkspace does not match substring fragments inside unrelated words', () => {
  const warBook = makeEntry({
    isbn: '9780143333005',
    name: 'A Child at War',
    author: 'Naima Pathak',
    publisher: 'Duckbill Books',
    tagData: {
      ageGroup: 'Middle Grade (8-12)',
      categories: ['Fiction'],
      subjects: ['War', 'Conflict'],
      source: 'manual',
      confidence: 'high',
      taggedAt: '2026-03-30T00:00:00.000Z',
    },
  });
  const anwarBook = makeEntry({
    isbn: '9789386667830',
    name: 'The Story of Shahid Anwar',
    author: 'Shahid Anwar',
    publisher: 'Tulika',
    tagData: {
      ageGroup: 'Middle Grade (8-12)',
      categories: ['Biography'],
      subjects: ['People'],
      source: 'manual',
      confidence: 'high',
      taggedAt: '2026-03-30T00:00:00.000Z',
    },
  });
  const warmBook = makeEntry({
    isbn: '9781529501018',
    name: 'Hot Tea and Warm Rugs',
    author: 'Rukhsana Khan',
    publisher: 'Walker Books',
    tagData: {
      ageGroup: 'Picture Book (3-6)',
      categories: ['Fiction'],
      subjects: ['Home'],
      source: 'manual',
      confidence: 'high',
      taggedAt: '2026-03-30T00:00:00.000Z',
    },
  });
  const ishwarBook = makeEntry({
    isbn: '9788181461940',
    name: 'Snoring Shanmugam',
    author: 'Ishwar',
    publisher: 'Eklavya',
    tagData: {
      ageGroup: 'Picture Book (3-6)',
      categories: ['Fiction'],
      subjects: ['Humor'],
      source: 'manual',
      confidence: 'high',
      taggedAt: '2026-03-30T00:00:00.000Z',
    },
  });

  const catalog = makeCatalog([warBook, anwarBook, warmBook, ishwarBook]);
  const results = searchWorkspace(catalog, { query: 'war' });

  assert.deepEqual(results.map(row => row.isbn), ['9780143333005']);
});

test('parseWorkspaceNaturalLanguage converts stock thresholds into structured filters', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const parsed = await parseWorkspaceNaturalLanguage(
      'books by julia donaldson that are in stock with more than five units',
      {
        publishers: [],
        distributors: [],
      }
    );

    assert.equal(parsed.mode, 'heuristic');
    assert.equal(parsed.filters.authorQuery, 'julia donaldson');
    assert.equal(parsed.filters.stock, 'in');
    assert.equal(parsed.filters.stockMin, 6);
    assert.equal(parsed.filters.publisher, undefined);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  }
});

test('parseWorkspaceNaturalLanguage supports OR queries via queryAny clauses', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const parsed = await parseWorkspaceNaturalLanguage(
      'books by arundhati roy or julia donaldson with more than three copies',
      {
        publishers: [],
        distributors: [],
      }
    );

    assert.equal(parsed.mode, 'heuristic');
    assert.deepEqual(parsed.filters.authorQueryAny, ['arundhati roy', 'julia donaldson']);
    assert.equal(parsed.filters.stockMin, 4);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  }
});

test('parseWorkspaceNaturalLanguage treats "picture books about war" as theme + age, not publisher', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const parsed = await parseWorkspaceNaturalLanguage(
      'picture books about war',
      {
        publishers: ['Picture Books', 'Tulika'],
        distributors: [],
      }
    );

    assert.equal(parsed.mode, 'heuristic');
    assert.equal(parsed.filters.publisher, undefined);
    assert.equal(parsed.filters.themeQuery, 'war');
    assert.equal(parsed.filters.ageGroup, 'Picture Book (3-6)');
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  }
});

test('parseWorkspaceNaturalLanguage maps elementary prompts onto multiple age bands', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const parsed = await parseWorkspaceNaturalLanguage(
      'books on friendship for elementary grade students',
      {
        publishers: [],
        distributors: [],
      }
    );

    assert.equal(parsed.mode, 'heuristic');
    assert.equal(parsed.filters.themeQuery, 'friendship');
    assert.deepEqual(parsed.filters.ageGroupsAny, ['Early Reader (5-8)', 'Middle Grade (8-12)']);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  }
});

test('buildWorkspaceOrderDraft groups mapped and unmapped items separately', () => {
  const mapped = makeEntry({
    isbn: '9789353092511',
    name: "Nani's Walk to the Park",
    author: 'Deepa Balsavar',
    publisher: 'Pratham Books',
    currentStock: 4,
    qtySold: 6,
    revenue: 1800,
  });
  const unmapped = makeEntry({
    isbn: '9789999999999',
    name: 'Independent Title',
    author: 'Indie Author',
    publisher: 'Small Indie Press',
    currentStock: 2,
    qtySold: 1,
    revenue: 200,
  });

  const catalog = makeCatalog([mapped, unmapped]);
  catalog.distributors = [{ id: 'dist_pratham', name: 'Pratham Distribution' }];
  catalog.publisherDistributors = {
    'Pratham Books': ['dist_pratham'],
  };

  const draft = buildWorkspaceOrderDraft(catalog, [
    { isbn: '9789353092511', quantity: 5 },
    { isbn: '9789999999999', quantity: 2 },
  ], {
    title: 'April Refill',
  });

  assert.equal(draft.title, 'April Refill');
  assert.equal(draft.groups.length, 2);
  assert.equal(draft.groups[0].distributorName, 'Pratham Distribution');
  assert.deepEqual(draft.groups[0].assignmentKeys, ['Pratham Books']);
  assert.equal(draft.groups[1].groupKey, 'unmapped:Small Indie Press');
  assert.equal(draft.groups[1].items[0].isbn, '9789999999999');
});

test('buildWorkspaceOrderDraft duplicates items when multiple distributors are selected', () => {
  const entry = makeEntry({
    isbn: '9789353092511',
    name: "Nani's Walk to the Park",
    author: 'Deepa Balsavar',
    publisher: 'Pratham Books',
    currentStock: 4,
    qtySold: 6,
    revenue: 1800,
  });

  const catalog = makeCatalog([entry]);
  catalog.distributors = [
    { id: 'dist_primary', name: 'Primary Dist' },
    { id: 'dist_secondary', name: 'Secondary Dist' },
  ];
  catalog.publisherDistributors = {
    'Pratham Books': ['dist_primary', 'dist_secondary'],
  };

  const draft = buildWorkspaceOrderDraft(catalog, [
    {
      isbn: '9789353092511',
      quantity: 5,
      distributorIds: ['dist_primary', 'dist_secondary'],
    },
  ], {
    title: 'April Refill',
  });

  assert.equal(draft.groups.length, 2);
  assert.equal(draft.groups[0].distributorName, 'Primary Dist');
  assert.equal(draft.groups[1].distributorName, 'Secondary Dist');
  assert.equal(draft.groups[0].items[0].isbn, '9789353092511');
  assert.equal(draft.groups[1].items[0].isbn, '9789353092511');
});
