/**
 * Tag Mapper — converts Google Books BISAC categories and Open Library subjects
 * into our two-layer tag system (broad categories + detailed subjects) plus age groups.
 */

import { AgeGroup, BroadCategory, BROAD_CATEGORIES, CatalogEntry, TagData } from './catalog-types';

// ─── Types ───

export interface MappedTags {
  ageGroup?: AgeGroup;
  categories: string[];   // broad categories from our fixed list
  subjects: string[];     // detailed subjects (free-form)
}

export interface PublisherTagProfile {
  publisher: string;
  taggedCount: number;
  dominantAgeGroup?: AgeGroup;
  dominantAgeShare: number;
}

// ─── BISAC Category Mapping ───

/**
 * Maps BISAC path segments to our broad categories.
 * Google Books returns strings like "Juvenile Fiction / Fantasy & Magic"
 * or "Self-Help / Personal Growth / General".
 */
const BISAC_TO_CATEGORY: Record<string, BroadCategory> = {
  // Fiction types
  'fiction': 'Fiction',
  'literary fiction': 'Fiction',
  'general fiction': 'Fiction',
  'fantasy': 'Fantasy',
  'fantasy & magic': 'Fantasy',
  'science fiction': 'Fiction',
  'science fiction & fantasy': 'Fantasy',
  'mystery': 'Mystery',
  'mystery & detective': 'Mystery',
  'mystery & detective stories': 'Mystery',
  'mysteries & detective stories': 'Mystery',
  'thrillers': 'Mystery',
  'suspense': 'Mystery',
  'adventure': 'Adventure',
  'adventure & adventurers': 'Adventure',
  'action & adventure': 'Adventure',
  'romance': 'Romance',
  'love & romance': 'Romance',
  'horror': 'Horror',
  'ghost stories': 'Horror',
  'scary stories': 'Horror',
  'humor': 'Humor',
  'humorous stories': 'Humor',
  'humorous fiction': 'Humor',
  'comics & graphic novels': 'Graphic Novel',
  'graphic novels': 'Graphic Novel',
  'comic books': 'Graphic Novel',
  'manga': 'Graphic Novel',

  // Non-fiction types
  'nonfiction': 'Non-Fiction',
  'non-fiction': 'Non-Fiction',
  'science': 'Science',
  'science & nature': 'Science',
  'science & technology': 'Science',
  'technology': 'Science',
  'mathematics': 'Science',
  'nature': 'Nature',
  'nature & the natural world': 'Nature',
  'animals': 'Nature',
  'history': 'History',
  'historical': 'History',
  'historical fiction': 'History',
  'biography': 'Biography',
  'biography & autobiography': 'Biography',
  'autobiographies': 'Biography',
  'biographies': 'Biography',
  'self-help': 'Self-Help',
  'personal growth': 'Self-Help',
  'self-improvement': 'Self-Help',
  'motivation': 'Self-Help',
  'motivational': 'Self-Help',
  'poetry': 'Poetry',
  'poems': 'Poetry',
  'art': 'Art',
  'art & architecture': 'Art',
  'music': 'Art',
  'performing arts': 'Art',
  'cooking': 'Cooking',
  'food': 'Cooking',
  'philosophy': 'Philosophy',
  'psychology': 'Philosophy',
  'sports': 'Sports',
  'sports & recreation': 'Sports',
  'games & activities': 'Activity Book',
  'activity books': 'Activity Book',
  'interactive adventures': 'Activity Book',
  'puzzles & games': 'Activity Book',
  'religion': 'Religious',
  'religious': 'Religious',
  'spirituality': 'Religious',
  'bibles': 'Religious',
  'mythology': 'Mythology',
  'myths': 'Mythology',
  'fairy tales & folklore': 'Mythology',
  'fairy tales': 'Mythology',
  'legends, myths, fables': 'Mythology',
  'folklore': 'Mythology',
  'education': 'Education',
  'study aids': 'Education',
  'reference': 'Education',
  'family': 'Parenting',
  'parenting': 'Parenting',
  'family & relationships': 'Parenting',
  'board books': 'Board Book',
};

// ─── Age Group from BISAC ───

/**
 * Infer age group from BISAC category string.
 * "Juvenile Fiction" → Middle Grade, "Young Adult Fiction" → YA, etc.
 */
