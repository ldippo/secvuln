#!/usr/bin/env node

import { Command } from 'commander';
import { runFixCommand } from '../commands/fix.js';
import { runTestsCommand } from '../commands/test.js';
import { runExtensionCommand } from '../commands/extension.js';
import { runAuditResolutionsCommand } from '../commands/audit-resolutions.js';
import { runFixAllCommand } from '../commands/fix-all.js';

const program = new Command();

program
  .name('secvuln')
  .description('CLI tool for managing security vulnerability remediation in npm/yarn/pnpm projects')
  .version('1.0.0');

program
  .command('fix')
  .description('Scan for vulnerabilities and interactively apply fixes')
  .option('-p, --path <path>', 'Path to project root', process.cwd())
  .option('-d, --dry-run', 'Show what would be changed without making changes')
  .option('-v, --verbose', 'Show verbose output')
  .action(async (options) => {
    await runFixCommand(options.path, {
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
  });

program
  .command('test')
  .description('Run test/build commands to verify changes')
  .option('-p, --path <path>', 'Path to project root', process.cwd())
  .option('-a, --all', 'Run all detected test commands without prompting')
  .option('-v, --verbose', 'Show full command output')
  .action(async (options) => {
    await runTestsCommand(options.path, {
      all: options.all,
      verbose: options.verbose,
    });
  });

program
  .command('extension')
  .alias('ext')
  .description('Check VS Code extensions for security vulnerabilities')
  .option('-e, --extension <id>', 'Check a specific extension by ID (e.g., publisher.name)')
  .option('-a, --all', 'Check all installed extensions without prompting')
  .option('-v, --verbose', 'Show detailed vulnerability information')
  .action(async (options) => {
    await runExtensionCommand({
      extension: options.extension,
      all: options.all,
      verbose: options.verbose,
    });
  });

program
  .command('audit-resolutions')
  .alias('ar')
  .description('Check if existing overrides/resolutions are still necessary')
  .option('-p, --path <path>', 'Path to project root', process.cwd())
  .option('-f, --fix', 'Interactively remove unnecessary resolutions')
  .option('-v, --verbose', 'Show detailed information for each resolution')
  .option('--json', 'Output results as JSON')
  .action(async (options) => {
    await runAuditResolutionsCommand(options.path, {
      fix: options.fix,
      verbose: options.verbose,
      json: options.json,
    });
  });

program
  .command('fix-all')
  .alias('fa')
  .description('Iteratively fix vulnerabilities: fix, install, re-audit until clean, then optionally test and audit resolutions')
  .option('-p, --path <path>', 'Path to project root', process.cwd())
  .option('-d, --dry-run', 'Show what would be changed without making changes')
  .option('-v, --verbose', 'Show verbose output')
  .option('-m, --max-rounds <number>', 'Maximum fix rounds (default: 5)', '5')
  .action(async (options) => {
    const maxRounds = parseInt(options.maxRounds, 10);
    if (isNaN(maxRounds) || maxRounds < 1) {
      console.error('--max-rounds must be a positive integer');
      process.exit(1);
    }
    await runFixAllCommand(options.path, {
      dryRun: options.dryRun,
      verbose: options.verbose,
      maxRounds,
    });
  });

program.parse();
