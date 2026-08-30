# Lightroom Workspace

Internal bookstore workspace for:

- natural-language catalog search
- inventory and sales lookup
- order basket creation
- distributor-grouped email drafts

## Local development

Use Node 20:

```bash
nvm use 20
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

Create `.env.local` with:

```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_WORKSPACE_MODEL=gpt-4.1
SITE_PASSWORD=darkroom
```

`SITE_PASSWORD` protects the site. In local development, if it is missing, the app falls back to `darkroom`.

## Catalog build

The app reads:

- the active inventory workbook in `erp-data/` whose filename contains `inventory`
- `erp-data/sales jul to mar.xlsx`
- `erp-data/Publisher - Distributor mapping - Sheet1.csv`
- `Indian Stock Books.xlsx`
- `data/imprint-mappings.json`

Keep only the current inventory workbook directly inside `erp-data/`. Move older
snapshots into `erp-data/archive/` so local and Vercel builds select the same file.

Build the catalog manually with:

```bash
npm run build-catalog
```

`npm run build` already runs `npm run build-catalog` first, so Vercel builds stay in sync with the committed data and ERP files.

## Vercel deployment

This repo is set up for the simplest Vercel flow:

1. Import the GitHub repo into Vercel
2. Set environment variables:
   - `SITE_PASSWORD=darkroom`
   - `OPENAI_API_KEY=...`
   - `OPENAI_WORKSPACE_MODEL=gpt-4.1`
3. Deploy

No custom build command is needed. Vercel will use the project `build` script.

## Notes

- The app is file-backed.
- `data/master-catalog.json` is committed so the cleaned catalog is available on deploy.
- Order drafts are persisted locally in development. On Vercel they are returned for copy/paste but not durably saved on the server.
