import * as semver from 'semver';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Vulnerability,
  FixAction,
  PackageManager,
} from '../../types/index.js';
import { getTargetVersion, calculateVersionChangeType } from './direct.js';

/**
 * Fetch package info from npm registry
 */
async function fetchPackageInfo(packageName: string): Promise<{
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
 * Check if parent has a patch/minor version that fixes the transitive vulnerability
 */
export async function findParentFix(
  parentPackage: string,
  currentParentVersion: string,
  vulnerableChild: string,
  patchedChildVersions: string
): Promise<{
  found: boolean;
  targetVersion: string | null;
  changeType: 'major' | 'minor' | 'patch' | 'none';
}> {
  const info = await fetchPackageInfo(parentPackage);
  if (!info) return { found: false, targetVersion: null, changeType: 'none' };

  const versions = Object.keys(info.versions)
    .filter((v) => semver.valid(v) && semver.gt(v, currentParentVersion))
    .sort(semver.compare);

  for (const version of versions) {
    const deps = info.versions[version]?.dependencies || {};
    const childRange = deps[vulnerableChild];

    if (!childRange) continue;

    // Check if parent's child dependency range requires patched version
    // by checking if all satisfying versions are patched
    const childInfo = await fetchPackageInfo(vulnerableChild);
    if (!childInfo) continue;

    const childVersions = Object.keys(childInfo.versions).filter((v) =>
      semver.satisfies(v, childRange)
    );

    // Check if all versions matching parent's range are patched
    const allPatched = childVersions.every((v) =>
      semver.satisfies(v, patchedChildVersions)
    );

    if (allPatched) {
      const changeType = calculateVersionChangeType(currentParentVersion, version);
      
      // Only return patch or minor upgrades
      if (changeType === 'patch' || changeType === 'minor') {
        return { found: true, targetVersion: version, changeType };
      }
    }
  }

  return { found: false, targetVersion: null, changeType: 'none' };
}

/**
 * Create a resolution fix for a transitive dependency
 */
export async function createResolutionFix(
  vulnerability: Vulnerability,
  rootPath: string,
  packageManager: PackageManager
): Promise<FixAction> {
  const { packageName, currentVersion, patchedVersions, rootDependency } = vulnerability;

  // First, try to find if parent package has a fix
  if (rootDependency && patchedVersions) {
    const parentVersion = getParentVersion(rootPath, rootDependency);
    
    if (parentVersion) {
      const parentFix = await findParentFix(
        rootDependency,
        parentVersion,
        packageName,
        patchedVersions
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
    }
  }

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
 * Get the current version of a parent package from package.json
 */
function getParentVersion(rootPath: string, packageName: string): string | null {
  const packageJsonPath = join(rootPath, 'package.json');
  
  if (!existsSync(packageJsonPath)) return null;

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    
    const version =
      pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName];
    
    if (!version) return null;
    
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
