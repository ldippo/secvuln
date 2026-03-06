import { join } from 'node:path';
import { detectWorkspace } from '../core/workspace/detector.js';
import { getExistingResolutions, removeResolutions } from '../core/resolver/transitive.js';
import { auditResolutions } from '../core/resolver/audit-resolutions.js';
import { applyResolutions } from '../core/resolver/transitive.js';
import {
  showWelcome,
  showGoodbye,
  withSpinner,
  confirmAction,
  info,
  success,
  warn,
} from '../ui/index.js';
import { displayResolutionAuditReport } from '../ui/reporter.js';

interface AuditResolutionsOptions {
  fix?: boolean;
  verbose?: boolean;
  json?: boolean;
  silent?: boolean;
}

/**
 * Audit existing resolutions/overrides and classify them as needed, removable, stale, or unknown.
 */
export async function runAuditResolutionsCommand(
  targetPath: string,
  options: AuditResolutionsOptions = {}
): Promise<void> {
  if (!options.silent) showWelcome();

  try {
    const workspace = await withSpinner('Detecting workspace configuration', async () => {
      return detectWorkspace(targetPath);
    });

    info(`Package manager: ${workspace.packageManager}`);

    const packageJsonPath = join(workspace.rootPath, 'package.json');
    const existing = getExistingResolutions(packageJsonPath, workspace.packageManager);
    const resolutionCount = Object.keys(existing).length;

    if (resolutionCount === 0) {
      info('No resolutions/overrides found. Nothing to audit.');
      if (!options.silent) showGoodbye();
      return;
    }

    info(`Found ${resolutionCount} resolution(s) to audit`);

    const result = await withSpinner('Auditing resolutions', async () => {
      return auditResolutions(workspace.rootPath, workspace.packageManager, workspace.catalogs);
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    displayResolutionAuditReport(result, options.verbose);

    // Interactive fix mode
    if (options.fix) {
      const removable = result.entries.filter((e) => e.status === 'removable');
      const stale = result.entries.filter((e) => e.status === 'stale');

      if (removable.length > 0) {
        const shouldRemove = await confirmAction(
          `Remove ${removable.length} unnecessary resolution(s)?`
        );

        if (shouldRemove) {
          removeResolutions(
            packageJsonPath,
            removable.map((e) => e.packageName),
            workspace.packageManager
          );
          success(`Removed ${removable.length} resolution(s)`);
        }
      }

      if (stale.length > 0) {
        const updatable = stale.filter((e) => e.suggestedVersion);
        if (updatable.length > 0) {
          const shouldUpdate = await confirmAction(
            `Update ${updatable.length} stale resolution(s) to newer versions?`
          );

          if (shouldUpdate) {
            const updates: Record<string, string> = {};
            for (const entry of updatable) {
              if (entry.suggestedVersion) {
                updates[entry.packageName] = entry.suggestedVersion;
              }
            }
            applyResolutions(packageJsonPath, updates, workspace.packageManager, {
              catalogs: workspace.catalogs,
              rootPath: workspace.rootPath,
            });
            success(`Updated ${updatable.length} resolution(s)`);
          }
        }
      }

      const hasChanges = removable.length > 0 || stale.filter((e) => e.suggestedVersion).length > 0;
      if (hasChanges) {
        warn(`Run '${workspace.packageManager} install' to apply changes`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Audit-resolutions command failed: ${message}`);
  }

  if (!options.silent) showGoodbye();
}
