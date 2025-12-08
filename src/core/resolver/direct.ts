import * as semver from 'semver';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Vulnerability,
  FixAction,
  VersionChangeType,
  PackageManager,
} from '../../types/index.js';
import { getVersionChangeType, analyzeChangelog } from '../changelog/index.js';

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

/**
 * Check if a parent package has a newer version that fixes a transitive vulnerability
 */
export async function checkParentPackageFix(
  vulnerablePackage: string,
  vulnerableVersion: string,
  parentPackage: string,
  currentParentVersion: string
): Promise<{ hasfix: boolean; targetVersion: string | null; changeType: VersionChangeType }> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${parentPackage}`);
    if (!response.ok) return { hasfix: false, targetVersion: null, changeType: 'none' };
    
    const data = await response.json() as {
      versions: Record<string, { dependencies?: Record<string, string> }>;
    };
    
    const versions = Object.keys(data.versions || {});
    
    // Find versions newer than current that don't depend on vulnerable version
    for (const version of versions.sort(semver.compare).reverse()) {
      if (!semver.gt(version, currentParentVersion)) continue;
      
      const versionData = data.versions[version];
      const deps = versionData?.dependencies || {};
      const depRange = deps[vulnerablePackage];
      
      if (!depRange) continue; // Parent doesn't depend on this package in this version
      
      // Check if this version requires a non-vulnerable version
      if (!semver.intersects(depRange, `<=${vulnerableVersion}`)) {
        const changeType = calculateVersionChangeType(currentParentVersion, version);
        
        // Only suggest patch or minor upgrades automatically
        if (changeType === 'patch' || changeType === 'minor') {
          return { hasfix: true, targetVersion: version, changeType };
        }
      }
    }
    
    return { hasfix: false, targetVersion: null, changeType: 'none' };
  } catch {
    return { hasfix: false, targetVersion: null, changeType: 'none' };
  }
}

/**
 * Create a fix action for a transitive dependency
 */
export async function createTransitiveFixAction(
  vulnerability: Vulnerability,
  rootPackagePath: string
): Promise<FixAction> {
  const { rootDependency, packageName, currentVersion, patchedVersions } = vulnerability;

  // First, check if parent package has a fix
  if (rootDependency) {
    // We'd need to look up current parent version from package.json
    // For now, create a resolution
  }

  // Get target version for resolution
  const targetVersion = await getTargetVersion(packageName, currentVersion, patchedVersions);

  if (!targetVersion) {
    return {
      type: 'skip',
      packageName,
      currentVersion,
      targetVersion: null,
      versionChangeType: 'none',
      vulnerability,
      reason: 'No patched version available for transitive dependency',
    };
  }

  return {
    type: 'resolution',
    packageName,
    currentVersion,
    targetVersion,
    versionChangeType: calculateVersionChangeType(currentVersion, targetVersion),
    vulnerability,
    resolutionPath: rootDependency ? `${rootDependency}/${packageName}` : packageName,
    reason: `Add resolution to force ${packageName}@${targetVersion}`,
  };
}

/**
 * Apply an upgrade to package.json
 */
export function applyUpgrade(
  packageJsonPath: string,
  packageName: string,
  targetVersion: string
): void {
  const content = readFileSync(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content);

  // Check both dependencies and devDependencies
  if (pkg.dependencies?.[packageName]) {
    pkg.dependencies[packageName] = `^${targetVersion}`;
  } else if (pkg.devDependencies?.[packageName]) {
    pkg.devDependencies[packageName] = `^${targetVersion}`;
  }

  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * Apply a resolution/override to package.json
 */
export function applyResolution(
  packageJsonPath: string,
  packageName: string,
  targetVersion: string,
  packageManager: PackageManager
): void {
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
 * Get current version of a direct dependency from package.json
 */
export function getCurrentVersion(
  packageJsonPath: string,
  packageName: string
): string | null {
  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    
    const version = pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName];
    if (!version) return null;
    
    // Clean version string (remove ^ ~ etc)
    return semver.coerce(version)?.version || version.replace(/^[\^~]/, '');
  } catch {
    return null;
  }
}
