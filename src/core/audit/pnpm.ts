import type { AuditResult, Vulnerability } from '../../types/index.js';
import {
  type PnpmAuditOutput,
  normalizeSeverity,
  createEmptyAuditResult,
  parseDependencyPath,
  isDirect,
  getRootDependency,
} from './types.js';

/**
 * Parse pnpm audit JSON output into normalized AuditResult
 */
export function parsePnpmAudit(jsonOutput: string): AuditResult {
  const result = createEmptyAuditResult('pnpm');
  
  let data: PnpmAuditOutput;
  try {
    data = JSON.parse(jsonOutput);
  } catch {
    console.error('Failed to parse pnpm audit JSON output');
    return result;
  }

  if (data.advisories) {
    for (const [id, advisory] of Object.entries(data.advisories)) {
      for (const finding of advisory.findings) {
        for (const path of finding.paths) {
          const pathParts = parseDependencyPath(path);
          const isDirectDep = isDirect(path);

          const vulnerability: Vulnerability = {
            id: `pnpm-${id}`,
            title: advisory.title,
            severity: normalizeSeverity(advisory.severity),
            packageName: advisory.module_name,
            currentVersion: finding.version,
            vulnerableVersions: advisory.vulnerable_versions,
            patchedVersions: advisory.patched_versions || null,
            recommendation: advisory.patched_versions
              ? `Upgrade to ${advisory.patched_versions}`
              : 'No patched version available',
            url: advisory.url,
            cwe: advisory.cwe || [],
            cvss: advisory.cvss?.score || null,
            dependencyPath: pathParts,
            isDirect: isDirectDep,
            rootDependency: isDirectDep ? null : getRootDependency(path),
          };

          result.vulnerabilities.push(vulnerability);
          result.metadata.vulnerabilityCounts[vulnerability.severity]++;
        }
      }
    }
  }

  // Update metadata
  if (data.metadata) {
    result.metadata.totalDependencies = data.metadata.totalDependencies || 0;
  }

  return result;
}
