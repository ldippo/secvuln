import { runFixCommand } from './fix.js';
import { runTestsCommand } from './test.js';
import { runAuditResolutionsCommand } from './audit-resolutions.js';
import { detectWorkspace } from '../core/workspace/detector.js';
import { runAudit, deduplicateVulnerabilities } from '../core/audit/index.js';
import { runInstall } from '../core/package-manager.js';
import {
  showWelcome,
  showGoodbye,
  withSpinner,
  confirmAction,
  displayVulnerabilitySummary,
  info,
  success,
  warn,
  error,
} from '../ui/index.js';

interface FixAllOptions {
  dryRun?: boolean;
  verbose?: boolean;
  maxRounds?: number;
}

const DEFAULT_MAX_ROUNDS = 5;

/**
 * Comprehensive fix command that iterates: fix -> install -> re-audit
 * until the project is clean, then optionally runs tests and audit-resolutions.
 */
export async function runFixAllCommand(
  targetPath: string,
  options: FixAllOptions = {}
): Promise<void> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;

  showWelcome();

  try {
    const workspace = await withSpinner('Detecting workspace configuration', async () => {
      return detectWorkspace(targetPath);
    });

    info(`Package manager: ${workspace.packageManager}`);
    info(`Monorepo: ${workspace.isMonorepo ? 'Yes' : 'No'}`);

    let round = 0;
    let anyChangesOverall = false;

    while (round < maxRounds) {
      round++;

      if (round > 1) {
        console.log('');
        info(`--- Round ${round} ---`);
      }

      // Step 1: Run fix
      const fixResult = await runFixCommand(targetPath, {
        dryRun: options.dryRun,
        verbose: options.verbose,
        silent: true,
      });

      if (fixResult.hasChanges) {
        anyChangesOverall = true;
      }

      if (!fixResult.hasChanges) {
        if (round === 1) {
          info('No changes were applied.');
        } else {
          info('No additional changes applied this round.');
        }
        break;
      }

      if (options.dryRun) {
        info('Dry run complete — skipping install and re-audit.');
        break;
      }

      // Step 2: Install dependencies
      const installResult = await withSpinner(
        `Running ${workspace.packageManager} install`,
        () => runInstall(workspace.packageManager, workspace.rootPath)
      );

      if (!installResult.success) {
        error('Dependency installation failed.');
        if (options.verbose) {
          console.log(installResult.output);
        }
        const proceed = await confirmAction('Continue anyway?');
        if (!proceed) break;
      }

      // Step 3: Re-audit
      const auditResult = await withSpinner('Re-auditing for new vulnerabilities', async () => {
        return runAudit(workspace.packageManager, workspace.rootPath);
      });

      const deduped = deduplicateVulnerabilities(auditResult);
      const remaining = deduped.vulnerabilities.length;

      displayVulnerabilitySummary(deduped.metadata.vulnerabilityCounts);

      if (remaining === 0) {
        success('All vulnerabilities resolved!');
        break;
      }

      info(`${remaining} vulnerabilities remaining.`);

      if (round >= maxRounds) {
        warn(`Reached maximum of ${maxRounds} rounds. ${remaining} vulnerabilities remain.`);
        break;
      }

      // Step 4: Prompt for another round
      const continueFixing = await confirmAction('Run another fix round?');
      if (!continueFixing) break;
    }

    // Step 5: Optionally run tests
    if (anyChangesOverall && !options.dryRun) {
      console.log('');
      const runTests = await confirmAction('Run tests to verify changes?');
      if (runTests) {
        await runTestsCommand(targetPath, {
          verbose: options.verbose,
          silent: true,
        });
      }
    }

    // Step 6: Optionally audit resolutions
    if (anyChangesOverall && !options.dryRun) {
      const auditRes = await confirmAction('Audit existing resolutions/overrides for staleness?');
      if (auditRes) {
        await runAuditResolutionsCommand(targetPath, {
          fix: true,
          verbose: options.verbose,
          silent: true,
        });
      }
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(`fix-all failed: ${message}`);
  }

  showGoodbye();
}
