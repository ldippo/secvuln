import pc from 'picocolors';
import type {
  FixSummary,
  Severity,
  FixAction,
  ResolutionAuditResult,
  ResolutionAuditEntry,
  ResolutionStatus,
  ParentDependencyInfo,
} from '../types/index.js';
import { formatSeverity, formatVersionChange } from './prompts.js';

/**
 * Generate and display a comprehensive fix summary
 */
export function displayFixSummary(summary: FixSummary): void {
  const duration = (summary.endTime.getTime() - summary.startTime.getTime()) / 1000;
  
  console.log('');
  console.log(pc.bold('═'.repeat(60)));
  console.log(pc.bold(pc.cyan('  FIX SUMMARY')));
  console.log(pc.bold('═'.repeat(60)));
  console.log('');
  
  // Packages scanned
  console.log(`  ${pc.dim('Packages scanned:')} ${summary.packagesScanned}`);
  console.log(`  ${pc.dim('Duration:')} ${duration.toFixed(1)}s`);
  console.log('');
  
  // Vulnerabilities found by severity
  console.log(pc.bold('  Vulnerabilities Found:'));
  const severities: Severity[] = ['critical', 'high', 'moderate', 'low', 'info'];
  for (const sev of severities) {
    const count = summary.vulnerabilitiesFound[sev];
    if (count > 0) {
      console.log(`    ${formatSeverity(sev)}: ${count}`);
    }
  }
  
  const totalVulns = Object.values(summary.vulnerabilitiesFound).reduce((a, b) => a + b, 0);
  console.log(`    ${pc.dim('Total:')} ${totalVulns}`);
  console.log('');
  
  // Actions taken
  console.log(pc.bold('  Actions Taken:'));
  
  // Upgrades
  if (summary.actionsApplied.upgrades.length > 0) {
    console.log(`    ${pc.green('✓')} Upgrades applied: ${summary.actionsApplied.upgrades.length}`);
    for (const action of summary.actionsApplied.upgrades) {
      console.log(`      • ${action.packageName}: ${action.currentVersion} → ${action.targetVersion} (${formatVersionChange(action.versionChangeType)})`);
    }
  }
  
  // Resolutions
  if (summary.actionsApplied.resolutions.length > 0) {
    console.log(`    ${pc.green('✓')} Resolutions added: ${summary.actionsApplied.resolutions.length}`);
    for (const action of summary.actionsApplied.resolutions) {
      console.log(`      • ${action.packageName}@${action.targetVersion}`);
    }
  }
  
  // Skipped
  if (summary.actionsApplied.skipped.length > 0) {
    console.log(`    ${pc.yellow('○')} Skipped: ${summary.actionsApplied.skipped.length}`);
    for (const action of summary.actionsApplied.skipped) {
      console.log(`      • ${action.packageName}: ${action.reason}`);
    }
  }
  
  // Errors
  if (summary.errors.length > 0) {
    console.log('');
    console.log(pc.bold(pc.red('  Errors:')));
    for (const err of summary.errors) {
      console.log(`    ${pc.red('✗')} ${err}`);
    }
  }
  
  console.log('');
  console.log(pc.bold('═'.repeat(60)));
  
  // Next steps
  const hasChanges = summary.actionsApplied.upgrades.length > 0 || 
                     summary.actionsApplied.resolutions.length > 0;
  
  if (hasChanges) {
    console.log('');
    console.log(pc.bold('  Next Steps:'));
    console.log(`    1. Run ${pc.cyan('secvuln test')} to verify changes`);
    console.log(`    2. Review any major version upgrades`);
    console.log(`    3. Commit changes if tests pass`);
    console.log('');
  }
}

/**
 * Display a summary grouped by severity
 */
export function displaySeveritySummary(
  actions: FixAction[],
  title: string
): void {
  const grouped: Record<Severity, FixAction[]> = {
    critical: [],
    high: [],
    moderate: [],
    low: [],
    info: [],
  };
  
  for (const action of actions) {
    grouped[action.vulnerability.severity].push(action);
  }
  
  console.log('');
  console.log(pc.bold(title));
  console.log('─'.repeat(50));
  
  const severities: Severity[] = ['critical', 'high', 'moderate', 'low', 'info'];
  
  for (const sev of severities) {
    const items = grouped[sev];
    if (items.length === 0) continue;
    
    console.log(`\n  ${formatSeverity(sev)} (${items.length}):`);
    
    for (const action of items) {
      const status = action.type === 'skip' 
        ? pc.yellow('○ SKIPPED')
        : pc.green('✓ FIXED');
      
      console.log(`    ${status} ${action.packageName}`);
      console.log(`      ${pc.dim(action.reason)}`);
    }
  }
  
  console.log('');
}

/**
 * Display major version changes that need attention
 */
