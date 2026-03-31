import { AGE_GROUPS, BROAD_CATEGORIES } from './catalog-types';
import { resolveWorkspaceOption, WorkspaceFilters } from './workspace';

export interface WorkspaceNlResult {
  mode: 'heuristic' | 'openai';
  explanation: string;
  filters: WorkspaceFilters;
}

interface WorkspaceOptionContext {
  publishers: string[];
  distributors: string[];
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function describeStructuredFilters(filters: WorkspaceFilters): string {
  const parts: string[] = [];

  if (filters.authorQuery) parts.push(`author="${filters.authorQuery}"`);
  if ((filters.authorQueryAny || []).length > 0) parts.push(`authors: ${filters.authorQueryAny!.join(' | ')}`);
  if (filters.themeQuery) parts.push(`theme="${filters.themeQuery}"`);
  if ((filters.themeQueryAny || []).length > 0) parts.push(`themes: ${filters.themeQueryAny!.join(' | ')}`);
  if (filters.query) parts.push(`query="${filters.query}"`);
  if ((filters.queryAny || []).length > 0) parts.push(`any of: ${filters.queryAny!.join(' | ')}`);
  if (filters.publisher) parts.push(`publisher=${filters.publisher}`);
  if (filters.distributor) parts.push(`distributor=${filters.distributor}`);
  if (filters.ageGroup) parts.push(`age group=${filters.ageGroup}`);
  if ((filters.ageGroupsAny || []).length > 0) parts.push(`age groups: ${filters.ageGroupsAny!.join(' | ')}`);
  if (filters.category) parts.push(`category=${filters.category}`);
  if (filters.stock === 'out') parts.push('stock=out of stock');
  if (filters.stock === 'low') parts.push('stock=low (1-5)');
  if (filters.stock === 'in') parts.push('stock=in stock');
  if (typeof filters.stockMin === 'number') parts.push(`stock >= ${filters.stockMin}`);
  if (typeof filters.stockMax === 'number') parts.push(`stock <= ${filters.stockMax}`);
  if (filters.mapped === 'mapped') parts.push('mapped distributor');
  if (filters.mapped === 'unmapped') parts.push('unmapped distributor');
  if (filters.cleanup === 'clean') parts.push('ready to order');
  if (filters.cleanup === 'needs-attention') parts.push('needs cleanup');
  if ((filters.missing || []).length > 0) parts.push(`missing ${filters.missing!.join(', ')}`);
  if (filters.onlyRevenue) parts.push('revenue books only');

  return parts.length > 0
    ? `Using ${parts.join('; ')}.`
    : 'Using plain keyword search.';
}

function parseStockThresholds(lower: string): Pick<WorkspaceFilters, 'stockMin' | 'stockMax'> {
  const parseCount = (rawValue: string): number | null => {
    const trimmed = rawValue.trim().toLowerCase();
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
    return NUMBER_WORDS[trimmed] ?? null;
  };

  const moreThan = lower.match(/(?:more than|over|above|greater than)\s+([a-z0-9-]+)\s+(?:units?|copies?)/);
  if (moreThan) {
    const count = parseCount(moreThan[1]);
    if (count !== null) {
      return { stockMin: count + 1 };
    }
  }

  const atLeast = lower.match(/(?:at least|minimum of|min(?:imum)?\s+of)\s+([a-z0-9-]+)\s+(?:units?|copies?)/);
  if (atLeast) {
    const count = parseCount(atLeast[1]);
    if (count !== null) {
      return { stockMin: count };
    }
  }

  const lessThan = lower.match(/(?:less than|under|below|fewer than)\s+([a-z0-9-]+)\s+(?:units?|copies?)/);
  if (lessThan) {
    const count = parseCount(lessThan[1]);
    if (count !== null) {
      return { stockMax: Math.max(0, count - 1) };
    }
  }

  const atMost = lower.match(/(?:at most|maximum of|max(?:imum)?\s+of)\s+([a-z0-9-]+)\s+(?:units?|copies?)/);
  if (atMost) {
    const count = parseCount(atMost[1]);
    if (count !== null) {
      return { stockMax: count };
    }
  }

  return {};
}

function parseByClause(prompt: string): string | undefined {
  const match = prompt.match(/\bby\s+(.+?)(?=\s+(?:that|with|where|who|which|for|and)\b|$)/i);
  return match?.[1]?.trim();
}

function parseThemeClause(prompt: string): string | undefined {
  const match = prompt.match(/\b(?:about|on)\s+(.+?)(?=\s+(?:for|with|that|where|who|which|and|but)\b|$)/i);
  return match?.[1]?.trim();
}

function parseAnyOfClauses(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(/\s+or\s+/i)
    .map(part => part.trim())
    .filter(Boolean)
    .filter((part, index, parts) => parts.findIndex(candidate => normalizeValue(candidate) === normalizeValue(part)) === index);
}

function normalizeValue(value: string): string {
  return value.toLowerCase().trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesPhrase(haystack: string, ...phrases: string[]): boolean {
  return phrases.some(phrase => haystack.includes(phrase));
}

function findMentionedOption(prompt: string, options: string[]): string | undefined {
  const lower = normalizeValue(prompt);

  return options
    .slice()
    .sort((left, right) => right.length - left.length)
    .find(option => {
      const normalizedOption = normalizeValue(option);
      if (normalizedOption.length < 3) return false;
      const matcher = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedOption)}([^a-z0-9]|$)`, 'i');
      return matcher.test(lower);
    });
}

function buildHeuristicFilters(prompt: string, context: WorkspaceOptionContext): WorkspaceNlResult {
  const lower = normalizeValue(prompt);
  const filters: WorkspaceFilters = {
    stock: 'all',
    mapped: 'all',
    cleanup: 'all',
    missing: [],
  };
  const reasons: string[] = [];
  const byClause = parseByClause(prompt);
  const aboutClause = parseThemeClause(prompt);
  const byClauseAny = parseAnyOfClauses(byClause);
  const aboutClauseAny = parseAnyOfClauses(aboutClause);

  if (byClauseAny.length > 1) {
    filters.authorQueryAny = byClauseAny;
    reasons.push(`authorQueryAny=${byClauseAny.join('|')}`);
  } else if (byClause) {
    filters.authorQuery = byClause;
    reasons.push(`authorQuery=${byClause}`);
  }

  if (aboutClauseAny.length > 1) {
    filters.themeQueryAny = aboutClauseAny;
    reasons.push(`themeQueryAny=${aboutClauseAny.join('|')}`);
  } else if (aboutClause) {
    filters.themeQuery = aboutClause;
    reasons.push(`themeQuery=${aboutClause}`);
  }

  const matchedPublisher = findMentionedOption(prompt, context.publishers);
  if (matchedPublisher && normalizeValue(matchedPublisher) !== 'picture books') {
    filters.publisher = matchedPublisher;
    reasons.push(`publisher=${matchedPublisher}`);
  }

  const matchedDistributor = findMentionedOption(prompt, context.distributors);
  if (matchedDistributor) {
    filters.distributor = matchedDistributor;
    reasons.push(`distributor=${matchedDistributor}`);
  }

  const matchedAgeGroup = AGE_GROUPS.find(ageGroup => {
    const key = normalizeValue(ageGroup);
    return lower.includes(key) ||
      (ageGroup === 'Picture Book (3-6)' && includesPhrase(lower, 'picture book', 'picture books')) ||
      (ageGroup === 'Middle Grade (8-12)' && includesPhrase(lower, 'middle grade', 'middle-grade')) ||
      (ageGroup === 'Young Adult (12-18)' && includesPhrase(lower, 'young adult', 'ya')) ||
      (ageGroup === 'Early Reader (5-8)' && includesPhrase(lower, 'early reader', 'early readers')) ||
      (ageGroup === 'Baby/Toddler (0-3)' && includesPhrase(lower, 'baby', 'toddler', 'board book', 'board books')) ||
      (ageGroup === 'Adult (18+)' && includesPhrase(lower, 'adult', 'adults'));
  });
  if (matchedAgeGroup) {
    filters.ageGroup = matchedAgeGroup;
    reasons.push(`age=${matchedAgeGroup}`);
  } else if (includesPhrase(lower, 'elementary', 'elementary grade', 'elementary grades', 'primary school', 'primary grades')) {
    filters.ageGroupsAny = ['Early Reader (5-8)', 'Middle Grade (8-12)'];
    reasons.push('ageGroupsAny=Early Reader|Middle Grade');
  }

  const matchedCategory = BROAD_CATEGORIES.find(category => lower.includes(normalizeValue(category)));
  if (matchedCategory) {
    filters.category = matchedCategory;
    reasons.push(`category=${matchedCategory}`);
  }

  if (includesPhrase(lower, 'out of stock', 'no stock')) {
    filters.stock = 'out';
    reasons.push('stock=out');
  } else if (includesPhrase(lower, 'low stock')) {
    filters.stock = 'low';
    reasons.push('stock=low');
  } else if (includesPhrase(lower, 'in stock', 'available stock')) {
    filters.stock = 'in';
    reasons.push('stock=in');
  }

  const thresholds = parseStockThresholds(lower);
  if (typeof thresholds.stockMin === 'number') {
    filters.stockMin = thresholds.stockMin;
    reasons.push(`stockMin=${thresholds.stockMin}`);
  }
  if (typeof thresholds.stockMax === 'number') {
    filters.stockMax = thresholds.stockMax;
    reasons.push(`stockMax=${thresholds.stockMax}`);
  }

  if (includesPhrase(lower, 'unmapped distributor', 'without distributor', 'no distributor')) {
    filters.mapped = 'unmapped';
    reasons.push('mapped=unmapped');
  } else if (includesPhrase(lower, 'mapped distributor', 'with distributor')) {
    filters.mapped = 'mapped';
    reasons.push('mapped=mapped');
  }

  if (includesPhrase(lower, 'missing tags', 'without tags', 'untagged')) {
    filters.missing?.push('tags');
    reasons.push('missing=tags');
  }
  if (includesPhrase(lower, 'missing author', 'without author')) {
    filters.missing?.push('author');
    reasons.push('missing=author');
  }
  if (includesPhrase(lower, 'missing publisher', 'without publisher', 'unknown publisher')) {
    filters.missing?.push('publisher');
    reasons.push('missing=publisher');
  }

  if (includesPhrase(lower, 'revenue books', 'selling books', 'top sellers', 'best sellers')) {
    filters.onlyRevenue = true;
    reasons.push('onlyRevenue=true');
  }

  if (includesPhrase(lower, 'clean books', 'ready to order')) {
    filters.cleanup = 'clean';
    reasons.push('cleanup=clean');
  } else if (includesPhrase(lower, 'needs cleanup', 'needs attention')) {
    filters.cleanup = 'needs-attention';
    reasons.push('cleanup=needs-attention');
  }

  if (
    reasons.length === 0 &&
    !filters.query &&
    !filters.authorQuery &&
    !(filters.authorQueryAny || []).length &&
    !filters.themeQuery &&
    !(filters.themeQueryAny || []).length
  ) {
    filters.query = prompt.trim();
  }

  return {
    mode: 'heuristic',
    explanation: reasons.length > 0
      ? `Heuristic parse matched ${reasons.join(', ')}. ${describeStructuredFilters(filters)}`
      : describeStructuredFilters(filters),
    filters,
  };
}

function coerceFilters(raw: Record<string, unknown>, context: WorkspaceOptionContext): WorkspaceFilters {
  const missing = Array.isArray(raw.missing)
    ? raw.missing.filter((value): value is 'author' | 'publisher' | 'tags' => value === 'author' || value === 'publisher' || value === 'tags')
    : [];

  return {
    ...(typeof raw.authorQuery === 'string' && raw.authorQuery.trim() ? { authorQuery: raw.authorQuery.trim() } : {}),
    ...(Array.isArray(raw.authorQueryAny)
      ? {
        authorQueryAny: raw.authorQueryAny
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .map(value => value.trim())
          .slice(0, 8),
      }
      : {}),
    ...(typeof raw.themeQuery === 'string' && raw.themeQuery.trim() ? { themeQuery: raw.themeQuery.trim() } : {}),
    ...(Array.isArray(raw.themeQueryAny)
      ? {
        themeQueryAny: raw.themeQueryAny
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .map(value => value.trim())
          .slice(0, 8),
      }
      : {}),
    ...(typeof raw.query === 'string' && raw.query.trim() ? { query: raw.query.trim() } : {}),
    ...(Array.isArray(raw.queryAny)
      ? {
        queryAny: raw.queryAny
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .map(value => value.trim())
          .slice(0, 8),
      }
      : {}),
    ...(typeof raw.publisher === 'string' && raw.publisher.trim()
      ? { publisher: resolveWorkspaceOption(raw.publisher, context.publishers) || raw.publisher.trim() }
      : {}),
    ...(typeof raw.distributor === 'string' && raw.distributor.trim()
      ? { distributor: resolveWorkspaceOption(raw.distributor, context.distributors) || raw.distributor.trim() }
      : {}),
    ...(typeof raw.ageGroup === 'string' && AGE_GROUPS.includes(raw.ageGroup as typeof AGE_GROUPS[number])
      ? { ageGroup: raw.ageGroup }
      : {}),
    ...(Array.isArray(raw.ageGroupsAny)
      ? {
        ageGroupsAny: raw.ageGroupsAny
          .filter((value): value is string => typeof value === 'string' && AGE_GROUPS.includes(value as typeof AGE_GROUPS[number]))
          .slice(0, 4),
      }
      : {}),
    ...(typeof raw.category === 'string' && BROAD_CATEGORIES.includes(raw.category as typeof BROAD_CATEGORIES[number])
      ? { category: raw.category }
      : {}),
    ...(raw.stock === 'all' || raw.stock === 'in' || raw.stock === 'out' || raw.stock === 'low'
      ? { stock: raw.stock }
      : {}),
    ...(typeof raw.stockMin === 'number' && Number.isFinite(raw.stockMin) ? { stockMin: Math.max(0, Math.round(raw.stockMin)) } : {}),
    ...(typeof raw.stockMax === 'number' && Number.isFinite(raw.stockMax) ? { stockMax: Math.max(0, Math.round(raw.stockMax)) } : {}),
    ...(raw.mapped === 'all' || raw.mapped === 'mapped' || raw.mapped === 'unmapped'
      ? { mapped: raw.mapped }
      : {}),
    ...(raw.cleanup === 'all' || raw.cleanup === 'clean' || raw.cleanup === 'needs-attention'
      ? { cleanup: raw.cleanup }
      : {}),
    ...(missing.length > 0 ? { missing } : {}),
    ...(typeof raw.onlyRevenue === 'boolean' ? { onlyRevenue: raw.onlyRevenue } : {}),
    ...(typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? { limit: raw.limit } : {}),
  };
}

async function parseWithOpenAi(prompt: string, context: WorkspaceOptionContext): Promise<WorkspaceNlResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_WORKSPACE_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'Convert bookstore search requests into deterministic JSON filters.',
            'Return JSON only.',
            'Allowed keys: authorQuery, authorQueryAny, themeQuery, themeQueryAny, query, queryAny, publisher, distributor, ageGroup, ageGroupsAny, category, stock, stockMin, stockMax, mapped, cleanup, missing, onlyRevenue, limit, explanation.',
            'Use stock values: all, in, out, low.',
            'Use mapped values: all, mapped, unmapped.',
            'Use cleanup values: all, clean, needs-attention.',
            'Use stockMin/stockMax for quantity thresholds like more than 5 units or less than 3 copies.',
            'Use queryAny when the user asks for alternatives such as "Arundhati Roy or Julia Donaldson".',
            'Use authorQuery or authorQueryAny for "books by ..." prompts.',
            'Use themeQuery or themeQueryAny for "books about ..." or "books on ..." prompts.',
            'Preserve age-group intent. For phrases like elementary or primary school, use ageGroupsAny covering Early Reader and Middle Grade.',
            `Age groups: ${AGE_GROUPS.join(' | ')}.`,
            `Categories: ${BROAD_CATEGORIES.join(' | ')}.`,
          ].join(' '),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}`);
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  const parsed = JSON.parse(content) as Record<string, unknown>;
  return {
    mode: 'openai',
    explanation: typeof parsed.explanation === 'string' && parsed.explanation.trim()
      ? parsed.explanation.trim()
      : describeStructuredFilters(coerceFilters(parsed, context)),
    filters: coerceFilters(parsed, context),
  };
}

function mergeHeuristicGuardrails(openAi: WorkspaceNlResult, heuristic: WorkspaceNlResult): WorkspaceNlResult {
  const merged: WorkspaceFilters = {
    ...openAi.filters,
  };

  if ((heuristic.filters.authorQueryAny || []).length > 0 && !(merged.authorQueryAny || []).length && !merged.authorQuery) {
    merged.authorQueryAny = heuristic.filters.authorQueryAny;
  }

  if (heuristic.filters.authorQuery && !merged.authorQuery && !(merged.authorQueryAny || []).length) {
    merged.authorQuery = heuristic.filters.authorQuery;
  }

  if ((heuristic.filters.themeQueryAny || []).length > 0 && !(merged.themeQueryAny || []).length && !merged.themeQuery) {
    merged.themeQueryAny = heuristic.filters.themeQueryAny;
  }

  if (heuristic.filters.themeQuery && !merged.themeQuery && !(merged.themeQueryAny || []).length) {
    merged.themeQuery = heuristic.filters.themeQuery;
  }

  if ((heuristic.filters.queryAny || []).length > 0 && !(merged.queryAny || []).length) {
    if (!merged.query || /\sor\s/i.test(merged.query)) {
      merged.queryAny = heuristic.filters.queryAny;
      if (merged.query && /\sor\s/i.test(merged.query)) {
        delete merged.query;
      }
    }
  }

  if (heuristic.filters.query && !merged.query && !(merged.queryAny || []).length) {
    merged.query = heuristic.filters.query;
  }

  if (heuristic.filters.ageGroup && !merged.ageGroup && !(merged.ageGroupsAny || []).length) {
    merged.ageGroup = heuristic.filters.ageGroup;
  }

  if ((heuristic.filters.ageGroupsAny || []).length > 0 && !(merged.ageGroupsAny || []).length && !merged.ageGroup) {
    merged.ageGroupsAny = heuristic.filters.ageGroupsAny;
  }

  if (heuristic.filters.category && !merged.category) {
    merged.category = heuristic.filters.category;
  }

  if (typeof heuristic.filters.stockMin === 'number' && typeof merged.stockMin !== 'number') {
    merged.stockMin = heuristic.filters.stockMin;
  }

  if (typeof heuristic.filters.stockMax === 'number' && typeof merged.stockMax !== 'number') {
    merged.stockMax = heuristic.filters.stockMax;
  }

  if (heuristic.filters.stock && (!merged.stock || merged.stock === 'all')) {
    merged.stock = heuristic.filters.stock;
  }

  return {
    mode: openAi.mode,
    explanation: describeStructuredFilters(merged),
    filters: merged,
  };
}

export async function parseWorkspaceNaturalLanguage(
  prompt: string,
  context: WorkspaceOptionContext
): Promise<WorkspaceNlResult> {
  const heuristic = buildHeuristicFilters(prompt, context);

  try {
    const openAi = await parseWithOpenAi(prompt, context);
    if (openAi) return mergeHeuristicGuardrails(openAi, heuristic);
  } catch {
    // Fallback to heuristics when the API is unavailable or misconfigured.
  }

  return heuristic;
}
