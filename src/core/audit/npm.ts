import type { AuditResult, Vulnerability } from '../../types/index.js';
import {
  type NpmAuditOutput,
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

      for (const via of viaDetails) {
        const vulnerability: Vulnerability = {
          id: `npm-${via.source}`,
          title: via.title,
          severity: normalizeSeverity(via.severity),
          packageName: pkgName,
          currentVersion: extractCurrentVersion(vuln.nodes),
          vulnerableVersions: via.range,
          patchedVersions: getFixVersion(vuln.fixAvailable),
          recommendation: getRecommendation(vuln.fixAvailable),
          url: via.url,
          cwe: via.cwe || [],
          cvss: via.cvss?.score || null,
          dependencyPath: vuln.nodes,
          isDirect: vuln.isDirect,
          rootDependency: vuln.isDirect ? null : vuln.effects[0] || null,
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
 * Extract current version from node paths
 */
function extractCurrentVersion(nodes: string[]): string {
  if (!nodes || nodes.length === 0) return 'unknown';
  
  // Node format is usually: node_modules/package or node_modules/parent/node_modules/package
  // We need to look up the actual version from package-lock.json, but for now return unknown
  return 'unknown';
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
