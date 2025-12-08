#!/usr/bin/env node

import { Command } from 'commander';
import { runFixCommand } from '../commands/fix.js';
import { runTestsCommand } from '../commands/test.js';

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

program.parse();
