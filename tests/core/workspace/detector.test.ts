import { describe, it, expect, afterEach } from 'vitest';
import { detectWorkspace, findProjectRoot } from '../../../src/core/workspace/detector.js';
import { createTempDir, writeTempFile, cleanupTempDirs } from '../../helpers/temp-dir.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

afterEach(() => cleanupTempDirs());

describe('findProjectRoot', () => {
  it('finds root by lockfile', () => {
    const dir = createTempDir();
    writeTempFile(dir, 'package.json', JSON.stringify({ name: 'root' }));
    writeTempFile(dir, 'package-lock.json', '{}');
    const subdir = join(dir, 'src', 'lib');
    mkdirSync(subdir, { recursive: true });

    const result = findProjectRoot(subdir);
    expect(result).toBe(dir);
  });

  it('finds root by workspaces field in package.json', () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    );

    const result = findProjectRoot(dir);
    expect(result).toBe(dir);
  });

  it('returns startPath when no root found', () => {
    const dir = createTempDir();
    writeTempFile(dir, 'package.json', JSON.stringify({ name: 'leaf' }));

    const result = findProjectRoot(dir);
    expect(result).toBe(dir);
  });

  it('walks up from nested directory to find lockfile', () => {
    const dir = createTempDir();
    writeTempFile(dir, 'package.json', JSON.stringify({ name: 'root' }));
    writeTempFile(dir, 'yarn.lock', '');
    const nested = join(dir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });

    const result = findProjectRoot(nested);
    expect(result).toBe(dir);
  });
});

describe('detectWorkspace', () => {
  it('detects single package (non-monorepo)', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'single-pkg', version: '1.0.0' }),
    );
    writeTempFile(dir, 'package-lock.json', '{}');

    const result = await detectWorkspace(dir);
    expect(result.isMonorepo).toBe(false);
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe('single-pkg');
    expect(result.packageManager).toBe('npm');
  });

  it('detects monorepo with workspace packages', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'mono-root',
        version: '1.0.0',
        workspaces: ['packages/*'],
      }),
    );
    writeTempFile(dir, 'package-lock.json', '{}');

    mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'b'), { recursive: true });
    writeTempFile(
      dir,
      'packages/a/package.json',
      JSON.stringify({ name: '@mono/a', version: '1.0.0' }),
    );
    writeTempFile(
      dir,
      'packages/b/package.json',
      JSON.stringify({ name: '@mono/b', version: '1.0.0' }),
    );

    const result = await detectWorkspace(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.packages).toHaveLength(3);
    expect(result.packageManager).toBe('npm');

    const names = result.packages.map((p) => p.name);
    expect(names).toContain('mono-root');
    expect(names).toContain('@mono/a');
    expect(names).toContain('@mono/b');
  });

  it('detects pnpm workspace with catalogs', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'pnpm-root', version: '1.0.0' }),
    );
    writeTempFile(dir, 'pnpm-lock.yaml', '');
    writeTempFile(
      dir,
      'pnpm-workspace.yaml',
      [
        'packages:',
        '  - "packages/*"',
        'catalog:',
        '  lodash: "^4.17.21"',
        '  react: "^18.2.0"',
      ].join('\n'),
    );

    mkdirSync(join(dir, 'packages', 'app'), { recursive: true });
    writeTempFile(
      dir,
      'packages/app/package.json',
      JSON.stringify({ name: '@pnpm/app', version: '1.0.0' }),
    );

    const result = await detectWorkspace(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.packageManager).toBe('pnpm');
    expect(result.catalogs).toBeTruthy();
  });

  it('handles empty root with no package.json', async () => {
    const dir = createTempDir();
    writeTempFile(dir, 'package-lock.json', '{}');

    const result = await detectWorkspace(dir);
    expect(result.isMonorepo).toBe(false);
    expect(result.packages).toHaveLength(0);
  });
});
