import { describe, it, expect, vi, afterEach } from 'vitest';
import { findParentFix, buildResolutionKey, getExistingResolutions, applyResolutions, createResolutionFix } from '../../../src/core/resolver/transitive.js';
import { createTempDir, writeTempFile, cleanupTempDirs } from '../../helpers/temp-dir.js';
import { mockFetch } from '../../helpers/mock-fetch.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Vulnerability } from '../../../src/types/index.js';

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTempDirs();
});

// ---------------------------------------------------------------------------
// findParentFix
// ---------------------------------------------------------------------------
describe('findParentFix', () => {
  it('finds patch fix via !intersects when vulnerableChildVersions provided', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          '4.18.1': { dependencies: { qs: '>=6.12.0' } },
          '4.18.2': { dependencies: { qs: '>=6.12.0' } },
          '5.0.0': { dependencies: { qs: '>=6.12.0' } },
        },
        'dist-tags': { latest: '5.0.0' },
      },
    });

    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0', '<6.12.0');
    expect(result.found).toBe(true);
    expect(result.targetVersion).toBe('4.18.1');
    expect(result.changeType).toBe('patch');
  });

  it('returns the minimum fix version when multiple patch versions fix the issue', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          '4.18.1': { dependencies: { qs: '>=6.12.0' } },
          '4.18.2': { dependencies: { qs: '>=6.12.0' } },
          '4.18.3': { dependencies: { qs: '>=6.12.0' } },
          '5.0.0': { dependencies: { qs: '>=6.12.0' } },
        },
        'dist-tags': { latest: '5.0.0' },
      },
    });

    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0', '<6.12.0');
    expect(result.found).toBe(true);
    expect(result.targetVersion).toBe('4.18.1');
  });

  it('finds minor fix when only minor version fixes the issue', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          '4.18.1': { dependencies: { qs: '~6.11.0' } },
          '4.18.2': { dependencies: { qs: '~6.11.0' } },
          '4.19.0': { dependencies: { qs: '>=6.12.0' } },
          '5.0.0': { dependencies: { qs: '>=6.12.0' } },
        },
        'dist-tags': { latest: '5.0.0' },
      },
    });

    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0', '<6.12.0');
    expect(result.found).toBe(true);
    expect(result.targetVersion).toBe('4.19.0');
    expect(result.changeType).toBe('minor');
  });

  it('returns found=false when only a major version fixes the issue', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          '4.18.1': { dependencies: { qs: '~6.11.0' } },
          '4.18.2': { dependencies: { qs: '~6.11.0' } },
          '5.0.0': { dependencies: { qs: '>=6.12.0' } },
        },
        'dist-tags': { latest: '5.0.0' },
      },
    });

    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0', '<6.12.0');
    expect(result.found).toBe(false);
    expect(result.targetVersion).toBeNull();
    expect(result.changeType).toBe('none');
  });

  it('returns found=false when no version fixes the vulnerability', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          '4.18.1': { dependencies: { qs: '~6.11.0' } },
          '4.18.2': { dependencies: { qs: '~6.11.1' } },
          '4.19.0': { dependencies: { qs: '~6.11.2' } },
        },
        'dist-tags': { latest: '4.19.0' },
      },
    });

    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0', '<6.12.0');
    expect(result.found).toBe(false);
    expect(result.targetVersion).toBeNull();
  });

  it('skips versions where parent drops the child dependency', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          '4.18.1': { dependencies: { 'body-parser': '^1.0.0' } }, // no qs
          '4.18.2': { dependencies: { qs: '>=6.12.0' } },
          '5.0.0': { dependencies: { qs: '>=6.12.0' } },
        },
        'dist-tags': { latest: '5.0.0' },
      },
    });

    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0', '<6.12.0');
    // Should skip 4.18.1 (no qs dep) and find 4.18.2
    expect(result.found).toBe(true);
    expect(result.targetVersion).toBe('4.18.2');
    expect(result.changeType).toBe('patch');
  });

  it('uses minVersion+satisfies fallback when vulnerableChildVersions is not provided', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          '4.18.1': { dependencies: { qs: '^6.12.0' } },
          '5.0.0': { dependencies: { qs: '^6.12.0' } },
        },
        'dist-tags': { latest: '5.0.0' },
      },
    });

    // No vulnerableChildVersions param — fallback to minVersion + satisfies
    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0');
    expect(result.found).toBe(true);
    expect(result.targetVersion).toBe('4.18.1');
    expect(result.changeType).toBe('patch');
  });

  it('returns found=false via fallback when minVersion does not satisfy patchedVersions', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          '4.18.1': { dependencies: { qs: '^6.11.0' } }, // minVersion = 6.11.0
          '4.18.2': { dependencies: { qs: '^6.11.5' } }, // minVersion = 6.11.5
        },
        'dist-tags': { latest: '4.18.2' },
      },
    });

    // patchedVersions = '>=6.12.0' — neither 6.11.0 nor 6.11.5 satisfies this
    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0');
    expect(result.found).toBe(false);
    expect(result.targetVersion).toBeNull();
  });

  it('returns found=false when fetch fails (404)', async () => {
    mockFetch({}); // No matching URL, so fetch returns 404

    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0', '<6.12.0');
    expect(result.found).toBe(false);
    expect(result.targetVersion).toBeNull();
    expect(result.changeType).toBe('none');
  });

  it('returns found=false when no newer versions exist', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          '4.18.1': { dependencies: { qs: '>=6.12.0' } },
          '5.0.0': { dependencies: { qs: '>=6.12.0' } },
        },
        'dist-tags': { latest: '5.0.0' },
      },
    });

    // currentParentVersion is already the latest
    const result = await findParentFix('express', '5.0.0', 'qs', '>=6.12.0', '<6.12.0');
    expect(result.found).toBe(false);
    expect(result.targetVersion).toBeNull();
    expect(result.changeType).toBe('none');
  });

  it('filters out invalid semver version strings', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          'not-a-version': { dependencies: { qs: '>=6.12.0' } },
          '4.18.1': { dependencies: { qs: '>=6.12.0' } },
        },
        'dist-tags': { latest: '4.18.1' },
      },
    });

    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0', '<6.12.0');
    expect(result.found).toBe(true);
    expect(result.targetVersion).toBe('4.18.1');
  });

  it('handles versions with no dependencies object', async () => {
    mockFetch({
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '~6.11.0' } },
          '4.18.1': {}, // no dependencies key at all
          '4.18.2': { dependencies: { qs: '>=6.12.0' } },
        },
        'dist-tags': { latest: '4.18.2' },
      },
    });

    const result = await findParentFix('express', '4.18.0', 'qs', '>=6.12.0', '<6.12.0');
    // 4.18.1 has no deps object so childRange is undefined → continue
    expect(result.found).toBe(true);
    expect(result.targetVersion).toBe('4.18.2');
    expect(result.changeType).toBe('patch');
  });

  it('returns majorBumpAvailable when only major parent bump fixes vuln', async () => {
    mockFetch({
      'https://registry.npmjs.org/my-parent': {
        versions: {
          '1.0.0': { dependencies: { 'vuln-child': '~1.0.0' } },
          '1.0.1': { dependencies: { 'vuln-child': '~1.0.0' } },
          '1.1.0': { dependencies: { 'vuln-child': '~1.0.0' } },
          '2.0.0': { dependencies: { 'vuln-child': '>=2.0.0' } },
        },
        'dist-tags': { latest: '2.0.0' },
      },
    });

    const result = await findParentFix('my-parent', '1.0.0', 'vuln-child', '>=2.0.0', '<2.0.0');
    expect(result.found).toBe(false);
    expect(result.targetVersion).toBeNull();
    expect(result.majorBumpAvailable).toBeDefined();
    expect(result.majorBumpAvailable?.targetVersion).toBe('2.0.0');
  });

  it('returns no majorBumpAvailable when patch/minor fix exists', async () => {
    mockFetch({
      'https://registry.npmjs.org/my-parent': {
        versions: {
          '1.0.0': { dependencies: { 'vuln-child': '~1.0.0' } },
          '1.0.1': { dependencies: { 'vuln-child': '>=2.0.0' } },
          '2.0.0': { dependencies: { 'vuln-child': '>=2.0.0' } },
        },
        'dist-tags': { latest: '2.0.0' },
      },
    });

    const result = await findParentFix('my-parent', '1.0.0', 'vuln-child', '>=2.0.0', '<2.0.0');
    expect(result.found).toBe(true);
    expect(result.targetVersion).toBe('1.0.1');
    expect(result.changeType).toBe('patch');
    expect(result.majorBumpAvailable).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createResolutionFix — majorParentBump
// ---------------------------------------------------------------------------
describe('createResolutionFix', () => {
  it('attaches majorParentBump to resolution FixAction', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { 'big-lib': '^1.0.0' },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/big-lib': {
        versions: {
          '1.0.0': { dependencies: { 'vuln-transitive': '~1.0.0' } },
          '1.0.1': { dependencies: { 'vuln-transitive': '~1.0.0' } },
          '2.0.0': { dependencies: { 'vuln-transitive': '>=2.0.0' } },
        },
        'dist-tags': { latest: '2.0.0' },
      },
      'https://registry.npmjs.org/vuln-transitive': {
        versions: { '1.0.0': {}, '2.0.0': {} },
        'dist-tags': { latest: '2.0.0' },
      },
    });

    const vuln: Vulnerability = {
      id: 'GHSA-test-001',
      title: 'Test vulnerability',
      severity: 'high',
      packageName: 'vuln-transitive',
      currentVersion: '1.0.0',
      vulnerableVersions: '<2.0.0',
      patchedVersions: '>=2.0.0',
      recommendation: 'Upgrade to 2.0.0',
      url: null,
      cwe: [],
      cvss: null,
      dependencyPath: ['big-lib', 'vuln-transitive'],
      isDirect: false,
      rootDependency: 'big-lib',
    };

    const action = await createResolutionFix(vuln, dir, 'npm');
    expect(action.type).toBe('resolution');
    expect(action.packageName).toBe('vuln-transitive');
    expect(action.targetVersion).toBe('2.0.0');
    expect(action.majorParentBump).toBeDefined();
    expect(action.majorParentBump?.parentPackage).toBe('big-lib');
    expect(action.majorParentBump?.targetVersion).toBe('2.0.0');
  });
});

