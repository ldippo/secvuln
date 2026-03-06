import * as semver from 'semver';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Vulnerability,
  FixAction,
  VersionChangeType,
  PackageManager,
  CatalogData,
} from '../../types/index.js';
import { getVersionChangeType, analyzeChangelog } from '../changelog/index.js';
import { parseCatalogReference, resolveCatalogVersion, updateCatalogVersion, findPackageInCatalogs } from '../workspace/catalog.js';

/**
 * Determine the target version for a direct dependency upgrade
 */
export async function getTargetVersion(
  packageName: string,
  currentVersion: string,
  patchedVersions: string | null
): Promise<string | null> {
  if (!patchedVersions) return null;
  
  // Try to find the minimum version that satisfies the patched range
  // that is also >= current version
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`);
    if (!response.ok) return null;
    
    const data = await response.json() as { versions: Record<string, unknown> };
    const versions = Object.keys(data.versions || {});
    
    // Filter to versions that satisfy the patched range and are >= current
    const validVersions = versions.filter((v) => {
      return (
        semver.valid(v) &&
        semver.satisfies(v, patchedVersions) &&
        semver.gte(v, currentVersion)
      );
    });
    
    // Sort and return the minimum valid version
    validVersions.sort(semver.compare);
    return validVersions[0] || null;
  } catch {
    return null;
  }
}

/**
 * Calculate the version change type for an upgrade
 */
export function calculateVersionChangeType(
  currentVersion: string,
  targetVersion: string
): VersionChangeType {
  return getVersionChangeType(currentVersion, targetVersion);
}

/**
 * Create a fix action for a direct dependency
 */
export async function createDirectFixAction(
  vulnerability: Vulnerability
): Promise<FixAction> {
  const targetVersion = await getTargetVersion(
    vulnerability.packageName,
    vulnerability.currentVersion,
    vulnerability.patchedVersions
  );

  if (!targetVersion) {
    return {
      type: 'skip',
      packageName: vulnerability.packageName,
      currentVersion: vulnerability.currentVersion,
      targetVersion: null,
      versionChangeType: 'none',
      vulnerability,
      reason: 'No patched version available',
    };
  }

  const versionChangeType = calculateVersionChangeType(
    vulnerability.currentVersion,
    targetVersion
  );

  return {
    type: 'upgrade',
    packageName: vulnerability.packageName,
    currentVersion: vulnerability.currentVersion,
    targetVersion,
    versionChangeType,
    vulnerability,
    reason: `Upgrade to ${targetVersion} (${versionChangeType} version change)`,
  };
}

export interface ApplyUpgradeOptions {
  catalogs?: CatalogData;
  rootPath?: string;
}

/**
 * Apply an upgrade to package.json, or to pnpm-workspace.yaml if the dep uses a catalog reference
 */
export function applyUpgrade(
  packageJsonPath: string,
  packageName: string,
  targetVersion: string,
  options?: ApplyUpgradeOptions
): void {
  const content = readFileSync(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content);

  const versionSpec = pkg.dependencies?.[packageName] ?? pkg.devDependencies?.[packageName];

  // Check if this is a catalog reference (works when the correct package.json is passed)
  if (versionSpec && options?.catalogs && options.rootPath) {
    const catalogName = parseCatalogReference(versionSpec);
    if (catalogName !== null) {
      updateCatalogVersion(options.rootPath, catalogName, packageName, `^${targetVersion}`);
      return;
    }
  }

  // Fallback: check catalog data directly (handles monorepos where the catalog ref
  // is in a sub-package, not the root package.json we're reading)
  if (options?.catalogs && options.rootPath) {
    const catalogName = findPackageInCatalogs(packageName, options.catalogs);
    if (catalogName !== null) {
      updateCatalogVersion(options.rootPath, catalogName, packageName, `^${targetVersion}`);
      return;
    }
  }

  // Standard path: update package.json directly
  if (pkg.dependencies?.[packageName]) {
    pkg.dependencies[packageName] = `^${targetVersion}`;
  } else if (pkg.devDependencies?.[packageName]) {
    pkg.devDependencies[packageName] = `^${targetVersion}`;
  }

  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * Apply a resolution/override to package.json, or update pnpm-workspace.yaml
 * if the package is managed by a catalog
 */
export function applyResolution(
  packageJsonPath: string,
  packageName: string,
  targetVersion: string,
  packageManager: PackageManager,
  options?: ApplyUpgradeOptions
): void {
  // If the package is managed by a catalog, update the catalog instead of adding an override
  if (packageManager === 'pnpm' && options?.catalogs && options.rootPath) {
    const catalogName = findPackageInCatalogs(packageName, options.catalogs);
    if (catalogName !== null) {
      updateCatalogVersion(options.rootPath, catalogName, packageName, `^${targetVersion}`);
      return;
    }
  }

  const content = readFileSync(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content);

  // Use appropriate field based on package manager
  if (packageManager === 'npm') {
    pkg.overrides = pkg.overrides || {};
    pkg.overrides[packageName] = targetVersion;
  } else if (packageManager === 'yarn') {
    pkg.resolutions = pkg.resolutions || {};
    pkg.resolutions[packageName] = targetVersion;
  } else if (packageManager === 'pnpm') {
    // pnpm uses overrides in pnpm-specific section or package.json
    pkg.pnpm = pkg.pnpm || {};
    pkg.pnpm.overrides = pkg.pnpm.overrides || {};
    pkg.pnpm.overrides[packageName] = targetVersion;
  }

  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * Get current version of a direct dependency from package.json,
 * resolving catalog references if catalogs are provided
 */
export function getCurrentVersion(
  packageJsonPath: string,
  packageName: string,
  catalogs?: CatalogData
): string | null {
  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);

    let version = pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName];
    if (!version) return null;

    // Resolve catalog references to actual semver ranges
    version = resolveCatalogVersion(packageName, version, catalogs);

    // If it's a valid range (^1.2.3, ~1.2.3, >=1.2.3), extract the minimum
    // satisfying version. This is more accurate than coerce() which can
    // misparse complex ranges.
    const minVer = semver.minVersion(version);
    if (minVer) return minVer.version;

    // Fallback: try coerce for non-standard version strings
    return semver.coerce(version)?.version || version.replace(/^[\^~]/, '');
  } catch {
    return null;
  }
}
