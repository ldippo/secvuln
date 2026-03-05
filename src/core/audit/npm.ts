import type { AuditResult, Vulnerability } from '../../types/index.js';
import {
  type NpmAuditOutput,
  type NpmVulnerability,
  type NpmVulnVia,
  normalizeSeverity,
  createEmptyAuditResult,
} from './types.js';

/**
 * Parse npm audit JSON output into normalized AuditResult
 */
export function parseNpmAudit(jsonOutput: string): AuditResult {
  const result = createEmptyAuditResult('npm');

  let data: NpmAuditOutput;
  try {
    data = JSON.parse(jsonOutput);
  } catch {
    console.error('Failed to parse npm audit JSON output');
    return result;
  }

  // Handle npm audit v2+ format
  if (data.vulnerabilities) {
    for (const [pkgName, vuln] of Object.entries(data.vulnerabilities)) {
      // Get detailed vulnerability info from the 'via' field
      const viaDetails = vuln.via.filter(
        (v): v is NpmVulnVia => typeof v !== 'string'
      );

      if (viaDetails.length === 0) {
        // This is a transitive vulnerability, the 'via' contains string references
        // to other packages that have the actual vulnerability details
        continue;
      }

      const dependencyPath = buildDependencyPath(pkgName, vuln.nodes);
      const isDirectDep = vuln.isDirect;
      const rootDep = isDirectDep
        ? null
        : findRootDependency(pkgName, vuln.nodes, data.vulnerabilities ?? {});

      for (const via of viaDetails) {
        const vulnerability: Vulnerability = {
          id: `npm-${via.source}`,
          title: via.title,
          severity: normalizeSeverity(via.severity),
          packageName: pkgName,
          currentVersion: extractCurrentVersion(via),
          vulnerableVersions: via.range,
          patchedVersions: getFixVersion(vuln.fixAvailable),
          recommendation: getRecommendation(vuln.fixAvailable),
          url: via.url,
          cwe: via.cwe || [],
          cvss: via.cvss?.score || null,
          dependencyPath,
          isDirect: isDirectDep,
          rootDependency: rootDep,
        };

        result.vulnerabilities.push(vulnerability);
        result.metadata.vulnerabilityCounts[vulnerability.severity]++;
      }
    }
  }

  // Update metadata
  if (data.metadata) {
    result.metadata.totalDependencies = data.metadata.dependencies?.total || 0;
  }

  return result;
}

/**
 * Extract a usable current version from the via advisory data.
 * npm audit v2 doesn't report the installed version directly — that lives
 * in the lockfile. As a best-effort, extract the first semver version
 * mentioned in the vulnerable range string (e.g. "<4.17.21" → "4.17.21",
 * ">=1.0.0 <1.2.3" → "1.0.0"). This gives downstream semver comparisons
 * a real version to work with instead of 'unknown'.
 */
function extractCurrentVersion(via: NpmVulnVia): string {
  const match = via.range.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : 'unknown';
}

/**
 * Build a normalized dependency path from npm's node paths.
 * npm nodes look like: ["node_modules/pkg"] or ["node_modules/parent/node_modules/pkg"]
 */
function buildDependencyPath(pkgName: string, nodes: string[]): string[] {
  if (!nodes || nodes.length === 0) return [pkgName];

  // Use the first node path to derive the chain
  const nodePath = nodes[0];
  // Split on /node_modules/ to get the chain of packages
  const segments = nodePath.split(/\/node_modules\//).filter(Boolean);
  return segments.length > 0 ? segments : [pkgName];
}

/**
 * Find the root (direct) dependency that introduces a transitive package.
 * Walk up the node_modules nesting from the first node path.
 * For "node_modules/express/node_modules/qs", the root dep is "express".
 *
 * Falls back to walking the effects/via chain in the vulnerabilities map.
 */
function findRootDependency(
  pkgName: string,
  nodes: string[],
  vulnerabilities: Record<string, NpmVulnerability>
): string | null {
  // Strategy 1: derive from node_modules nesting
  if (nodes && nodes.length > 0) {
    const nodePath = nodes[0];
    const segments = nodePath.split(/\/node_modules\//).filter(Boolean);
    // segments[0] is the outermost (direct) dep, segments[-1] is the vulnerable pkg
    if (segments.length >= 2) {
      // The first segment is the direct dependency name
      return segments[0].replace(/\/.*$/, '');
    }
  }

  // Strategy 2: walk the effects chain to find a direct dependency.
  // effects[i] is a package that depends on pkgName — walk up until we find one that isDirect.
  const visited = new Set<string>();
  const queue = [pkgName];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    // Find packages that list `current` in their via (i.e., depend on it)
    for (const [name, entry] of Object.entries(vulnerabilities)) {
      if (name === current) continue;
      const dependsOnCurrent = entry.via.some(
        (v) => (typeof v === 'string' ? v : v.name) === current
      );
      if (!dependsOnCurrent) continue;

      if (entry.isDirect) {
        return name;
      }
      queue.push(name);
    }
  }

  return null;
}

/**
 * Get the fix version from fixAvailable
 */
function getFixVersion(
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean } | undefined
): string | null {
  if (!fixAvailable) return null;
  if (typeof fixAvailable === 'boolean') return null;
  return fixAvailable.version;
}

/**
 * Get recommendation text from fixAvailable
 */
function getRecommendation(
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean } | undefined
): string | null {
  if (!fixAvailable) return 'No fix available';
  if (fixAvailable === true) return 'Run npm audit fix';
  if (typeof fixAvailable === 'object') {
    const majorNote = fixAvailable.isSemVerMajor ? ' (major version change)' : '';
    return `Upgrade ${fixAvailable.name} to ${fixAvailable.version}${majorNote}`;
  }
  return null;
}
