import * as p from '@clack/prompts';
import pc from 'picocolors';
import type {
  Vulnerability,
  FixAction,
  Severity,
  ChangelogAnalysis,
  TestCommand,
} from '../types/index.js';
import { formatChangelogForDisplay, getUpgradeRisk } from '../core/changelog/index.js';

/**
 * Display welcome message
 */
export function showWelcome(): void {
  p.intro(pc.bgCyan(pc.black(' secvuln - Security Vulnerability Remediation ')));
}

/**
 * Display goodbye message
 */
export function showGoodbye(): void {
  p.outro(pc.green('Done! Remember to run tests to verify changes.'));
}

/**
 * Show a spinner while an async operation runs
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>
): Promise<T> {
  const spinner = p.spinner();
  spinner.start(message);
  try {
    const result = await fn();
    spinner.stop(pc.green('✓ ') + message);
    return result;
  } catch (error) {
    spinner.stop(pc.red('✗ ') + message);
    throw error;
  }
}

/**
 * Prompt for confirmation
 */
export async function confirmAction(message: string): Promise<boolean> {
  const result = await p.confirm({
    message,
    initialValue: true,
  });
  
  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }
  
  return result;
}

/**
 * Format severity with color
 */
export function formatSeverity(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return pc.bgRed(pc.white(' CRITICAL '));
    case 'high':
      return pc.red('HIGH');
    case 'moderate':
      return pc.yellow('MODERATE');
    case 'low':
      return pc.blue('LOW');
    case 'info':
      return pc.gray('INFO');
  }
}

/**
 * Format version change type with color
 */
export function formatVersionChange(type: string): string {
  switch (type) {
    case 'major':
      return pc.red('MAJOR');
    case 'minor':
      return pc.yellow('MINOR');
    case 'patch':
      return pc.green('PATCH');
    default:
      return pc.gray('N/A');
  }
}

/**
 * Display vulnerability details
 */
export function displayVulnerability(vuln: Vulnerability): void {
  const lines = [
    '',
    `${formatSeverity(vuln.severity)} ${pc.bold(vuln.title)}`,
    `  Package: ${pc.cyan(vuln.packageName)}@${vuln.currentVersion}`,
    `  Vulnerable: ${pc.red(vuln.vulnerableVersions)}`,
    `  Patched: ${vuln.patchedVersions ? pc.green(vuln.patchedVersions) : pc.gray('None')}`,
  ];

  if (vuln.url) {
    lines.push(`  More info: ${pc.dim(vuln.url)}`);
  }

  if (!vuln.isDirect) {
    lines.push(`  ${pc.dim('Transitive dependency via:')} ${vuln.rootDependency || 'unknown'}`);
  }

  console.log(lines.join('\n'));
}

/**
 * Prompt user to select action for a vulnerability
 */
export async function promptVulnerabilityAction(
  vuln: Vulnerability,
  suggestedAction: FixAction,
  changelog?: ChangelogAnalysis
): Promise<'apply' | 'skip' | 'skip-all'> {
  displayVulnerability(vuln);

  // Show changelog if available
  if (changelog) {
    console.log(formatChangelogForDisplay(changelog));
  }

  // Show suggested action
  console.log('');
  if (suggestedAction.type === 'skip') {
    console.log(pc.yellow(`⚠ No fix available: ${suggestedAction.reason}`));
    
    const result = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'skip', label: 'Skip this vulnerability' },
        { value: 'skip-all', label: 'Skip all remaining vulnerabilities' },
      ],
    });

    if (p.isCancel(result)) {
      p.cancel('Operation cancelled');
      process.exit(0);
    }

    return result as 'skip' | 'skip-all';
  }

  const actionLabel = suggestedAction.type === 'upgrade'
    ? `Upgrade ${suggestedAction.packageName} to ${suggestedAction.targetVersion}`
    : `Add resolution for ${suggestedAction.packageName}@${suggestedAction.targetVersion}`;

  const versionWarning = suggestedAction.versionChangeType === 'major'
    ? pc.red(' ⚠ Major version change - review changelog above')
    : '';

  const result = await p.select({
    message: `Suggested: ${actionLabel}${versionWarning}`,
    options: [
      {
        value: 'apply',
        label: `Apply fix (${formatVersionChange(suggestedAction.versionChangeType)} change)`,
        hint: suggestedAction.reason,
      },
      { value: 'skip', label: 'Skip this vulnerability' },
      { value: 'skip-all', label: 'Skip all remaining vulnerabilities' },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result as 'apply' | 'skip' | 'skip-all';
}

/**
 * Prompt for auto-applying patches
 */
export async function promptAutoApplyPatches(count: number): Promise<boolean> {
  const result = await p.confirm({
    message: `Found ${count} patch-level fixes. Auto-apply all patch fixes?`,
    initialValue: true,
  });

  if (p.isCancel(result)) {
    return false;
  }

  return result;
}

/**
 * Prompt user to select test commands to run
 */
export async function promptTestCommands(
  commands: TestCommand[]
): Promise<TestCommand[]> {
  if (commands.length === 0) {
    p.log.warn('No test commands found in package.json scripts');
    return [];
  }

  const options = commands.map((cmd) => ({
    value: cmd.name,
    label: `${cmd.name} (${cmd.packageName})`,
    hint: cmd.script,
  }));

  const selected = await p.multiselect({
    message: 'Select commands to run for verification:',
    options,
    required: false,
  });

  if (p.isCancel(selected)) {
    return [];
  }

  return commands.filter((cmd) => (selected as string[]).includes(cmd.name));
}

/**
 * Display a grouped summary of vulnerabilities
 */
export function displayVulnerabilitySummary(
  counts: Record<Severity, number>
): void {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  
  if (total === 0) {
    p.log.success('No vulnerabilities found!');
    return;
  }

  console.log('');
  console.log(pc.bold('Vulnerability Summary:'));
  console.log('─'.repeat(40));
  
  if (counts.critical > 0) {
    console.log(`  ${formatSeverity('critical')} ${counts.critical}`);
  }
  if (counts.high > 0) {
    console.log(`  ${formatSeverity('high')}: ${counts.high}`);
  }
  if (counts.moderate > 0) {
    console.log(`  ${formatSeverity('moderate')}: ${counts.moderate}`);
  }
  if (counts.low > 0) {
    console.log(`  ${formatSeverity('low')}: ${counts.low}`);
  }
  if (counts.info > 0) {
    console.log(`  ${formatSeverity('info')}: ${counts.info}`);
  }
  
  console.log('─'.repeat(40));
  console.log(`  Total: ${total} vulnerabilities`);
  console.log('');
}

/**
 * Display info message
 */
export function info(message: string): void {
  p.log.info(message);
}

/**
 * Display success message
 */
export function success(message: string): void {
  p.log.success(message);
}

/**
 * Display warning message
 */
export function warn(message: string): void {
  p.log.warn(message);
}

/**
 * Display error message
 */
export function error(message: string): void {
  p.log.error(message);
}