function ageGroupFromBisac(category: string): AgeGroup | undefined {
  const lower = category.toLowerCase();

  if (lower.includes('board book')) return 'Baby/Toddler (0-3)';
  if (lower.includes('picture book')) return 'Picture Book (3-6)';
  if (lower.includes('early reader') || lower.includes('beginning reader')) return 'Early Reader (5-8)';
  if (lower.includes('young adult')) return 'Young Adult (12-18)';
  if (lower.includes('juvenile') || lower.includes("children's")) return 'Middle Grade (8-12)';

  // Non-juvenile categories default to Adult
  if (!lower.includes('juvenile') && !lower.includes("children") && !lower.includes('young adult')) {
    // Only set adult if the category looks definitively adult
    const adultSignals = ['business', 'self-help', 'true crime', 'erotica', 'political science',
      'law', 'medical', 'health & fitness', 'body, mind & spirit'];
    if (adultSignals.some(s => lower.includes(s))) return 'Adult (18+)';
  }

  return undefined;
}

// ─── Publisher Heuristics ───

const PUBLISHER_AGE_MAP: Record<string, AgeGroup> = {
  // Baby/Toddler
  'Priddy Books': 'Baby/Toddler (0-3)',
  'DK Children': 'Baby/Toddler (0-3)',
  'Campbell Books': 'Baby/Toddler (0-3)',
  'Ladybird': 'Baby/Toddler (0-3)',

  // Picture Book
  'Pratham Books': 'Picture Book (3-6)',
  'Tulika Publishers': 'Picture Book (3-6)',
  'Karadi Tales': 'Picture Book (3-6)',
  'Walker Books': 'Picture Book (3-6)',
  'Candlewick Press': 'Picture Book (3-6)',
  'Nosy Crow': 'Picture Book (3-6)',
  'Tara Books': 'Picture Book (3-6)',
  'Katha': 'Picture Book (3-6)',

  // Early Reader
  'Dav Pilkey': 'Early Reader (5-8)',

  // Middle Grade
  'Scholastic': 'Middle Grade (8-12)',
  'Scholastic India': 'Middle Grade (8-12)',
  'Puffin Books': 'Middle Grade (8-12)',
  'Puffin': 'Middle Grade (8-12)',
  'Duckbill Books': 'Middle Grade (8-12)',
  'Red Turtle': 'Middle Grade (8-12)',
  'Hachette Children': 'Middle Grade (8-12)',

  // Young Adult
  'Hot Key Books': 'Young Adult (12-18)',

  // Adult (general trade)
  'Penguin India': 'Adult (18+)',
  'HarperCollins India': 'Adult (18+)',
  'Juggernaut Books': 'Adult (18+)',
  'Westland': 'Adult (18+)',
  'Rupa Publications': 'Adult (18+)',
  'Aleph Book Company': 'Adult (18+)',
  'Speaking Tiger': 'Adult (18+)',
  'Pan Macmillan India': 'Adult (18+)',
  'Simon & Schuster India': 'Adult (18+)',
  'Hachette India': 'Adult (18+)',
  'Barrington Stoke': 'Middle Grade (8-12)',
  'Frances Lincoln Children\'s Books': 'Middle Grade (8-12)',
  'Templar Books': 'Middle Grade (8-12)',
  'Andersen Press': 'Middle Grade (8-12)',
  'Barefoot Books': 'Middle Grade (8-12)',
  'Abrams': 'Middle Grade (8-12)',
  'Children\'s Book Trust': 'Picture Book (3-6)',
};

