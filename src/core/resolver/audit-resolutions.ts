import * as semver from 'semver';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  PackageManager,
  CatalogData,
  ResolutionAuditEntry,
  ResolutionAuditResult,
  ResolutionStatus,
  ParentDependencyInfo,
  VersionChangeType,
} from '../../types/index.js';
import { getExistingResolutions, fetchPackageInfo } from './transitive.js';
import { calculateVersionChangeType } from './direct.js';
import { resolveCatalogVersion } from '../workspace/catalog.js';

type RegistryInfo = Awaited<ReturnType<typeof fetchPackageInfo>>;

/**
 * Audit existing resolutions/overrides to determine if they are still needed.
 *
 * For each override:
 * - `removable`: latest published version >= override version (ecosystem moved past it)
 * - `stale`: override is still protecting, but a newer patched version exists
 * - `needed`: override is actively protecting at the best available version
 * - `unknown`: can't determine (registry fetch failed, complex override format)
 */
export async function auditResolutions(
  rootPath: string,
  packageManager: PackageManager,
  catalogs?: CatalogData
): Promise<ResolutionAuditResult> {
  const packageJsonPath = join(rootPath, 'package.json');
  const resolutions = getExistingResolutions(packageJsonPath, packageManager);
  const entries: ResolutionAuditEntry[] = [];

  const registryCache = new Map<string, RegistryInfo>();
  const directDeps = readDirectDependencies(packageJsonPath, catalogs);

  for (const [packageName, overrideVersion] of Object.entries(resolutions)) {
    const entry = await classifyResolution(
      packageName,
      overrideVersion,
      directDeps,
      registryCache
    );
    entries.push(entry);
  }

  const counts: Record<ResolutionStatus, number> = {
    needed: 0,
    removable: 0,
    stale: 0,
    unknown: 0,
  };

  for (const entry of entries) {
    counts[entry.status]++;
  }

  return {
    packageManager,
    rootPath,
    totalResolutions: entries.length,
    entries,
    counts,
  };
}

/**
 * Read all direct dependencies from package.json with resolved versions.
 */
function readDirectDependencies(
  packageJsonPath: string,
  catalogs?: CatalogData
): Map<string, string> {
  const deps = new Map<string, string>();

  if (!existsSync(packageJsonPath)) return deps;

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);

    const allDeps: Record<string, string> = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    for (const [name, rawVersion] of Object.entries(allDeps)) {
      const resolved = resolveCatalogVersion(name, rawVersion, catalogs);
      const minVer = semver.minVersion(resolved);
      if (minVer) {
        deps.set(name, minVer.version);
      } else {
        const coerced = semver.coerce(resolved);
        if (coerced) deps.set(name, coerced.version);
      }
    }
  } catch {
    // Ignore parse errors
  }

  return deps;
}

/**
 * Fetch registry info with caching.
 */
async function getCachedRegistryInfo(
  packageName: string,
  cache: Map<string, RegistryInfo>
): Promise<RegistryInfo> {
  let info = cache.get(packageName);
  if (info === undefined) {
    info = await fetchPackageInfo(packageName);
    cache.set(packageName, info);
  }
  return info;
}

/**
 * Find which direct dependencies depend on a given transitive package,
 * and whether bumping them would resolve a version >= the override.
 */
