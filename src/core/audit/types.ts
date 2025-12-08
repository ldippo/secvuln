import type { AuditResult, Vulnerability, Severity, PackageManager } from '../../types/index.js';

/**
 * Shared types for raw audit output parsing
 */

// NPM audit JSON structures
export interface NpmAuditOutput {
  auditReportVersion?: number;
  vulnerabilities?: Record<string, NpmVulnerability>;
  metadata?: {
    vulnerabilities: Record<string, number>;
    dependencies: {
      prod: number;
      dev: number;
      optional: number;
      peer: number;
      total: number;
    };
  };
}

export interface NpmVulnerability {
  name: string;
  severity: string;
  isDirect: boolean;
  via: Array<string | NpmVulnVia>;
  effects: string[];
  range: string;
  nodes: string[];
  fixAvailable: boolean | NpmFixAvailable;
}

export interface NpmVulnVia {
  source: number;
  name: string;
  dependency: string;
  title: string;
  url: string;
  severity: string;
  cwe: string[];
  cvss: { score: number; vectorString: string };
  range: string;
}

export interface NpmFixAvailable {
  name: string;
  version: string;
  isSemVerMajor: boolean;
}

// Yarn audit JSON structures (JSON lines format)
export interface YarnAuditLine {
  type: 'auditAdvisory' | 'auditSummary';
  data: YarnAuditAdvisory | YarnAuditSummary;
}

export interface YarnAuditAdvisory {
  resolution: {
    id: number;
    path: string;
    dev: boolean;
    optional: boolean;
    bundled: boolean;
  };
  advisory: {
    id: number;
    title: string;
    module_name: string;
    severity: string;
    url: string;
    vulnerable_versions: string;
    patched_versions: string;
    cwe: string[];
    cvss: { score: number; vectorString: string };
    findings: Array<{
      version: string;
      paths: string[];
    }>;
  };
}

export interface YarnAuditSummary {
  vulnerabilities: Record<string, number>;
  dependencies: number;
  devDependencies: number;
  optionalDependencies: number;
  totalDependencies: number;
}

// pnpm audit JSON structures
export interface PnpmAuditOutput {
  advisories: Record<string, PnpmAdvisory>;
  metadata: {
    vulnerabilities: Record<string, number>;
    dependencies: number;
    devDependencies: number;
    totalDependencies: number;
  };
}

export interface PnpmAdvisory {
  id: number;
  title: string;
  module_name: string;
  severity: string;
  url: string;
  vulnerable_versions: string;
  patched_versions: string;
  cwe: string[];
  cvss: { score: number; vectorString: string };
  findings: Array<{
    version: string;
    paths: string[];
  }>;
}

/**
 * Normalize severity string to our Severity type
 */
export function normalizeSeverity(severity: string): Severity {
  const s = severity.toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high') return 'high';
  if (s === 'moderate' || s === 'medium') return 'moderate';
  if (s === 'low') return 'low';
  return 'info';
}

/**
 * Extract the current version from a dependency path
 */
export function extractVersionFromPath(path: string): string {
  // Path format is usually: package@version > child@version > ...
  const match = path.match(/@([^@>]+)(?:$|>)/);
  return match ? match[1].trim() : 'unknown';
}

/**
 * Parse the dependency path into an array
 */
export function parseDependencyPath(path: string): string[] {
  return path.split('>').map((p) => p.trim());
}

/**
 * Check if a dependency is direct (appears in package.json)
 */
export function isDirect(path: string): boolean {
  const parts = parseDependencyPath(path);
  return parts.length === 1;
}

/**
 * Get the root (direct) dependency from a path
 */
export function getRootDependency(path: string): string | null {
  const parts = parseDependencyPath(path);
  if (parts.length <= 1) return null;
  // Extract package name without version
  const root = parts[0];
  return root.replace(/@[\d.]+.*$/, '').replace(/@$/, '');
}

/**
 * Create an empty audit result
 */
export function createEmptyAuditResult(pm: PackageManager): AuditResult {
  return {
    packageManager: pm,
    vulnerabilities: [],
    metadata: {
      totalDependencies: 0,
      vulnerabilityCounts: {
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0,
        info: 0,
      },
    },
  };
}
