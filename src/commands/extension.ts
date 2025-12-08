import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ExtensionVulnerabilitySummary } from '../core/vscode/index.js';
import {
  getInstalledExtensions,
  fetchExtensionInfo,
  checkExtension,
} from '../core/vscode/index.js';
import {
  showWelcome,
  showGoodbye,
  withSpinner,
  info,
  success,
  warn,
  error,
  formatSeverity,
} from '../ui/index.js';

interface ExtensionOptions {
  extension?: string;
  all?: boolean;
  verbose?: boolean;
}

/**
 * Display extension vulnerability summary
 */
function displayExtensionSummary(summary: ExtensionVulnerabilitySummary): void {
  const ext = summary.extension;
  
  console.log('');
  console.log(pc.bold('─'.repeat(60)));
  console.log(pc.bold(`  ${ext.displayName}`));
  console.log(pc.dim(`  ${ext.publisher}.${ext.name} v${ext.version}`));
  console.log(pc.bold('─'.repeat(60)));
  
  if (ext.description) {
    console.log(`  ${pc.dim(ext.description.slice(0, 80))}${ext.description.length > 80 ? '...' : ''}`);
  }
  
  if (ext.repository) {
    console.log(`  ${pc.dim('Repository:')} ${ext.repository}`);
  }
  
  console.log('');

  if (summary.error) {
    console.log(`  ${pc.yellow('⚠')} ${summary.error}`);
    return;
  }

  if (!summary.repositoryFound) {
    console.log(`  ${pc.yellow('⚠')} No GitHub repository found`);
    return;
  }

  if (!summary.auditRan) {
    console.log(`  ${pc.yellow('⚠')} Could not run security audit`);
    return;
  }

  const vulns = summary.vulnerabilities;
  
  if (vulns.total === 0) {
    console.log(`  ${pc.green('✓')} No known vulnerabilities found`);
    return;
  }

  console.log(`  ${pc.red('⚠')} Found ${vulns.total} vulnerabilities:`);
  console.log('');
  
  if (vulns.bySeverity.critical > 0) {
    console.log(`    ${formatSeverity('critical')} ${vulns.bySeverity.critical}`);
  }
  if (vulns.bySeverity.high > 0) {
    console.log(`    ${formatSeverity('high')}: ${vulns.bySeverity.high}`);
  }
  if (vulns.bySeverity.moderate > 0) {
    console.log(`    ${formatSeverity('moderate')}: ${vulns.bySeverity.moderate}`);
  }
  if (vulns.bySeverity.low > 0) {
    console.log(`    ${formatSeverity('low')}: ${vulns.bySeverity.low}`);
  }
  if (vulns.bySeverity.info > 0) {
    console.log(`    ${formatSeverity('info')}: ${vulns.bySeverity.info}`);
  }
}

/**
 * Display overall summary
 */
function displayOverallSummary(results: ExtensionVulnerabilitySummary[]): void {
  console.log('');
  console.log(pc.bold('═'.repeat(60)));
  console.log(pc.bold(pc.cyan('  EXTENSION SECURITY SUMMARY')));
  console.log(pc.bold('═'.repeat(60)));
  console.log('');

  const checked = results.length;
  const withRepo = results.filter((r) => r.repositoryFound).length;
  const withVulns = results.filter((r) => r.vulnerabilities.total > 0).length;
  const clean = results.filter((r) => r.auditRan && r.vulnerabilities.total === 0).length;

  console.log(`  Extensions checked: ${checked}`);
  console.log(`  With GitHub repository: ${withRepo}`);
  console.log(`  ${pc.green('Clean (no vulnerabilities):')} ${clean}`);
  console.log(`  ${pc.red('With vulnerabilities:')} ${withVulns}`);

  if (withVulns > 0) {
    console.log('');
    console.log(pc.bold('  Extensions with vulnerabilities:'));
    
    for (const result of results.filter((r) => r.vulnerabilities.total > 0)) {
      const vulns = result.vulnerabilities;
      const ext = result.extension;
      console.log(`    ${pc.red('•')} ${ext.displayName} (${vulns.total} issues)`);
    }
  }

  console.log('');
  console.log(pc.bold('═'.repeat(60)));
}

/**
 * Main extension check command
 */
export async function runExtensionCommand(options: ExtensionOptions = {}): Promise<void> {
  showWelcome();

  try {
    let extensionsToCheck: string[] = [];

    if (options.extension) {
      // Check specific extension
      extensionsToCheck = [options.extension];
    } else {
      // Get installed extensions
      const installed = await withSpinner('Detecting installed VS Code extensions', async () => {
        return getInstalledExtensions();
      });

      if (installed.length === 0) {
        warn('No VS Code extensions found. Make sure VS Code CLI is available.');
        showGoodbye();
        return;
      }

      info(`Found ${installed.length} installed extensions`);

      if (options.all) {
        extensionsToCheck = installed;
      } else {
        // Let user select extensions to check
        const selected = await p.multiselect({
          message: 'Select extensions to check for vulnerabilities:',
          options: installed.slice(0, 50).map((ext) => ({
            value: ext,
            label: ext,
          })),
          required: false,
        });

        if (p.isCancel(selected) || (selected as string[]).length === 0) {
          info('No extensions selected');
          showGoodbye();
          return;
        }

        extensionsToCheck = selected as string[];
      }
    }

    info(`Checking ${extensionsToCheck.length} extension(s)...`);

    const results: ExtensionVulnerabilitySummary[] = [];

    for (const extId of extensionsToCheck) {
      const result = await withSpinner(`Checking ${extId}`, async () => {
        return checkExtension(extId);
      });

      results.push(result);
      
      if (options.verbose) {
        displayExtensionSummary(result);
      }
    }

    // Display overall summary
    displayOverallSummary(results);

    // Show details for extensions with vulnerabilities
    const withVulns = results.filter((r) => r.vulnerabilities.total > 0);
    
    if (withVulns.length > 0 && !options.verbose) {
      console.log(pc.dim('  Run with --verbose to see detailed vulnerability information'));
      console.log('');
    }

    // Final status
    if (withVulns.length === 0) {
      success('All checked extensions appear to be secure!');
    } else {
      warn(`${withVulns.length} extension(s) have known vulnerabilities`);
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Extension check failed: ${message}`);
  }

  showGoodbye();
}