async function findParentDependencies(
  childPackage: string,
  overrideVersion: string,
  directDeps: Map<string, string>,
  registryCache: Map<string, RegistryInfo>
): Promise<ParentDependencyInfo[]> {
  const parents: ParentDependencyInfo[] = [];
  const resolvedOverride = semver.coerce(overrideVersion)?.version;
  if (!resolvedOverride) return parents;

  for (const [parentName, parentVersion] of directDeps) {
    const parentInfo = await getCachedRegistryInfo(parentName, registryCache);
    if (!parentInfo) continue;

    // Check if this parent depends on the child in its current version
    const currentDeps = parentInfo.versions[parentVersion]?.dependencies;
    if (!currentDeps || !(childPackage in currentDeps)) continue;

    // Skip if parent's current range for the child already resolves to >= override.
    // In that case, this parent doesn't actually need the override.
    const currentChildRange = currentDeps[childPackage];
    const currentChildMin = semver.minVersion(currentChildRange);
    if (currentChildMin && semver.gte(currentChildMin.version, resolvedOverride)) {
      continue;
    }

    // This parent depends on the overridden child — find a version
    // where it would naturally resolve >= override version
    const parentFix = findParentVersionThatResolvesChild(
      parentInfo,
      parentVersion,
      childPackage,
      resolvedOverride
    );

    const versionChangeType: VersionChangeType = parentFix.targetVersion
      ? calculateVersionChangeType(parentVersion, parentFix.targetVersion)
      : 'none';

    parents.push({
      name: parentName,
      currentVersion: parentVersion,
      targetVersion: parentFix.targetVersion,
      versionChangeType,
      isSafe: versionChangeType === 'patch' || versionChangeType === 'minor',
    });
  }

  // Depth-2 search: check each direct dep's transitive dependencies
  // for the child package. This catches the common pattern where a direct dep
  // depends on an intermediate package that in turn depends on the child.
  const checkedNames = new Set(parents.map((p) => p.name));
  for (const [parentName, parentVersion] of directDeps) {
    const parentInfo = await getCachedRegistryInfo(parentName, registryCache);
    if (!parentInfo) continue;
    const parentDeps = parentInfo.versions[parentVersion]?.dependencies;
    if (!parentDeps) continue;

    for (const [subDepName, subDepRange] of Object.entries(parentDeps)) {
      if (subDepName === childPackage || checkedNames.has(subDepName)) continue;
      const subDepInfo = await getCachedRegistryInfo(subDepName, registryCache);
      if (!subDepInfo) continue;
      const subDepMinVer = semver.minVersion(subDepRange);
      if (!subDepMinVer) continue;
      const subDepVersion = subDepMinVer.version;
      const subDeps = subDepInfo.versions[subDepVersion]?.dependencies;
      if (!subDeps || !(childPackage in subDeps)) continue;

      // This intermediate dep depends on the child — check if its range needs the override
      const childRange = subDeps[childPackage];
      const childMinVer = semver.minVersion(childRange);
      if (childMinVer && semver.gte(childMinVer.version, resolvedOverride)) {
        continue; // Already resolves to >= override
      }

      const subFix = findParentVersionThatResolvesChild(
        subDepInfo,
        subDepVersion,
        childPackage,
        resolvedOverride
      );

      const versionChangeType: VersionChangeType = subFix.targetVersion
        ? calculateVersionChangeType(subDepVersion, subFix.targetVersion)
        : 'none';

      parents.push({
        name: subDepName,
        currentVersion: subDepVersion,
        targetVersion: subFix.targetVersion,
        versionChangeType,
        isSafe: versionChangeType === 'patch' || versionChangeType === 'minor',
      });
      checkedNames.add(subDepName);
    }
  }

  return parents;
}

/**
 * Find the minimum parent version where the child dependency range
 * requires >= the override version (making the override unnecessary).
 */
function findParentVersionThatResolvesChild(
  parentInfo: NonNullable<RegistryInfo>,
  currentParentVersion: string,
  childPackage: string,
  overrideVersion: string
): { targetVersion: string | null } {
  const versions = Object.keys(parentInfo.versions)
    .filter((v) => semver.valid(v) && semver.gt(v, currentParentVersion))
    .sort(semver.compare);

  for (const version of versions) {
    const deps = parentInfo.versions[version]?.dependencies || {};
    const childRange = deps[childPackage];

    if (!childRange) continue;

    // Check if the minimum version satisfying this range is >= override
    const minChild = semver.minVersion(childRange);
    if (minChild && semver.gte(minChild.version, overrideVersion)) {
      return { targetVersion: version };
    }
  }

  return { targetVersion: null };
}

