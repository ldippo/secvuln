/**
 * Core types for the secvuln CLI tool
 */

// Severity levels for vulnerabilities
export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

// Package managers supported
export type PackageManager = 'npm' | 'yarn' | 'pnpm';

// Version change type based on semver
export type VersionChangeType = 'major' | 'minor' | 'patch' | 'none';

// Vulnerability information normalized across package managers
export interface Vulnerability {
  id: string;
  title: string;
  severity: Severity;
  packageName: string;
  currentVersion: string;
  vulnerableVersions: string;
  patchedVersions: string | null;
  recommendation: string | null;
  url: string | null;
  cwe: string[];
  cvss: number | null;
  // Path through dependency tree
  dependencyPath: string[];
  // Whether this is a direct or transitive dependency
  isDirect: boolean;
  // The direct dependency that brings this in (if transitive)
  rootDependency: string | null;
}

// Audit result from running npm/yarn/pnpm audit
export interface AuditResult {
  packageManager: PackageManager;
  vulnerabilities: Vulnerability[];
  metadata: {
    totalDependencies: number;
    vulnerabilityCounts: Record<Severity, number>;
  };
}

// Fix action to be applied
export interface FixAction {
  type: 'upgrade' | 'resolution' | 'skip';
  packageName: string;
  currentVersion: string;
  targetVersion: string | null;
  versionChangeType: VersionChangeType;
  vulnerability: Vulnerability;
  // For resolutions/overrides
  resolutionPath?: string;
  // Info about a major parent bump that could fix a transitive vuln
  majorParentBump?: {
    parentPackage: string;
    targetVersion: string;
  };
  // Reason for the action (e.g., user skipped, auto-applied patch)
  reason: string;
}

// Result of applying fixes
export interface FixResult {
  action: FixAction;
  success: boolean;
  error?: string;
}

// Changelog entry from GitHub releases
export interface ChangelogEntry {
  version: string;
  date: string | null;
  body: string;
  url: string;
  isBreaking: boolean;
  breakingChanges: string[];
}

// Changelog analysis result
export interface ChangelogAnalysis {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  entries: ChangelogEntry[];
  hasBreakingChanges: boolean;
  summary: string;
}

// Workspace package information
export interface WorkspacePackage {
  name: string;
  path: string;
  packageJsonPath: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

// Catalog data from pnpm-workspace.yaml
export interface CatalogData {
  default: Record<string, string>;
  named: Record<string, Record<string, string>>;
}

// Workspace detection result
export interface WorkspaceInfo {
  isMonorepo: boolean;
  rootPath: string;
  packages: WorkspacePackage[];
  packageManager: PackageManager;
  catalogs?: CatalogData;
}

// Test command found in package.json scripts
export interface TestCommand {
  name: string;
  script: string;
  packagePath: string;
  packageName: string;
}

// Test execution result
export interface TestResult {
  command: TestCommand;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

// Resolution audit status classification
export type ResolutionStatus = 'needed' | 'removable' | 'stale' | 'unknown';

// Parent dependency that pulls in an overridden transitive package
export interface ParentDependencyInfo {
  name: string;
  currentVersion: string;
  targetVersion: string | null;
  versionChangeType: VersionChangeType;
  isSafe: boolean;
}

// Single entry from resolution audit
export interface ResolutionAuditEntry {
  packageName: string;
  overrideVersion: string;
  status: ResolutionStatus;
  reason: string;
  suggestedVersion: string | null;
  parentDependencies: ParentDependencyInfo[];
}

// Full result of auditing all resolutions
export interface ResolutionAuditResult {
  packageManager: PackageManager;
  rootPath: string;
  totalResolutions: number;
  entries: ResolutionAuditEntry[];
  counts: Record<ResolutionStatus, number>;
}

// Summary of all actions taken during a fix session
export interface FixSummary {
  startTime: Date;
  endTime: Date;
  packagesScanned: number;
  vulnerabilitiesFound: Record<Severity, number>;
  actionsApplied: {
    upgrades: FixAction[];
    resolutions: FixAction[];
    skipped: FixAction[];
  };
  errors: string[];
}