export function displayMajorVersionChanges(actions: FixAction[]): void {
  const majorChanges = actions.filter(
    (a) => a.versionChangeType === 'major' && a.type === 'upgrade'
  );
  
  if (majorChanges.length === 0) return;
  
  console.log('');
  console.log(pc.bold(pc.red('⚠ Major Version Changes Applied:')));
  console.log(pc.dim('These changes may require code modifications'));
  console.log('─'.repeat(50));
  
  for (const action of majorChanges) {
    console.log(`\n  ${pc.bold(action.packageName)}`);
    console.log(`    ${action.currentVersion} → ${pc.red(action.targetVersion)}`);
    console.log(`    ${pc.dim('Severity:')} ${formatSeverity(action.vulnerability.severity)}`);
    console.log(`    ${pc.dim('Recommendation: Review changelog and update code as needed')}`);
  }
  
  console.log('');
}

/**
 * Format a table of actions for display
 */
export function formatActionsTable(actions: FixAction[]): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(pc.bold('Package'.padEnd(30) + 'Action'.padEnd(15) + 'Version Change'));
  lines.push('─'.repeat(65));

  for (const action of actions) {
    const pkg = action.packageName.slice(0, 28).padEnd(30);
    const act = action.type.toUpperCase().padEnd(15);
    const ver = action.targetVersion
      ? `${action.currentVersion} → ${action.targetVersion}`
      : 'N/A';

    lines.push(`${pkg}${act}${ver}`);
  }

  return lines.join('\n');
}

function formatStatus(status: ResolutionStatus): string {
  switch (status) {
    case 'removable':
      return pc.yellow('REMOVABLE');
    case 'stale':
      return pc.red('STALE');
    case 'needed':
      return pc.green('NEEDED');
    case 'unknown':
      return pc.dim('UNKNOWN');
  }
}

/**
 * Display parent dependency info for a resolution audit entry
 */
function displayParentDependencies(entry: ResolutionAuditEntry): void {
  if (entry.parentDependencies.length === 0) return;

  console.log(`      ${pc.dim('Depends on this via:')}`);

  for (const parent of entry.parentDependencies) {
    if (parent.targetVersion) {
      const changeLabel = formatVersionChange(parent.versionChangeType);
      const safetyIcon = parent.isSafe ? pc.green('✓') : pc.red('⚠');
      console.log(
        `        ${safetyIcon} ${pc.bold(parent.name)} ${parent.currentVersion} → ${parent.targetVersion} (${changeLabel})`
      );
      if (parent.isSafe) {
        console.log(
          `          ${pc.green('Safe to bump')} — override can be removed after upgrading`
        );
      } else {
        console.log(
          `          ${pc.red('Major version change')} — review changelog before upgrading`
        );
      }
    } else {
      console.log(
        `        ${pc.dim('•')} ${pc.bold(parent.name)}@${parent.currentVersion} ${pc.dim('— no newer version resolves this automatically')}`
      );
    }
  }
}

/**
 * Display a resolution audit report grouped by status
 */
export function displayResolutionAuditReport(
  result: ResolutionAuditResult,
  verbose?: boolean
): void {
  console.log('');
  console.log(pc.bold('═'.repeat(60)));
  console.log(pc.bold(pc.cyan('  RESOLUTION AUDIT')));
  console.log(pc.bold('═'.repeat(60)));
  console.log('');

  // Summary counts
  console.log(pc.bold('  Summary:'));
  console.log(`    Total resolutions: ${result.totalResolutions}`);
  if (result.counts.removable > 0) {
    console.log(`    ${pc.yellow('Removable:')} ${result.counts.removable}`);
  }
  if (result.counts.stale > 0) {
    console.log(`    ${pc.red('Stale:')} ${result.counts.stale}`);
  }
  if (result.counts.needed > 0) {
    console.log(`    ${pc.green('Needed:')} ${result.counts.needed}`);
  }
  if (result.counts.unknown > 0) {
    console.log(`    ${pc.dim('Unknown:')} ${result.counts.unknown}`);
  }
  console.log('');

  // Group entries by status
  const groups: [ResolutionStatus, string][] = [
    ['removable', 'Removable Resolutions'],
    ['stale', 'Stale Resolutions'],
    ['needed', 'Needed Resolutions'],
    ['unknown', 'Unknown Resolutions'],
  ];

  for (const [status, title] of groups) {
    const items = result.entries.filter((e) => e.status === status);
    if (items.length === 0) continue;

    console.log(`  ${pc.bold(title)} (${items.length}):`);
    console.log('  ' + '─'.repeat(50));

    for (const entry of items) {
      console.log(`    ${formatStatus(entry.status)} ${pc.bold(entry.packageName)}@${entry.overrideVersion}`);
      console.log(`      ${pc.dim(entry.reason)}`);
      if (verbose && entry.suggestedVersion) {
        console.log(`      ${pc.cyan('Suggested:')} ${entry.suggestedVersion}`);
      }
      displayParentDependencies(entry);
    }
    console.log('');
  }

  console.log(pc.bold('═'.repeat(60)));
}