async function classifyResolution(
  packageName: string,
  overrideVersion: string,
  directDeps: Map<string, string>,
  registryCache: Map<string, RegistryInfo>
): Promise<ResolutionAuditEntry> {
  // Non-semver override values (npm nested overrides, $-refs, URLs) -> unknown
  const coerced = semver.coerce(overrideVersion);
  if (!coerced) {
    return {
      packageName,
      overrideVersion,
      status: 'unknown',
      reason: `Override value "${overrideVersion}" is not a simple semver version`,
      suggestedVersion: null,
      parentDependencies: [],
    };
  }

  const resolvedOverride = coerced.version;

  // Fetch registry info (cached)
  const info = await getCachedRegistryInfo(packageName, registryCache);

  if (!info) {
    return {
      packageName,
      overrideVersion,
      status: 'unknown',
      reason: 'Failed to fetch package info from registry',
      suggestedVersion: null,
      parentDependencies: [],
    };
  }

  const latest = info['dist-tags']?.latest;
  if (!latest || !semver.valid(latest)) {
    return {
      packageName,
      overrideVersion,
      status: 'unknown',
      reason: 'Could not determine latest version from registry',
      suggestedVersion: null,
      parentDependencies: [],
    };
  }

  // If latest < override, something unusual is going on
  if (semver.lt(latest, resolvedOverride)) {
    return {
      packageName,
      overrideVersion,
      status: 'unknown',
      reason: `Latest published version (${latest}) is older than override (${resolvedOverride})`,
      suggestedVersion: null,
      parentDependencies: [],
    };
  }

  // If latest > override, check whether the override is still protecting parents
  if (semver.gt(latest, resolvedOverride)) {
    const parents = await findParentDependencies(
      packageName,
      overrideVersion,
      directDeps,
      registryCache
    );

    // No parents found that need the override
    if (parents.length === 0) {
      // If the package is a direct dependency, it's safe to remove the override
      // since latest > override and no transitive path needs protection
      if (directDeps.has(packageName)) {
        return {
          packageName,
          overrideVersion,
          status: 'removable',
          reason: `Latest version ${latest} is newer than override ${resolvedOverride}; package is a direct dependency with no transitive paths requiring this override`,
          suggestedVersion: null,
          parentDependencies: [],
        };
      }

      // For transitive-only packages, we can't verify all dependency paths —
      // there may be deeper transitive parents we didn't check
      return {
        packageName,
        overrideVersion,
        status: 'unknown',
        reason: `No parent dependency paths verified; override may still protect transitive dependencies not visible from direct dependencies`,
        suggestedVersion: null,
        parentDependencies: [],
      };
    }

    // All parents have safe (patch/minor) upgrade paths that would resolve the child.
    // However, the override is still needed UNTIL those parents are actually bumped —
    // removing the override without bumping parents leaves vulnerable versions in the tree.
    const allParentsResolved = parents.every(
      (p) => p.targetVersion !== null && p.isSafe
    );
    if (allParentsResolved) {
      const parentBumps = parents
        .map((p) => `${p.name}@${p.targetVersion}`)
        .join(', ');
      return {
        packageName,
        overrideVersion,
        status: 'needed',
        reason: `Override is still needed; can be removed after bumping: ${parentBumps}`,
        suggestedVersion: null,
        parentDependencies: parents,
      };
    }

    // Override is still protecting, but a newer version is available to bump to
    return {
      packageName,
      overrideVersion,
      status: 'stale',
      reason: `Override ${resolvedOverride} is still needed but can be bumped to ${latest}`,
      suggestedVersion: latest,
      parentDependencies: parents,
    };
  }

  // latest === override: the override is pinning to exactly the current latest
  return {
    packageName,
    overrideVersion,
    status: 'needed',
    reason: `Override matches latest version (${latest}); still actively protecting`,
    suggestedVersion: null,
    parentDependencies: [],
  };
}
