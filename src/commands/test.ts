import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { TestCommand, TestResult } from '../types/index.js';
import { detectWorkspace } from '../core/workspace/detector.js';
import {
  showWelcome,
  showGoodbye,
  withSpinner,
  promptTestCommands,
  info,
  success,
  warn,
  error,
} from '../ui/index.js';

interface TestOptions {
  all?: boolean;
  verbose?: boolean;
  silent?: boolean;
}

// Common test/build script patterns
const TEST_PATTERNS = [
  'test',
  'test:unit',
  'test:integration',
  'test:e2e',
  'tests',
  'spec',
  'jest',
  'mocha',
  'vitest',
  'ava',
  'tap',
];

const BUILD_PATTERNS = [
  'build',
  'build:prod',
  'build:dev',
  'compile',
  'bundle',
  'dist',
];

const LINT_PATTERNS = [
  'lint',
  'lint:fix',
  'eslint',
  'prettier',
  'format',
  'check',
  'typecheck',
  'tsc',
];

/**
 * Find test/build commands in package.json scripts
 */
function findTestCommands(
  packageJsonPath: string,
  packageName: string
): TestCommand[] {
  if (!existsSync(packageJsonPath)) {
    return [];
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    const scripts = pkg.scripts || {};
    
    const commands: TestCommand[] = [];
    const allPatterns = [...TEST_PATTERNS, ...BUILD_PATTERNS, ...LINT_PATTERNS];
    
    for (const [name, script] of Object.entries(scripts)) {
      // Check if script name matches common patterns
      const isRelevant = allPatterns.some((pattern) => 
        name.toLowerCase().includes(pattern.toLowerCase())
      );
      
      if (isRelevant && typeof script === 'string') {
        commands.push({
          name,
          script,
          packagePath: dirname(packageJsonPath),
          packageName,
        });
      }
    }
    
    return commands;
  } catch {
    return [];
  }
}

/**
 * Run a single test command
 */
async function executeSingleCommand(command: TestCommand, verbose: boolean): Promise<TestResult> {
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const [cmd, ...args] = command.script.split(' ');
    
    // Use npm/yarn/pnpm run for script commands
    const proc = spawn('npm', ['run', command.name], {
      cwd: command.packagePath,
      shell: true,
      stdio: verbose ? 'inherit' : 'pipe',
    });

    let stdout = '';
    let stderr = '';

    if (!verbose) {
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
    }

    proc.on('close', (exitCode) => {
      resolve({
        command,
        success: exitCode === 0,
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      });
    });

    proc.on('error', (err) => {
      resolve({
        command,
        success: false,
        exitCode: 1,
        stdout,
        stderr: stderr + '\n' + err.message,
        duration: Date.now() - startTime,
      });
    });
  });
}

/**
 * Display test results
 */
function displayTestResults(results: TestResult[]): void {
  console.log('');
  console.log(pc.bold('═'.repeat(60)));
  console.log(pc.bold(pc.cyan('  TEST RESULTS')));
  console.log(pc.bold('═'.repeat(60)));
  console.log('');

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.success
      ? pc.green('✓ PASS')
      : pc.red('✗ FAIL');
    
    const duration = (result.duration / 1000).toFixed(1);
    
    console.log(`  ${status} ${pc.bold(result.command.name)} (${duration}s)`);
    console.log(`    ${pc.dim(result.command.packageName)}`);
    
    if (result.success) {
      passed++;
    } else {
      failed++;
      
      // Show error output for failed tests
      if (result.stderr) {
        console.log('');
        console.log(pc.red('    Error output:'));
        const lines = result.stderr.split('\n').slice(0, 10);
        for (const line of lines) {
          console.log(pc.dim(`      ${line}`));
        }
        if (result.stderr.split('\n').length > 10) {
          console.log(pc.dim('      ... (truncated)'));
        }
      }
    }
    
    console.log('');
  }

  console.log(pc.bold('─'.repeat(60)));
  console.log(`  ${pc.green(`${passed} passed`)}, ${pc.red(`${failed} failed`)}`);
  console.log(pc.bold('═'.repeat(60)));
  console.log('');
}

/**
 * Main test command implementation
 */
export async function runTestsCommand(
  targetPath: string,
  options: TestOptions = {}
): Promise<void> {
  if (!options.silent) showWelcome();

  try {
    // Detect workspace
    const workspace = await withSpinner('Detecting workspace configuration', async () => {
      return detectWorkspace(targetPath);
    });

    info(`Package manager: ${workspace.packageManager}`);
    info(`Packages found: ${workspace.packages.length}`);

    // Find all test commands across packages
    const allCommands: TestCommand[] = [];

    for (const pkg of workspace.packages) {
      const commands = findTestCommands(
        join(pkg.path, 'package.json'),
        pkg.name
      );
      allCommands.push(...commands);
    }

    if (allCommands.length === 0) {
      warn('No test/build commands found in package.json scripts');
      if (!options.silent) showGoodbye();
      return;
    }

    info(`Found ${allCommands.length} test/build commands`);

    // Let user select commands to run
    let commandsToRun: TestCommand[];

    if (options.all) {
      commandsToRun = allCommands;
    } else {
      commandsToRun = await promptTestCommands(allCommands);
      
      if (commandsToRun.length === 0) {
        info('No commands selected');
        if (!options.silent) showGoodbye();
        return;
      }
    }

    info(`Running ${commandsToRun.length} commands...`);
    console.log('');

    // Run selected commands
    const results: TestResult[] = [];

    for (const command of commandsToRun) {
      const spinner = p.spinner();
      spinner.start(`Running ${command.name} (${command.packageName})`);
      
      const result = await executeSingleCommand(command, options.verbose || false);
      
      if (result.success) {
        spinner.stop(pc.green('✓') + ` ${command.name} passed`);
      } else {
        spinner.stop(pc.red('✗') + ` ${command.name} failed`);
      }
      
      results.push(result);
    }

    // Display results
    displayTestResults(results);

    // Summary
    const allPassed = results.every((r) => r.success);
    
    if (allPassed) {
      success('All tests passed! Safe to commit changes.');
    } else {
      const failedCount = results.filter((r) => !r.success).length;
      error(`${failedCount} test(s) failed. Review errors above.`);
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Test command failed: ${message}`);
  }

  if (!options.silent) showGoodbye();
}
