import fs from 'fs';
import path from 'path';

export interface ResolvedCatalogSourcePaths {
  inventoryPath: string;
  salesPath: string;
  indianStockPath: string;
  imprintMappingsPath?: string;
  distributorMappingsPath?: string;
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(name => path.join(dir, name));
}

function pickLatestMatching(files: string[], matcher: (filePath: string) => boolean): string | undefined {
  const matches = files
    .filter(filePath => matcher(filePath))
    .filter(filePath => fs.existsSync(filePath))
    .map(filePath => ({
      filePath,
      mtimeMs: fs.statSync(filePath).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return matches[0]?.filePath;
}

export function resolveCatalogSourcePaths(root: string): ResolvedCatalogSourcePaths {
  const rootFiles = listFiles(root);
  const erpDir = path.join(root, 'erp-data');
  const erpFiles = listFiles(erpDir);

  const inventoryPath = pickLatestMatching(
    [...erpFiles, ...rootFiles],
    filePath => /\.xlsx$/i.test(filePath) && /inventory/i.test(path.basename(filePath))
  );
  const salesPath = pickLatestMatching(
    [...erpFiles, ...rootFiles],
    filePath => /\.xlsx$/i.test(filePath) && /sales/i.test(path.basename(filePath))
  );
  const indianStockPath = pickLatestMatching(
    rootFiles,
    filePath => /\.xlsx$/i.test(filePath) && /indian stock books/i.test(path.basename(filePath))
  );
  const imprintMappingsPath = pickLatestMatching(
    [path.join(root, 'data', 'imprint-mappings.json')],
    filePath => /imprint-mappings\.json$/i.test(path.basename(filePath))
  );
  const distributorMappingsPath = pickLatestMatching(
    [...erpFiles, ...rootFiles],
    filePath =>
      /\.(csv|xlsx)$/i.test(filePath) &&
      /publisher/i.test(path.basename(filePath)) &&
      /distributor/i.test(path.basename(filePath))
  );

  if (!inventoryPath) {
    throw new Error('Missing inventory workbook');
  }
  if (!salesPath) {
    throw new Error('Missing sales workbook');
  }
  if (!indianStockPath) {
    throw new Error('Missing Indian Stock Books workbook');
  }

  return {
    inventoryPath,
    salesPath,
    indianStockPath,
    ...(imprintMappingsPath ? { imprintMappingsPath } : {}),
    ...(distributorMappingsPath ? { distributorMappingsPath } : {}),
  };
}
