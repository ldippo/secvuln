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

    // No parents found — direct dep override or orphaned, safe to remove
    if (parents.length === 0) {
      return {
        packageName,
        overrideVersion,
        status: 'removable',
        reason: `Latest version ${latest} is newer than override ${resolvedOverride}; no parent dependencies require this override`,
        suggestedVersion: null,
        parentDependencies: [],
      };
    }

    // All parents have safe (patch/minor) upgrade paths that would resolve the child
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
        status: 'removable',
        reason: `Override can be removed after bumping parent dependencies: ${parentBumps}`,
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
