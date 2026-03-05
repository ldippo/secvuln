import * as semver from 'semver';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Vulnerability,
  FixAction,
  PackageManager,
  CatalogData,
} from '../../types/index.js';
import { getTargetVersion, calculateVersionChangeType } from './direct.js';
import { resolveCatalogVersion } from '../workspace/catalog.js';

/**
 * Fetch package info from npm registry
 */
export async function fetchPackageInfo(packageName: string): Promise<{
  versions: Record<string, { dependencies?: Record<string, string> }>;
  'dist-tags': Record<string, string>;
} | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`);
    if (!response.ok) return null;
    return await response.json() as {
      versions: Record<string, { dependencies?: Record<string, string> }>;
      'dist-tags': Record<string, string>;
    };
  } catch {
    return null;
  }
}

/**
 * Check if parent has a patch/minor version that fixes the transitive vulnerability.
 *
 * Strategy: for each candidate parent version (newer than current), check whether
 * its dependency range for the vulnerable child *excludes* all vulnerable versions.
 * We use `!semver.intersects(childRange, vulnerableRange)` — if the parent's range
 * has no overlap with the vulnerable range, upgrading the parent fixes the issue.
 */
export async function findParentFix(
  parentPackage: string,
  currentParentVersion: string,
  vulnerableChild: string,
  patchedChildVersions: string,
  vulnerableChildVersions?: string
): Promise<{
  found: boolean;
  targetVersion: string | null;
  changeType: 'major' | 'minor' | 'patch' | 'none';
  majorBumpAvailable?: {
    targetVersion: string;
  };
}> {
  const info = await fetchPackageInfo(parentPackage);
  if (!info) return { found: false, targetVersion: null, changeType: 'none' };

  // Sort ascending so we return the minimum fix version
  const versions = Object.keys(info.versions)
    .filter((v) => semver.valid(v) && semver.gt(v, currentParentVersion))
    .sort(semver.compare);

  let majorBump: { targetVersion: string } | undefined;

  for (const version of versions) {
    const deps = info.versions[version]?.dependencies || {};
    const childRange = deps[vulnerableChild];

    if (!childRange) continue;

    // Check if the parent's dependency range for the child excludes vulnerable versions.
    // Two strategies depending on available data:
    let fixesVulnerability = false;

    if (vulnerableChildVersions) {
      // Best check: parent's child range doesn't intersect the vulnerable range at all
      fixesVulnerability = !semver.intersects(childRange, vulnerableChildVersions);
    } else if (patchedChildVersions) {
      // Fallback: check that the minimum version satisfying the parent's child range
      // is itself in the patched set
      const minChild = semver.minVersion(childRange);
      if (minChild) {
        fixesVulnerability = semver.satisfies(minChild.version, patchedChildVersions);
      }
    }

    if (fixesVulnerability) {
      const changeType = calculateVersionChangeType(currentParentVersion, version);

      // Only return patch or minor upgrades automatically
      if (changeType === 'patch' || changeType === 'minor') {
        return { found: true, targetVersion: version, changeType };
      }
      // Capture the first major bump that fixes the vulnerability
      if (changeType === 'major' && !majorBump) {
        majorBump = { targetVersion: version };
      }
    }
  }

  return { found: false, targetVersion: null, changeType: 'none', majorBumpAvailable: majorBump };
}

/**
 * Create a resolution fix for a transitive dependency
 */
export async function createResolutionFix(
  vulnerability: Vulnerability,
  rootPath: string,
  packageManager: PackageManager,
  catalogs?: CatalogData
): Promise<FixAction> {
  const { packageName, currentVersion, patchedVersions, rootDependency, vulnerableVersions } = vulnerability;

  // First, try to find if parent package has a fix
  if (rootDependency && patchedVersions) {
    const parentVersion = getParentVersion(rootPath, rootDependency, catalogs);

    if (parentVersion) {
      const parentFix = await findParentFix(
        rootDependency,
        parentVersion,
        packageName,
        patchedVersions,
        vulnerableVersions
      );

      if (parentFix.found && parentFix.targetVersion) {
        return {
          type: 'upgrade',
          packageName: rootDependency,
          currentVersion: parentVersion,
          targetVersion: parentFix.targetVersion,
          versionChangeType: parentFix.changeType,
          vulnerability,
          reason: `Upgrade parent package ${rootDependency} to ${parentFix.targetVersion} (${parentFix.changeType}) which includes patched ${packageName}`,
        };
      }

      // Surface major parent bump info even when no patch/minor fix was found
      const majorParentBump = parentFix.majorBumpAvailable
        ? { parentPackage: rootDependency, targetVersion: parentFix.majorBumpAvailable.targetVersion }
        : undefined;

      // No parent fix available, create a resolution
      const targetVersion = await getTargetVersion(packageName, currentVersion, patchedVersions);

      if (!targetVersion) {
        return {
          type: 'skip',
          packageName,
          currentVersion,
          targetVersion: null,
          versionChangeType: 'none',
          vulnerability,
          majorParentBump,
          reason: 'No patched version available',
        };
      }

      return {
        type: 'resolution',
        packageName,
        currentVersion,
        targetVersion,
        versionChangeType: calculateVersionChangeType(currentVersion, targetVersion),
        vulnerability,
        resolutionPath: packageName,
        majorParentBump,
        reason: `Add resolution to force ${packageName}@${targetVersion}`,
      };
    }
  }

  // No parent fix available (no rootDependency or no parentVersion), create a resolution
  const targetVersion = await getTargetVersion(packageName, currentVersion, patchedVersions);

  if (!targetVersion) {
    return {
      type: 'skip',
      packageName,
      currentVersion,
      targetVersion: null,
      versionChangeType: 'none',
      vulnerability,
      reason: 'No patched version available',
    };
  }

  return {
    type: 'resolution',
    packageName,
    currentVersion,
    targetVersion,
    versionChangeType: calculateVersionChangeType(currentVersion, targetVersion),
    vulnerability,
    resolutionPath: packageName,
    reason: `Add resolution to force ${packageName}@${targetVersion}`,
  };
}

/**
 * Get the current version of a parent package from package.json,
 * resolving catalog references if catalogs are provided
 */
function getParentVersion(rootPath: string, packageName: string, catalogs?: CatalogData): string | null {
  const packageJsonPath = join(rootPath, 'package.json');

  if (!existsSync(packageJsonPath)) return null;

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);

    let version =
      pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName];

    if (!version) return null;

    // Resolve catalog references to actual semver ranges
    version = resolveCatalogVersion(packageName, version, catalogs);

    // Use minVersion for ranges (^1.2.3 → 1.2.3) — more accurate than coerce
    const minVer = semver.minVersion(version);
    if (minVer) return minVer.version;

    return semver.coerce(version)?.version || null;
  } catch {
    return null;
  }
}

/**
 * Build the resolution key for package managers
 */
export function buildResolutionKey(
  packageName: string,
  parentPath?: string
): string {
  // For now, just use the package name
  // In the future, could support scoped resolutions like:
  // - npm: { "parent": { "childPackage": "version" } }
  // - yarn: "parent/childPackage": "version"
  return packageName;
}

/**
 * Get all existing resolutions from package.json
 */
export function getExistingResolutions(
  packageJsonPath: string,
  packageManager: PackageManager
): Record<string, string> {
  if (!existsSync(packageJsonPath)) return {};

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);

    if (packageManager === 'npm') {
      return pkg.overrides || {};
    } else if (packageManager === 'yarn') {
      return pkg.resolutions || {};
    } else if (packageManager === 'pnpm') {
      return pkg.pnpm?.overrides || {};
    }

    return {};
  } catch {
    return {};
  }
}

/**
 * Apply multiple resolutions at once
 */
export function applyResolutions(
  packageJsonPath: string,
  resolutions: Record<string, string>,
  packageManager: PackageManager
): void {
  const content = readFileSync(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content);

  if (packageManager === 'npm') {
    pkg.overrides = { ...(pkg.overrides || {}), ...resolutions };
  } else if (packageManager === 'yarn') {
    pkg.resolutions = { ...(pkg.resolutions || {}), ...resolutions };
  } else if (packageManager === 'pnpm') {
    pkg.pnpm = pkg.pnpm || {};
    pkg.pnpm.overrides = { ...(pkg.pnpm.overrides || {}), ...resolutions };
  }

  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * Remove specified resolutions/overrides from package.json.
 * Cleans up empty objects (e.g. removes `overrides: {}` or `pnpm: {}`).
 */
export function removeResolutions(
  packageJsonPath: string,
  packageNames: string[],
  packageManager: PackageManager
): void {
  const content = readFileSync(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content);

  if (packageManager === 'npm') {
    if (pkg.overrides) {
      for (const name of packageNames) {
        delete pkg.overrides[name];
      }
      if (Object.keys(pkg.overrides).length === 0) {
        delete pkg.overrides;
      }
    }
  } else if (packageManager === 'yarn') {
    if (pkg.resolutions) {
      for (const name of packageNames) {
        delete pkg.resolutions[name];
      }
      if (Object.keys(pkg.resolutions).length === 0) {
        delete pkg.resolutions;
      }
    }
  } else if (packageManager === 'pnpm') {
    if (pkg.pnpm?.overrides) {
      for (const name of packageNames) {
        delete pkg.pnpm.overrides[name];
      }
      if (Object.keys(pkg.pnpm.overrides).length === 0) {
        delete pkg.pnpm.overrides;
      }
      if (Object.keys(pkg.pnpm).length === 0) {
        delete pkg.pnpm;
      }
    }
  }

  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}
