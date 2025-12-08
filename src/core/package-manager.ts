import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PackageManager } from '../types/index.js';

/**
 * Detect which package manager is being used based on lockfiles
 */
export function detectPackageManager(rootPath: string): PackageManager {
  // Check in order of specificity
  if (existsSync(join(rootPath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(rootPath, 'yarn.lock'))) {
    return 'yarn';
  }
  if (existsSync(join(rootPath, 'package-lock.json'))) {
    return 'npm';
  }
  
  // Default to npm if no lockfile found
  return 'npm';
}

/**
 * Check if a package manager is available in the system
 */
export function isPackageManagerAvailable(pm: PackageManager): boolean {
  try {
    execSync(`${pm} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the install command for a package manager
 */
export function getInstallCommand(pm: PackageManager): string {
  switch (pm) {
    case 'npm':
      return 'npm install';
    case 'yarn':
      return 'yarn install';
    case 'pnpm':
      return 'pnpm install';
  }
}

/**
 * Get the audit command for a package manager
 */
export function getAuditCommand(pm: PackageManager): string[] {
  switch (pm) {
    case 'npm':
      return ['npm', 'audit', '--json'];
    case 'yarn':
      return ['yarn', 'audit', '--json'];
    case 'pnpm':
      return ['pnpm', 'audit', '--json'];
  }
}

/**
 * Run a command and return the output
 */
export async function runCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (exitCode) => {
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1,
      });
    });

    proc.on('error', (err) => {
      resolve({
        stdout,
        stderr: stderr + err.message,
        exitCode: 1,
      });
    });
  });
}

/**
 * Run install command for the detected package manager
 */
export async function runInstall(
  pm: PackageManager,
  cwd: string
): Promise<{ success: boolean; output: string }> {
  const result = await runCommand(pm, ['install'], cwd);
  return {
    success: result.exitCode === 0,
    output: result.stdout + result.stderr,
  };
}
