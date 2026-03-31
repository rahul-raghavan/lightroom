import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MasterCatalog } from '@/lib/catalog-types';
import { buildWorkspaceMeta } from '@/lib/workspace';
import { parseWorkspaceNaturalLanguage } from '@/lib/workspace-nl';

const CATALOG_PATH = path.join(process.cwd(), 'data', 'master-catalog.json');

function readCatalog(): MasterCatalog | null {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as MasterCatalog;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const catalog = readCatalog();
  if (!catalog) {
    return NextResponse.json(
      { error: 'Catalog not found. Run `npm run build-catalog` first.' },
      { status: 404 }
    );
  }

  const body = await request.json() as { prompt?: string };
  const prompt = String(body.prompt || '').trim();
  if (!prompt) {
    return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
  }

  const meta = buildWorkspaceMeta(catalog);
  const interpretation = await parseWorkspaceNaturalLanguage(prompt, {
    publishers: meta.publishers,
    distributors: meta.distributors,
  });

  return NextResponse.json(interpretation);
}