const TITLE_TAG_RULES: Array<{
  pattern: RegExp;
  ageGroup?: AgeGroup;
  categories?: BroadCategory[];
  subjects?: string[];
}> = [
  {
    pattern: /\b(board book|touch(?:-| )?and(?:-| )?feel|tummy time|bath book|shaped bath book)\b/i,
    ageGroup: 'Baby/Toddler (0-3)',
    categories: ['Board Book'],
    subjects: ['Touch and Feel'],
  },
  {
    pattern: /\bpicture book\b/i,
    ageGroup: 'Picture Book (3-6)',
  },
  {
    pattern: /\b(early reader|beginning reader|level\s*[1-2]\b|branches book)\b/i,
    ageGroup: 'Early Reader (5-8)',
  },
  {
    pattern: /\b(sticker|colouring|coloring|activity|puzzle|origami|doodle|memory game|cards|search and find|dot to dot|maze)\b/i,
    categories: ['Activity Book'],
    subjects: ['Activities'],
  },
  {
    pattern: /\b(book of fun)\b/i,
    categories: ['Activity Book'],
    subjects: ['Activities'],
  },
  {
    pattern: /\b(graphic novel|comic\b|comics\b)\b/i,
    categories: ['Graphic Novel'],
    subjects: ['Graphic Novels'],
  },
  {
    pattern: /\bminecraft\b/i,
    ageGroup: 'Middle Grade (8-12)',
    categories: ['Fiction'],
  },
  {
    pattern: /\b(myth|myths|gods|goddess|legend|folklore|ramayana|mahabharata|minotaur)\b/i,
    categories: ['Mythology'],
    subjects: ['Mythology'],
  },
  {
    pattern: /\b(history|historical|ancient|indus|roman|rome|egypt|egyptian)\b/i,
    categories: ['History'],
    subjects: ['History'],
  },
  {
    pattern: /\b(science|human body|body|planet|space|stargazing|physics|chemistry|biology)\b/i,
    categories: ['Science'],
  },
  {
    pattern: /\b(animal|animals|bird|birds|tree|trees|whale|ocean|sea|nature|garden|gardener|grass|fish|pet|pets)\b/i,
    categories: ['Nature'],
  },
  {
    pattern: /\b(draw|drawing|illustrator|artist|art|origami)\b/i,
    categories: ['Art'],
  },
  {
    pattern: /\b(poem|poetry|verse)\b/i,
    categories: ['Poetry'],
  },
  {
    pattern: /\bnursery rhymes?\b/i,
    ageGroup: 'Baby/Toddler (0-3)',
    categories: ['Poetry'],
  },
  {
    pattern: /\b(recipe|recipes|cooking|cookbook|kitchen|food)\b/i,
    categories: ['Cooking'],
  },
  {
    pattern: /\b(chaat|chaats)\b/i,
    categories: ['Cooking'],
  },
];

const TITLE_SUBJECT_RULES: Array<{ pattern: RegExp; subject: string }> = [
  { pattern: /\b(bird|birds)\b/i, subject: 'Birds' },
  { pattern: /\b(animal|animals|pet|pets)\b/i, subject: 'Animals' },
  { pattern: /\b(bug|bugs|insect|insects)\b/i, subject: 'Insects' },
  { pattern: /\b(tree|trees|forest)\b/i, subject: 'Trees' },
  { pattern: /\b(whale|ocean|sea)\b/i, subject: 'Ocean Life' },
  { pattern: /\b(human body|body)\b/i, subject: 'Human Body' },
  { pattern: /\b(space|planet|stargazing)\b/i, subject: 'Space' },
  { pattern: /\b(history|ancient|indus|roman|rome|egypt|egyptian)\b/i, subject: 'History' },
  { pattern: /\b(myth|myths|gods|goddess|legend|folklore|ramayana|mahabharata|minotaur)\b/i, subject: 'Mythology' },
  { pattern: /\b(sticker|colouring|coloring|activity|puzzle|origami|memory game|cards)\b/i, subject: 'Activities' },
];

// ─── Subject Extraction ───

/** Words to skip when extracting subjects from BISAC paths */
const SKIP_SUBJECTS = new Set([
  'general', 'juvenile', 'fiction', 'nonfiction', 'non-fiction',
  'children\'s', 'young adult', 'literary', 'contemporary',
]);

/**
 * Extract detailed subjects from a BISAC path.
 * "Juvenile Fiction / Animals / Dogs" → ["Animals", "Dogs"]
 * "Juvenile Fiction / Social Themes / Death, Grief, Bereavement" → ["Death", "Grief", "Bereavement"]
 */
function subjectsFromBisac(category: string): string[] {
  const parts = category.split('/').map(p => p.trim());
  const subjects: string[] = [];

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (SKIP_SUBJECTS.has(lower)) continue;

    // Check if this is a broad category we already capture
    if (BISAC_TO_CATEGORY[lower]) continue;

    // Split comma-separated subjects
    if (part.includes(',')) {
      for (const sub of part.split(',')) {
        const trimmed = sub.trim();
        if (trimmed && !SKIP_SUBJECTS.has(trimmed.toLowerCase())) {
          subjects.push(titleCase(trimmed));
        }
      }
    } else if (part.includes('&')) {
      // "Death & Dying" → keep as one subject
      subjects.push(titleCase(part));
    } else {
      subjects.push(titleCase(part));
    }
  }

  return subjects;
}

/**
 * Clean and extract subjects from Open Library subject strings.
 * Open Library gives us pre-split arrays like ["Children's fiction", "Dogs", "Friendship"]
 */
function subjectsFromOpenLibrary(olSubjects: string[]): string[] {
  const subjects: string[] = [];
  for (const s of olSubjects) {
    const lower = s.toLowerCase();
    if (SKIP_SUBJECTS.has(lower)) continue;
    if (lower.endsWith(' fiction') || lower.endsWith(' nonfiction')) continue;
    // Skip very generic subjects
    if (['accessible book', 'protected daisy', 'in library', 'lending library'].includes(lower)) continue;
    subjects.push(titleCase(s));
  }
  return subjects;
}

