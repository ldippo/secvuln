import * as semver from 'semver';
import type { ChangelogAnalysis, ChangelogEntry } from '../../types/index.js';
import {
  fetchGitHubReleases,
  extractBreakingChanges,
  hasBreakingChangeIndicators,
} from './github.js';

/**
 * Analyze changelog between two versions
 */
export async function analyzeChangelog(
  packageName: string,
  fromVersion: string,
  toVersion: string
): Promise<ChangelogAnalysis> {
console.log(`Analyzing changelog for ${packageName} from ${fromVersion} to ${toVersion}...`);
  const entries = await fetchGitHubReleases(packageName, fromVersion, toVersion);
  
  const hasBreakingChanges = entries.some((e) => e.isBreaking);
  
  return {
    packageName,
    fromVersion,
    toVersion,
    entries,
    hasBreakingChanges,
    summary: generateSummary(entries, fromVersion, toVersion),
  };
}

/**
 * Generate a human-readable summary of changes
 */
function generateSummary(
  entries: ChangelogEntry[],
  fromVersion: string,
  toVersion: string
): string {
  if (entries.length === 0) {
    return `No changelog entries found between ${fromVersion} and ${toVersion}. Check the package's GitHub releases manually.`;
  }

  const breakingCount = entries.filter((e) => e.isBreaking).length;
  
  let summary = `Found ${entries.length} release(s) between ${fromVersion} and ${toVersion}.\n`;
  
  if (breakingCount > 0) {
    summary += `\n⚠️  ${breakingCount} release(s) contain breaking changes:\n`;
    
    for (const entry of entries.filter((e) => e.isBreaking)) {
      summary += `\n  ${entry.version}:\n`;
      for (const change of entry.breakingChanges) {
        summary += `    - ${change}\n`;
      }
    }
  } else {
    summary += '\n✓ No breaking changes detected in release notes.';
  }
  
  return summary;
}

/**
 * Determine the type of version change
 */
export function getVersionChangeType(
  fromVersion: string,
  toVersion: string
): 'major' | 'minor' | 'patch' | 'none' {
  const from = semver.parse(fromVersion);
  const to = semver.parse(toVersion);
  
  if (!from || !to) return 'none';
  
  if (to.major > from.major) return 'major';
  if (to.minor > from.minor) return 'minor';
  if (to.patch > from.patch) return 'patch';
  
  return 'none';
}

/**
 * Quick check if upgrade is likely safe based on semver
 */
export function isLikelySafeUpgrade(
  fromVersion: string,
  toVersion: string
): boolean {
  const changeType = getVersionChangeType(fromVersion, toVersion);
  return changeType === 'patch';
}

/**
 * Get upgrade risk level
 */
export function getUpgradeRisk(
  analysis: ChangelogAnalysis
): 'low' | 'medium' | 'high' {
  const changeType = getVersionChangeType(analysis.fromVersion, analysis.toVersion);
  
  if (changeType === 'major' || analysis.hasBreakingChanges) {
    return 'high';
  }
  
  if (changeType === 'minor') {
    return 'medium';
  }
  
  return 'low';
}

/**
 * Format changelog for display
 */
export function formatChangelogForDisplay(
  analysis: ChangelogAnalysis,
  maxEntries: number = 5
): string {
  const lines: string[] = [];
  
  lines.push(`\n📦 ${analysis.packageName}: ${analysis.fromVersion} → ${analysis.toVersion}`);
  lines.push('─'.repeat(50));
  
  if (analysis.entries.length === 0) {
    lines.push('  No release notes available from GitHub.');
    lines.push('  Manual review recommended.');
    return lines.join('\n');
  }
  
  const risk = getUpgradeRisk(analysis);
  const riskEmoji = risk === 'high' ? '🔴' : risk === 'medium' ? '🟡' : '🟢';
  lines.push(`  Risk level: ${riskEmoji} ${risk.toUpperCase()}`);
  
  if (analysis.hasBreakingChanges) {
    lines.push('\n  ⚠️  BREAKING CHANGES DETECTED:');
    
    for (const entry of analysis.entries.filter((e) => e.isBreaking).slice(0, maxEntries)) {
      lines.push(`\n  Version ${entry.version}:`);
      for (const change of entry.breakingChanges) {
        lines.push(`    • ${change}`);
      }
    }
  }
  
  // Show recent releases
  const nonBreakingEntries = analysis.entries.filter((e) => !e.isBreaking);
  if (nonBreakingEntries.length > 0) {
    lines.push('\n  Recent releases:');
    for (const entry of nonBreakingEntries.slice(0, 3)) {
      const date = entry.date ? new Date(entry.date).toLocaleDateString() : 'unknown date';
      lines.push(`    • ${entry.version} (${date})`);
    }
  }
  
  if (analysis.entries.length > maxEntries) {
    lines.push(`\n  ... and ${analysis.entries.length - maxEntries} more releases`);
  }
  
  return lines.join('\n');
}
