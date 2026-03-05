import { join } from 'node:path';
import type {
  Vulnerability,
  FixAction,
  FixSummary,
  Severity,
  ChangelogAnalysis,
  CatalogData,
} from '../types/index.js';
import { detectWorkspace } from '../core/workspace/detector.js';
import { runAudit, deduplicateVulnerabilities, groupBySeverity } from '../core/audit/index.js';
import { analyzeChangelog, getVersionChangeType } from '../core/changelog/index.js';
import {
  createDirectFixAction,
  applyUpgrade,
  applyResolution,
  getCurrentVersion,
} from '../core/resolver/direct.js';
import { createResolutionFix } from '../core/resolver/transitive.js';
import {
  showWelcome,
  showGoodbye,
  withSpinner,
  promptVulnerabilityAction,
  promptAutoApplyPatches,
  displayVulnerabilitySummary,
  info,
  success,
  warn,
  error,
} from '../ui/index.js';
import { displayFixSummary, displayMajorVersionChanges } from '../ui/reporter.js';

interface FixOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

/**
 * Main fix command implementation
 */
export async function runFixCommand(
  targetPath: string,
  options: FixOptions = {}
): Promise<void> {
  showWelcome();
  
  const summary: FixSummary = {
    startTime: new Date(),
    endTime: new Date(),
    packagesScanned: 0,
    vulnerabilitiesFound: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
    actionsApplied: { upgrades: [], resolutions: [], skipped: [] },
    errors: [],
  };

  try {
    // Detect workspace and package manager
    const workspace = await withSpinner('Detecting workspace configuration', async () => {
      return detectWorkspace(targetPath);
    });

    info(`Package manager: ${workspace.packageManager}`);
    info(`Monorepo: ${workspace.isMonorepo ? 'Yes' : 'No'}`);
    info(`Packages found: ${workspace.packages.length}`);
    
    summary.packagesScanned = workspace.packages.length;

    // Run audit
    const auditResult = await withSpinner('Running security audit', async () => {
      return runAudit(workspace.packageManager, workspace.rootPath);
    });

    // Deduplicate vulnerabilities
    const dedupedResult = deduplicateVulnerabilities(auditResult);
    
    // Update summary counts
    summary.vulnerabilitiesFound = { ...dedupedResult.metadata.vulnerabilityCounts };
    
    // Display summary
    displayVulnerabilitySummary(dedupedResult.metadata.vulnerabilityCounts);

    if (dedupedResult.vulnerabilities.length === 0) {
      success('No vulnerabilities found!');
      summary.endTime = new Date();
      displayFixSummary(summary);
      showGoodbye();
      return;
    }

    // Group by severity for processing
    const grouped = groupBySeverity(dedupedResult);
    
    // Separate direct and transitive vulnerabilities
    const directVulns = dedupedResult.vulnerabilities.filter((v) => v.isDirect);
    const transitiveVulns = dedupedResult.vulnerabilities.filter((v) => !v.isDirect);

    // Process patch-level fixes first (can be auto-applied)
    const patchFixes: { vuln: Vulnerability; action: FixAction }[] = [];
    const reviewFixes: { vuln: Vulnerability; action: FixAction; changelog?: ChangelogAnalysis }[] = [];

    // Analyze all vulnerabilities and categorize
    await withSpinner('Analyzing fix options', async () => {
      for (const vuln of directVulns) {
        const action = await createDirectFixAction(vuln);
        
        if (action.type === 'skip') {
          reviewFixes.push({ vuln, action });
          continue;
        }

        if (action.versionChangeType === 'patch') {
          patchFixes.push({ vuln, action });
        } else {
          // Fetch changelog for minor/major changes
          let changelog: ChangelogAnalysis | undefined;
          
          if (action.targetVersion && vuln.currentVersion !== 'unknown') {
            try {
              changelog = await analyzeChangelog(
                vuln.packageName,
                vuln.currentVersion,
                action.targetVersion
              );
            } catch {
              // Changelog fetch failed, proceed without it
            }
          }
          
          reviewFixes.push({ vuln, action, changelog });
        }
      }

      // Process transitive vulnerabilities
      for (const vuln of transitiveVulns) {
        const action = await createResolutionFix(
          vuln,
          workspace.rootPath,
          workspace.packageManager,
          workspace.catalogs
        );

        if (action.type === 'skip') {
          reviewFixes.push({ vuln, action });
        } else if (action.versionChangeType === 'patch') {
          patchFixes.push({ vuln, action });
        } else {
          reviewFixes.push({ vuln, action });
        }
      }
    });

    // Auto-apply patches if user agrees
    if (patchFixes.length > 0) {
      const autoApply = await promptAutoApplyPatches(patchFixes.length);
      
      if (autoApply) {
        for (const { action } of patchFixes) {
          if (options.dryRun) {
            info(`[DRY RUN] Would apply: ${action.reason}`);
          } else {
            try {
              applyFixAction(action, workspace.rootPath, workspace.packageManager, workspace.catalogs);
              summary.actionsApplied.upgrades.push(action);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              summary.errors.push(`Failed to apply ${action.packageName}: ${message}`);
            }
          }
        }
        success(`Applied ${patchFixes.length} patch-level fixes`);
      } else {
        // Add patches to review queue
        reviewFixes.push(...patchFixes.map((p) => ({ vuln: p.vuln, action: p.action })));
      }
    }

    // Process remaining vulnerabilities interactively
    // Sort by severity (critical first)
    const severityOrder: Severity[] = ['critical', 'high', 'moderate', 'low', 'info'];
    reviewFixes.sort((a, b) => {
      return severityOrder.indexOf(a.vuln.severity) - severityOrder.indexOf(b.vuln.severity);
    });

    let skipAll = false;
    
    for (const { vuln, action, changelog } of reviewFixes) {
      if (skipAll) {
        summary.actionsApplied.skipped.push({
          ...action,
          reason: 'User skipped all remaining',
        });
        continue;
      }

      const userChoice = await promptVulnerabilityAction(vuln, action, changelog);

      switch (userChoice) {
        case 'apply':
          if (options.dryRun) {
            info(`[DRY RUN] Would apply: ${action.reason}`);
            summary.actionsApplied.upgrades.push(action);
          } else {
            try {
              applyFixAction(action, workspace.rootPath, workspace.packageManager, workspace.catalogs);

              if (action.type === 'upgrade') {
                summary.actionsApplied.upgrades.push(action);
              } else if (action.type === 'resolution') {
                summary.actionsApplied.resolutions.push(action);
              }
              
              success(`Applied fix for ${action.packageName}`);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              error(`Failed to apply fix: ${message}`);
              summary.errors.push(`${action.packageName}: ${message}`);
            }
          }
          break;
          
        case 'skip':
          summary.actionsApplied.skipped.push({
            ...action,
            reason: 'User skipped',
          });
          break;
          
        case 'skip-all':
          skipAll = true;
          summary.actionsApplied.skipped.push({
            ...action,
            reason: 'User skipped all remaining',
          });
          break;
      }
    }

    // Finalize summary
    summary.endTime = new Date();

    // Display summary
    displayFixSummary(summary);

    // Highlight major version changes
    displayMajorVersionChanges([
      ...summary.actionsApplied.upgrades,
      ...summary.actionsApplied.resolutions,
    ]);

    // Remind to install dependencies if changes were made
    const hasChanges = summary.actionsApplied.upgrades.length > 0 ||
                       summary.actionsApplied.resolutions.length > 0;
    
    if (hasChanges && !options.dryRun) {
      warn(`Run '${workspace.packageManager} install' to install updated dependencies`);
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Fix command failed: ${message}`);
    summary.errors.push(message);
    summary.endTime = new Date();
    displayFixSummary(summary);
  }

  showGoodbye();
}

/**
 * Apply a fix action to the project
 */
function applyFixAction(
  action: FixAction,
  rootPath: string,
  packageManager: 'npm' | 'yarn' | 'pnpm',
  catalogs?: CatalogData
): void {
  if (!action.targetVersion) {
    throw new Error('No target version specified');
  }

  const packageJsonPath = join(rootPath, 'package.json');

  if (action.type === 'upgrade') {
    applyUpgrade(packageJsonPath, action.packageName, action.targetVersion, {
      catalogs,
      rootPath,
    });
  } else if (action.type === 'resolution') {
    applyResolution(packageJsonPath, action.packageName, action.targetVersion, packageManager);
  }
}
