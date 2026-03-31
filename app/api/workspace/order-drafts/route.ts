import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MasterCatalog } from '@/lib/catalog-types';
import { buildWorkspaceOrderDraft, WorkspaceOrderItemInput } from '@/lib/workspace';

const CATALOG_PATH = path.join(process.cwd(), 'data', 'master-catalog.json');
const ORDER_DRAFTS_DIR = path.join(process.cwd(), 'data', 'order-drafts');
const PERSIST_DRAFTS = !process.env.VERCEL;

function readCatalog(): MasterCatalog | null {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as MasterCatalog;
  } catch {
    return null;
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function POST(request: NextRequest) {
  const catalog = readCatalog();
  if (!catalog) {
    return NextResponse.json(
      { error: 'Catalog not found. Run `npm run build-catalog` first.' },
      { status: 404 }
    );
  }

  const body = await request.json() as {
    title?: string;
    notes?: string;
    items?: WorkspaceOrderItemInput[];
  };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: 'Add at least one book to the basket.' }, { status: 400 });
  }

  const draft = buildWorkspaceOrderDraft(catalog, items, {
    title: body.title,
    notes: body.notes,
  });
  if (draft.groups.length === 0) {
    return NextResponse.json({ error: 'No valid order items were submitted.' }, { status: 400 });
  }

  const draftDir = path.join(ORDER_DRAFTS_DIR, draft.id);
  if (PERSIST_DRAFTS) {
    fs.mkdirSync(draftDir, { recursive: true });
    fs.writeFileSync(path.join(draftDir, 'draft.json'), JSON.stringify(draft, null, 2));
  }

  const fileSummaries = draft.groups.map(group => {
    const fileSlug = slugify(group.distributorName || group.groupKey) || 'order-group';
    const csvPath = path.join(draftDir, `${fileSlug}.csv`);
    const emailPath = path.join(draftDir, `${fileSlug}-email.txt`);

    const csvRows = [
      'ISBN,Title,Author,Publisher,Assignment Key,Quantity,Current Stock,Qty Sold,Revenue',
      ...group.items.map(item => [
        escapeCsv(item.isbn),
        escapeCsv(item.title),
        escapeCsv(item.author),
        escapeCsv(item.publisher),
        escapeCsv(item.assignmentKey),
        item.quantity,
        item.currentStock,
        item.qtySold,
        item.revenue.toFixed(2),
      ].join(',')),
    ];

    const emailBody = [
      `Subject: ${draft.title} - ${group.distributorName || group.groupKey}`,
      '',
      `Hello ${group.distributorName || 'team'},`,
      '',
      'Please find below the requested titles and quantities.',
      '',
      ...group.items.map(item => `- ${item.title} (${item.isbn}) x ${item.quantity}`),
      '',
      ...(draft.notes ? [`Notes: ${draft.notes}`, ''] : []),
      'Regards,',
      'Lightroom Bookstore',
    ].join('\n');

    if (PERSIST_DRAFTS) {
      fs.writeFileSync(csvPath, csvRows.join('\n'));
      fs.writeFileSync(emailPath, emailBody);
    }

    return {
      groupKey: group.groupKey,
      distributorName: group.distributorName,
      itemCount: group.items.length,
      preview: emailBody,
    };
  });

  return NextResponse.json({
    draftId: draft.id,
    title: draft.title,
    groups: fileSummaries,
  });
}
