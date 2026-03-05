import { describe, it, expect, afterEach } from 'vitest';
import {
  detectPackageManager,
  getInstallCommand,
  getAuditCommand,
} from '../../src/core/package-manager.js';
import { createTempDir, writeTempFile, cleanupTempDirs } from '../helpers/temp-dir.js';

afterEach(() => cleanupTempDirs());

describe('detectPackageManager', () => {
  it('detects pnpm from pnpm-lock.yaml', () => {
    const dir = createTempDir();
    writeTempFile(dir, 'pnpm-lock.yaml', '');

    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  it('detects yarn from yarn.lock', () => {
    const dir = createTempDir();
    writeTempFile(dir, 'yarn.lock', '');

    expect(detectPackageManager(dir)).toBe('yarn');
  });

  it('detects npm from package-lock.json', () => {
    const dir = createTempDir();
    writeTempFile(dir, 'package-lock.json', '{}');

    expect(detectPackageManager(dir)).toBe('npm');
  });

  it('defaults to npm when no lockfile is present', () => {
    const dir = createTempDir();

    expect(detectPackageManager(dir)).toBe('npm');
  });

  it('prioritizes pnpm when multiple lockfiles exist', () => {
    const dir = createTempDir();
    writeTempFile(dir, 'pnpm-lock.yaml', '');
    writeTempFile(dir, 'yarn.lock', '');
    writeTempFile(dir, 'package-lock.json', '{}');

    expect(detectPackageManager(dir)).toBe('pnpm');
  });
});

describe('getInstallCommand', () => {
  it('returns npm install for npm', () => {
    expect(getInstallCommand('npm')).toBe('npm install');
  });

  it('returns yarn install for yarn', () => {
    expect(getInstallCommand('yarn')).toBe('yarn install');
  });

  it('returns pnpm install for pnpm', () => {
    expect(getInstallCommand('pnpm')).toBe('pnpm install');
  });
});

describe('getAuditCommand', () => {
  it('returns npm audit --json for npm', () => {
    expect(getAuditCommand('npm')).toEqual(['npm', 'audit', '--json']);
  });

  it('returns yarn audit --json for yarn', () => {
    expect(getAuditCommand('yarn')).toEqual(['yarn', 'audit', '--json']);
  });

  it('returns pnpm audit --json for pnpm', () => {
    expect(getAuditCommand('pnpm')).toEqual(['pnpm', 'audit', '--json']);
  });
});
