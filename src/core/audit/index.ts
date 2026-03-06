import type { AuditResult, PackageManager } from '../../types/index.js';
import { getAuditCommand, runCommand } from '../package-manager.js';
import { parseNpmAudit } from './npm.js';
import { parseYarnAudit } from './yarn.js';
import { parsePnpmAudit } from './pnpm.js';
import { createEmptyAuditResult } from './types.js';

export { parseNpmAudit } from './npm.js';
export { parseYarnAudit } from './yarn.js';
export { parsePnpmAudit } from './pnpm.js';

/**
 * Run audit for the given package manager and parse results
 */
export async function runAudit(
  pm: PackageManager,
  cwd: string
): Promise<AuditResult> {
  const [cmd, ...args] = getAuditCommand(pm);
  
  // Audit commands return non-zero exit codes when vulnerabilities are found
  // so we can't rely on exit code to determine success
  const result = await runCommand(cmd, args, cwd);
  
  // If completely empty output, return empty result
  if (!result.stdout && !result.stderr) {
    return createEmptyAuditResult(pm);
  }

  // Parse based on package manager
  const output = result.stdout || result.stderr;
  
  switch (pm) {
    case 'npm':
      return parseNpmAudit(output);
    case 'yarn':
      return parseYarnAudit(output);
    case 'pnpm':
      return parsePnpmAudit(output);
  }
}

/**
 * Deduplicate vulnerabilities by ID and package name
 */
export function deduplicateVulnerabilities(result: AuditResult): AuditResult {
  // Use a map keyed by id+packageName, preferring direct deps over transitive.
  // This prevents direct dependencies from being treated as transitive (and
  // getting overrides instead of dependency bumps) when the transitive entry
  // happens to appear first in the array.
  const bestByKey = new Map<string, typeof result.vulnerabilities[number]>();
  for (const v of result.vulnerabilities) {
    const key = `${v.id}-${v.packageName}`;
    const existing = bestByKey.get(key);
    if (!existing || (v.isDirect && !existing.isDirect)) {
      bestByKey.set(key, v);
    }
  }
  const deduped = [...bestByKey.values()];

  // Recalculate counts
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  for (const v of deduped) {
    counts[v.severity]++;
  }

  return {
    ...result,
    vulnerabilities: deduped,
    metadata: {
      ...result.metadata,
      vulnerabilityCounts: counts,
    },
  };
}

/**
 * Group vulnerabilities by severity
 */
export function groupBySeverity(
  result: AuditResult
): Record<string, typeof result.vulnerabilities> {
  const groups: Record<string, typeof result.vulnerabilities> = {
    critical: [],
    high: [],
    moderate: [],
    low: [],
    info: [],
  };

  for (const v of result.vulnerabilities) {
    groups[v.severity].push(v);
  }

  return groups;
}

/**
 * Group vulnerabilities by package name
 */
export function groupByPackage(
  result: AuditResult
): Record<string, typeof result.vulnerabilities> {
  const groups: Record<string, typeof result.vulnerabilities> = {};

  for (const v of result.vulnerabilities) {
    if (!groups[v.packageName]) {
      groups[v.packageName] = [];
    }
    groups[v.packageName].push(v);
  }

  return groups;
}