// ---------------------------------------------------------------------------
// buildResolutionKey
// ---------------------------------------------------------------------------
describe('buildResolutionKey', () => {
  it('returns the package name when no parentPath is provided', () => {
    expect(buildResolutionKey('qs')).toBe('qs');
  });

  it('returns the package name even when parentPath is provided', () => {
    expect(buildResolutionKey('qs', 'express')).toBe('qs');
  });

  it('handles scoped package names', () => {
    expect(buildResolutionKey('@babel/core')).toBe('@babel/core');
  });
});

// ---------------------------------------------------------------------------
// getExistingResolutions
// ---------------------------------------------------------------------------
describe('getExistingResolutions', () => {
  it('reads npm overrides from package.json', () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', overrides: { qs: '6.12.0' } }, null, 2)
    );

    const result = getExistingResolutions(join(dir, 'package.json'), 'npm');
    expect(result).toEqual({ qs: '6.12.0' });
  });

  it('reads yarn resolutions from package.json', () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', resolutions: { qs: '6.12.0' } }, null, 2)
    );

    const result = getExistingResolutions(join(dir, 'package.json'), 'yarn');
    expect(result).toEqual({ qs: '6.12.0' });
  });

  it('reads pnpm overrides from package.json', () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', pnpm: { overrides: { qs: '6.12.0' } } }, null, 2)
    );

    const result = getExistingResolutions(join(dir, 'package.json'), 'pnpm');
    expect(result).toEqual({ qs: '6.12.0' });
  });

  it('returns empty object when file does not exist', () => {
    const result = getExistingResolutions('/tmp/nonexistent-path/package.json', 'npm');
    expect(result).toEqual({});
  });

  it('returns empty object when resolutions field is missing', () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', dependencies: { express: '^4.0.0' } }, null, 2)
    );

    expect(getExistingResolutions(join(dir, 'package.json'), 'npm')).toEqual({});
    expect(getExistingResolutions(join(dir, 'package.json'), 'yarn')).toEqual({});
    expect(getExistingResolutions(join(dir, 'package.json'), 'pnpm')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// applyResolutions
// ---------------------------------------------------------------------------
describe('applyResolutions', () => {
  it('writes npm overrides to package.json', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test' }, null, 2)
    );

    applyResolutions(pkgPath, { qs: '6.12.0' }, 'npm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.overrides).toEqual({ qs: '6.12.0' });
  });

  it('writes yarn resolutions to package.json', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test' }, null, 2)
    );

    applyResolutions(pkgPath, { qs: '6.12.0' }, 'yarn');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.resolutions).toEqual({ qs: '6.12.0' });
  });

  it('writes pnpm overrides to package.json under pnpm key', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test' }, null, 2)
    );

    applyResolutions(pkgPath, { qs: '6.12.0' }, 'pnpm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.pnpm).toEqual({ overrides: { qs: '6.12.0' } });
  });

  it('merges with existing resolutions instead of replacing them', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', overrides: { lodash: '4.17.21' } }, null, 2)
    );

    applyResolutions(pkgPath, { qs: '6.12.0' }, 'npm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.overrides).toEqual({ lodash: '4.17.21', qs: '6.12.0' });
  });

  it('overwrites an existing resolution for the same package', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', overrides: { qs: '6.11.0' } }, null, 2)
    );

    applyResolutions(pkgPath, { qs: '6.12.0' }, 'npm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.overrides).toEqual({ qs: '6.12.0' });
  });

  it('creates the pnpm key if it does not exist', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test' }, null, 2)
    );

    applyResolutions(pkgPath, { qs: '6.12.0' }, 'pnpm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.pnpm).toBeDefined();
    expect(pkg.pnpm.overrides).toEqual({ qs: '6.12.0' });
  });

  it('preserves JSON formatting with 2-space indent and trailing newline', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test' }, null, 2)
    );

    applyResolutions(pkgPath, { qs: '6.12.0' }, 'npm');

    const raw = readFileSync(pkgPath, 'utf-8');
    // Verify 2-space indent
    expect(raw).toContain('  "overrides"');
    // Verify trailing newline
    expect(raw.endsWith('\n')).toBe(true);
  });
});
