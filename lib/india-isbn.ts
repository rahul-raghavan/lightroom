import { cleanAuthorName } from './catalog-normalization';

export interface IndiaIsbnBookData {
  title?: string;
  isbn: string;
  productForm?: string;
  language?: string;
  publisher?: string;
  authors?: string[];
  allottedDate?: string;
}

const FIRST_ROW_REGEX = /<tbody\b[^>]*>[\s\S]*?<tr\b[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<\/tbody>/i;
const CELL_REGEX = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function firstRowCells(html: string): string[] {
  const rowMatch = html.match(FIRST_ROW_REGEX);
  if (!rowMatch) return [];

  const cells: string[] = [];
  CELL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CELL_REGEX.exec(rowMatch[1])) !== null) {
    cells.push(stripHtml(match[1]));
  }

  return cells;
}

export function normalizeIndiaIsbn(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeIndiaIsbnAuthors(value: string): string[] {
  const normalized = stripHtml(value)
    .replace(/^Author\s*:\s*/i, '')
    .replace(/\bCo-Author\s*:\s*/gi, ', ')
    .replace(/\bCo Author\s*:\s*/gi, ', ')
    .replace(/\bAuthors?\s*:\s*/gi, '');

  const deduped = new Set<string>();
  for (const candidate of normalized.split(/\s*,\s*/)) {
    const author = cleanAuthorName(candidate.trim());
    if (author) deduped.add(author);
  }

  return Array.from(deduped);
}

export function parseIndiaIsbnSearchResult(html: string, requestedIsbn: string): IndiaIsbnBookData | null {
  const cells = firstRowCells(html);
  if (cells.length < 8) return null;

  const isbn = normalizeIndiaIsbn(cells[2]);
  if (!isbn || isbn !== normalizeIndiaIsbn(requestedIsbn)) return null;

  const authors = normalizeIndiaIsbnAuthors(cells[6]);
  return {
    title: cells[1] || undefined,
    isbn,
    productForm: cells[3] || undefined,
    language: cells[4] || undefined,
    publisher: cells[5] || undefined,
    authors: authors.length > 0 ? authors : undefined,
    allottedDate: cells[7] || undefined,
  };
}
