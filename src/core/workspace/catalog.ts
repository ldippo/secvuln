import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import type { CatalogData } from '../../types/index.js';

/**
 * Parse catalog/catalogs from pnpm-workspace.yaml
 */
export function parseCatalogs(rootPath: string): CatalogData | null {
  const workspacePath = join(rootPath, 'pnpm-workspace.yaml');
  if (!existsSync(workspacePath)) return null;

  const content = readFileSync(workspacePath, 'utf-8');
  const doc = parseDocument(content);
  const data = doc.toJSON();
  if (!data) return null;

  const hasDefault = data.catalog && typeof data.catalog === 'object';
  const hasNamed = data.catalogs && typeof data.catalogs === 'object';

  if (!hasDefault && !hasNamed) return null;

  const result: CatalogData = {
    default: {},
    named: {},
  };

  if (hasDefault) {
    result.default = data.catalog as Record<string, string>;
  }

  if (hasNamed) {
    for (const [name, entries] of Object.entries(data.catalogs as Record<string, unknown>)) {
      if (entries && typeof entries === 'object') {
        result.named[name] = entries as Record<string, string>;
      }
    }
  }

  return result;
}

/**
 * Extract catalog name from a catalog reference like "catalog:" or "catalog:react17"
 * Returns the catalog name (empty string for default), or null if not a catalog ref
 */
export function parseCatalogReference(versionSpec: string): string | null {
  if (!versionSpec.startsWith('catalog:')) return null;
  return versionSpec.slice('catalog:'.length);
}

/**
 * Resolve a version spec to actual semver range.
 * If it's a catalog reference, look up the version in catalogs.
 * Otherwise return as-is.
 */
export function resolveCatalogVersion(
  packageName: string,
  versionSpec: string,
  catalogs: CatalogData | undefined
): string {
  if (!catalogs) return versionSpec;

  const catalogName = parseCatalogReference(versionSpec);
  if (catalogName === null) return versionSpec;

  // Empty name = default catalog
  if (catalogName === '') {
    return catalogs.default[packageName] ?? versionSpec;
  }

  // Named catalog
  return catalogs.named[catalogName]?.[packageName] ?? versionSpec;
}

/**
 * Update a version in pnpm-workspace.yaml, preserving formatting
 */
export function updateCatalogVersion(
  rootPath: string,
  catalogName: string,
  packageName: string,
  newVersion: string
): void {
  const workspacePath = join(rootPath, 'pnpm-workspace.yaml');
  const content = readFileSync(workspacePath, 'utf-8');
  const doc = parseDocument(content);

  if (catalogName === '') {
    // Default catalog
    doc.setIn(['catalog', packageName], newVersion);
  } else {
    // Named catalog
    doc.setIn(['catalogs', catalogName, packageName], newVersion);
  }

  writeFileSync(workspacePath, doc.toString());
}
