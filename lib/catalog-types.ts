// Master Catalog — single source of truth for book metadata

export type AgeGroup =
  | 'Baby/Toddler (0-3)'
  | 'Picture Book (3-6)'
  | 'Early Reader (5-8)'
  | 'Middle Grade (8-12)'
  | 'Young Adult (12-18)'
  | 'Adult (18+)';

export const AGE_GROUPS: AgeGroup[] = [
  'Baby/Toddler (0-3)',
  'Picture Book (3-6)',
  'Early Reader (5-8)',
  'Middle Grade (8-12)',
  'Young Adult (12-18)',
  'Adult (18+)',
];

export const BROAD_CATEGORIES = [
  'Fiction', 'Non-Fiction', 'Fantasy', 'Mystery', 'Adventure', 'Romance',
  'Horror', 'Mythology', 'Science', 'History', 'Biography', 'Self-Help',
  'Humor', 'Poetry', 'Nature', 'Art', 'Cooking', 'Philosophy', 'Sports',
  'Graphic Novel', 'Activity Book', 'Board Book', 'Religious', 'Education', 'Parenting',
] as const;

export type BroadCategory = typeof BROAD_CATEGORIES[number];
export type CatalogScope = 'book' | 'excluded';
export type CatalogExclusionReason = 'invalid_isbn' | 'product_category';
export type MetadataSource =
  | 'inventory'
  | 'indian-stock'
  | 'india-isbn'
  | 'open-library'
  | 'google-books'
  | 'manual';
export type LookupField = 'author' | 'publisher' | 'tags';
export type LookupStatus = 'pending' | 'hit' | 'miss' | 'error' | 'rate_limited';

export interface LookupState {
  status: LookupStatus;
  attempts: number;
  lastAttemptAt?: string;
  nextEligibleAt?: string;
  fieldsResolved: LookupField[];
}

export interface LookupStateBySource {
  openLibrary?: LookupState;
  indiaIsbn?: LookupState;
  googleBooks?: LookupState;
}

export interface TagData {
  ageGroup?: AgeGroup;
  categories: string[];      // Layer 1 broad categories (from BROAD_CATEGORIES)
  subjects: string[];        // Layer 2 detailed subjects (free-form)
  source: 'google-books' | 'open-library' | 'publisher-heuristic' | 'catalog-heuristic' | 'manual';
  confidence: 'high' | 'medium' | 'low';
  taggedAt: string;          // ISO timestamp
  rawCategories?: string[];  // original API response for re-mapping
}

export interface SearchAliases {
  titles: string[];
  authors: string[];
  publishers: string[];
}

export interface CatalogEntry {
  isbn: string;
  name: string;
  rawName?: string;
  titleSource?: MetadataSource;
  author: string;
  authorSource?: MetadataSource;
  publisher: string;            // canonical publisher label used for display/search
  imprint?: string;             // explicit imprint / sub-brand when known
  parentPublisher?: string;     // owning parent publisher when known
  publisherSource?: MetadataSource;
  scope: CatalogScope;
  exclusionReason?: CatalogExclusionReason;
  language?: string;
  category?: string;
  rawBrand: string;             // original Brand value, for debugging
  subBrand: string;             // original Sub Brand value
  currentStock?: number;
  mrp?: number;
  sellingPrice?: number;
  publisherConfirmed: boolean;  // has a human verified this?
  authorConfirmed: boolean;
  revenue: number;              // from sales (for sort/prioritization only)
  qtySold: number;
  suggestion?: {
    publisher?: string;
    author?: string;
        source: 'google-books' | 'open-library' | 'isbn-prefix';
        confidence: 'high' | 'medium' | 'low';
        lookedUpAt: string;         // ISO timestamp
  };
  tagData?: TagData;
  searchAliases?: SearchAliases;
  lookupState?: LookupStateBySource;
  tagsConfirmed: boolean;
}

export interface Distributor {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
}

export interface MasterCatalog {
  version: number;
  lastBuilt: string;                              // ISO timestamp
  entries: Record<string, CatalogEntry>;           // keyed by ISBN
  distributors: Distributor[];                     // distributor companies
  publisherDistributors: Record<string, string[]>; // publisher → ordered distributor IDs
  sourceFiles?: {
    inventoryFile?: string;
    salesFile?: string;
    distributorMappingFile?: string;
  };
  enrichmentState?: {
    googleBooksBlockedUntil?: string;
    googleBooksSkippedAt?: string;
  };
}