// ─── Main Mapping Functions ───

/**
 * Map Google Books categories to our tag system.
 * @param rawCategories - array of BISAC strings from Google Books API
 */
export function mapGoogleBooksCategories(rawCategories: string[]): MappedTags {
  const categories = new Set<string>();
  const subjects = new Set<string>();
  let ageGroup: AgeGroup | undefined;

  for (const cat of rawCategories) {
    // Try age group from the full string
    const age = ageGroupFromBisac(cat);
    if (age && !ageGroup) ageGroup = age;

    // Split by " / " and match each segment
    const segments = cat.split('/').map(s => s.trim().toLowerCase());
    for (const seg of segments) {
      const mapped = BISAC_TO_CATEGORY[seg];
      if (mapped) categories.add(mapped);
    }

    // Also try the full lowercased string
    const fullLower = cat.toLowerCase();
    const fullMapped = BISAC_TO_CATEGORY[fullLower];
    if (fullMapped) categories.add(fullMapped);

    // Extract detailed subjects
    for (const subj of subjectsFromBisac(cat)) {
      subjects.add(subj);
    }
  }

  // If we have "Juvenile Fiction" but no specific genre, add Fiction
  if (categories.size === 0 && rawCategories.some(c => c.toLowerCase().includes('fiction'))) {
    categories.add('Fiction');
  }
  if (categories.size === 0 && rawCategories.some(c => c.toLowerCase().includes('nonfiction'))) {
    categories.add('Non-Fiction');
  }

  return {
    ageGroup,
    categories: Array.from(categories),
    subjects: Array.from(subjects),
  };
}

/**
 * Map Open Library subjects to our tag system.
 * @param olSubjects - array of subject strings from Open Library API
 */
export function mapOpenLibrarySubjects(olSubjects: string[]): MappedTags {
  const categories = new Set<string>();
  const subjects = new Set<string>();
  let ageGroup: AgeGroup | undefined;

  for (const s of olSubjects) {
    const lower = s.toLowerCase();

    // Check for age hints
    if (lower.includes('board book')) ageGroup = ageGroup || 'Baby/Toddler (0-3)';
    if (lower.includes('picture book')) ageGroup = ageGroup || 'Picture Book (3-6)';
    if (lower.includes('juvenile') || lower.includes("children's")) ageGroup = ageGroup || 'Middle Grade (8-12)';
    if (lower.includes('young adult')) ageGroup = ageGroup || 'Young Adult (12-18)';

    // Try to match broad categories
    const mapped = BISAC_TO_CATEGORY[lower];
    if (mapped) {
      categories.add(mapped);
      continue;
    }

    // Check partial matches
    for (const [key, cat] of Object.entries(BISAC_TO_CATEGORY)) {
      if (lower === key || lower.includes(key)) {
        categories.add(cat);
      }
    }
  }

  // Add detailed subjects
  for (const subj of subjectsFromOpenLibrary(olSubjects)) {
    subjects.add(subj);
  }

  return {
    ageGroup,
    categories: Array.from(categories),
    subjects: Array.from(subjects),
  };
}

/**
 * Get age group heuristic from publisher name.
 * Returns undefined if the publisher isn't in our heuristic map.
 */
export function ageGroupFromPublisher(publisher: string): AgeGroup | undefined {
  // Exact match first
  if (PUBLISHER_AGE_MAP[publisher]) return PUBLISHER_AGE_MAP[publisher];

  // Partial match (e.g., "Scholastic India" matches "Scholastic")
  for (const [key, age] of Object.entries(PUBLISHER_AGE_MAP)) {
    if (publisher.includes(key) || key.includes(publisher)) return age;
  }

  return undefined;
}

function hasUsefulTagData(entry: Pick<CatalogEntry, 'tagData'>): boolean {
  return Boolean(
    entry.tagData &&
    (
      entry.tagData.ageGroup ||
      entry.tagData.categories.length > 0 ||
      entry.tagData.subjects.length > 0
    )
  );
}

