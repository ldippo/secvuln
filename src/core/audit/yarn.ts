import type { AuditResult, Vulnerability } from '../../types/index.js';
import {
  type YarnAuditLine,
  type YarnAuditAdvisory,
  normalizeSeverity,
  createEmptyAuditResult,
  parseDependencyPath,
  isDirect,
  getRootDependency,
} from './types.js';

/**
 * Parse yarn audit JSON lines output into normalized AuditResult
 * Yarn outputs one JSON object per line
 */
export function parseYarnAudit(jsonOutput: string): AuditResult {
  const result = createEmptyAuditResult('yarn');
  
  const lines = jsonOutput.trim().split('\n').filter(Boolean);
  const seenIds = new Set<string>();

  for (const line of lines) {
    try {
      const parsed: YarnAuditLine = JSON.parse(line);
      
      if (parsed.type === 'auditAdvisory') {
        const data = parsed.data as YarnAuditAdvisory;
        const advisory = data.advisory;
        const resolution = data.resolution;
        
        // Create unique ID to avoid duplicates
        const uniqueId = `yarn-${advisory.id}-${resolution.path}`;
        if (seenIds.has(uniqueId)) continue;
        seenIds.add(uniqueId);

        const path = resolution.path;
        const pathParts = parseDependencyPath(path);
        const isDirectDep = isDirect(path);

        for (const finding of advisory.findings) {
          const vulnerability: Vulnerability = {
            id: `yarn-${advisory.id}`,
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
      } else if (parsed.type === 'auditSummary') {
        // Update total dependencies from summary
        const summary = parsed.data as { totalDependencies?: number };
        if (summary.totalDependencies) {
          result.metadata.totalDependencies = summary.totalDependencies;
        }
      }
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  return result;
}