function normalizePublisherProfileKey(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function inferTitleHeuristicTags(title: string): {
  ageGroup?: AgeGroup;
  categories: BroadCategory[];
  subjects: string[];
} {
  const categories = new Set<BroadCategory>();
  const subjects = new Set<string>();
  let ageGroup: AgeGroup | undefined;

  for (const rule of TITLE_TAG_RULES) {
    if (!rule.pattern.test(title)) continue;
    if (rule.ageGroup && !ageGroup) ageGroup = rule.ageGroup;
    for (const category of rule.categories || []) categories.add(category);
    for (const subject of rule.subjects || []) subjects.add(subject);
  }

  for (const rule of TITLE_SUBJECT_RULES) {
    if (rule.pattern.test(title)) {
      subjects.add(rule.subject);
    }
  }

  return {
    ageGroup,
    categories: Array.from(categories),
    subjects: Array.from(subjects),
  };
}

export function buildPublisherTagProfiles(entries: CatalogEntry[]): Map<string, PublisherTagProfile> {
  const buckets = new Map<string, { publisher: string; taggedCount: number; ageCounts: Map<AgeGroup, number> }>();

  for (const entry of entries) {
    if (!entry.publisher || entry.publisher === 'Unknown Publisher' || !hasUsefulTagData(entry)) continue;

    const key = normalizePublisherProfileKey(entry.publisher);
    if (!key) continue;

    const bucket = buckets.get(key) || {
      publisher: entry.publisher,
      taggedCount: 0,
      ageCounts: new Map<AgeGroup, number>(),
    };

    bucket.taggedCount++;
    if (entry.tagData?.ageGroup) {
      bucket.ageCounts.set(entry.tagData.ageGroup, (bucket.ageCounts.get(entry.tagData.ageGroup) || 0) + 1);
    }

    buckets.set(key, bucket);
  }

  const profiles = new Map<string, PublisherTagProfile>();
  for (const [key, bucket] of buckets.entries()) {
    let dominantAgeGroup: AgeGroup | undefined;
    let dominantAgeCount = 0;
    for (const [ageGroup, count] of bucket.ageCounts.entries()) {
      if (count > dominantAgeCount) {
        dominantAgeGroup = ageGroup;
        dominantAgeCount = count;
      }
    }

    const dominantAgeShare = bucket.taggedCount > 0 ? dominantAgeCount / bucket.taggedCount : 0;
    profiles.set(key, {
      publisher: bucket.publisher,
      taggedCount: bucket.taggedCount,
      dominantAgeGroup: bucket.taggedCount >= 8 && dominantAgeShare >= 0.8 ? dominantAgeGroup : undefined,
      dominantAgeShare,
    });
  }

  return profiles;
}

export function inferCatalogHeuristicTagData(
  entry: CatalogEntry,
  publisherProfiles: Map<string, PublisherTagProfile>,
  now = new Date()
): TagData | undefined {
  if (hasUsefulTagData(entry)) return undefined;

  const titleSignals = inferTitleHeuristicTags(entry.name);
  let ageGroup = titleSignals.ageGroup;

  if (!ageGroup && entry.publisher && entry.publisher !== 'Unknown Publisher') {
    ageGroup = ageGroupFromPublisher(entry.publisher);
  }

  if (!ageGroup && entry.publisher && entry.publisher !== 'Unknown Publisher') {
    const profile = publisherProfiles.get(normalizePublisherProfileKey(entry.publisher));
    if (profile?.dominantAgeGroup) {
      ageGroup = profile.dominantAgeGroup;
    }
  }

  const categories = validateCategories(titleSignals.categories);
  const subjects = titleSignals.subjects.slice(0, 8);

  if (!ageGroup && categories.length === 0 && subjects.length === 0) {
    return undefined;
  }

  return {
    ageGroup,
    categories,
    subjects,
    source: 'catalog-heuristic',
    confidence: categories.length > 0 || subjects.length > 0 ? 'medium' : 'low',
    taggedAt: now.toISOString(),
  };
}

/**
 * Merge multiple MappedTags results (e.g., Google Books + Open Library).
 * First result takes priority for age group.
 */
export function mergeTags(...tagSets: MappedTags[]): MappedTags {
  const categories = new Set<string>();
  const subjects = new Set<string>();
  let ageGroup: AgeGroup | undefined;

  for (const tags of tagSets) {
    if (tags.ageGroup && !ageGroup) ageGroup = tags.ageGroup;
    for (const c of tags.categories) categories.add(c);
    for (const s of tags.subjects) subjects.add(s);
  }

  return {
    ageGroup,
    categories: Array.from(categories),
    subjects: Array.from(subjects),
  };
}

/**
 * Validate that categories are from our fixed list.
 * Filters out any that aren't recognized.
 */
export function validateCategories(cats: string[]): string[] {
  const valid = new Set<string>(BROAD_CATEGORIES);
  return cats.filter(c => valid.has(c));
}

// ─── Helpers ───

function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase()).replace(/\b(And|Or|The|A|An|In|Of|To|For|With|On|At|By)\b/g, m => m.toLowerCase());
}
