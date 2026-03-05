import { describe, it, expect, vi, afterEach } from 'vitest';
import { auditResolutions } from '../../../src/core/resolver/audit-resolutions.js';
import { removeResolutions } from '../../../src/core/resolver/transitive.js';
import { createTempDir, writeTempFile, cleanupTempDirs } from '../../helpers/temp-dir.js';
import { mockFetch } from '../../helpers/mock-fetch.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTempDirs();
});

// ---------------------------------------------------------------------------
// auditResolutions
// ---------------------------------------------------------------------------
describe('auditResolutions', () => {
  it('returns empty result when no resolutions exist', async () => {
    const dir = createTempDir();
    writeTempFile(dir, 'package.json', JSON.stringify({ name: 'test' }, null, 2));
    mockFetch({});

    const result = await auditResolutions(dir, 'npm');
    expect(result.totalResolutions).toBe(0);
    expect(result.entries).toEqual([]);
    expect(result.counts).toEqual({ needed: 0, removable: 0, stale: 0, unknown: 0 });
  });

  it('marks override as removable when latest > override version', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', overrides: { qs: '6.12.0' } }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/qs': {
        versions: {
          '6.12.0': {},
          '6.13.0': {},
        },
        'dist-tags': { latest: '6.13.0' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.totalResolutions).toBe(1);
    expect(result.entries[0].status).toBe('removable');
    expect(result.entries[0].reason).toContain('6.13.0');
    expect(result.counts.removable).toBe(1);
  });

  it('marks override as needed when it matches the latest version', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', overrides: { qs: '6.12.0' } }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/qs': {
        versions: {
          '6.11.0': {},
          '6.12.0': {},
        },
        'dist-tags': { latest: '6.12.0' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].status).toBe('needed');
    expect(result.counts.needed).toBe(1);
  });

  it('marks override as unknown when registry fetch fails', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', overrides: { 'unknown-pkg': '1.0.0' } }, null, 2)
    );
    mockFetch({}); // No matching URL → 404

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].status).toBe('unknown');
    expect(result.entries[0].reason).toContain('Failed to fetch');
    expect(result.counts.unknown).toBe(1);
  });

  it('marks non-semver override as unknown', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        overrides: { qs: 'https://github.com/ljharb/qs.git' },
      }, null, 2)
    );
    mockFetch({});

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].status).toBe('unknown');
    expect(result.entries[0].reason).toContain('not a simple semver');
  });

  it('marks override as unknown when latest < override', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', overrides: { qs: '99.0.0' } }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/qs': {
        versions: { '6.12.0': {} },
        'dist-tags': { latest: '6.12.0' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].status).toBe('unknown');
    expect(result.entries[0].reason).toContain('older than override');
  });

  it('handles multiple resolutions with mixed statuses', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        overrides: {
          qs: '6.12.0',
          lodash: '4.17.21',
          'bad-pkg': '1.0.0',
        },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/qs': {
        versions: { '6.12.0': {}, '6.13.0': {} },
        'dist-tags': { latest: '6.13.0' },
      },
      'https://registry.npmjs.org/lodash': {
        versions: { '4.17.21': {} },
        'dist-tags': { latest: '4.17.21' },
      },
      // bad-pkg not in mock → 404
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.totalResolutions).toBe(3);
    expect(result.counts.removable).toBe(1);
    expect(result.counts.needed).toBe(1);
    expect(result.counts.unknown).toBe(1);
  });

  it('reads pnpm overrides correctly', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        pnpm: { overrides: { qs: '6.12.0' } },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/qs': {
        versions: { '6.12.0': {}, '6.13.0': {} },
        'dist-tags': { latest: '6.13.0' },
      },
    });

    const result = await auditResolutions(dir, 'pnpm');
    expect(result.packageManager).toBe('pnpm');
    expect(result.entries[0].status).toBe('removable');
  });

  it('reads yarn resolutions correctly', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        resolutions: { qs: '6.12.0' },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/qs': {
        versions: { '6.12.0': {} },
        'dist-tags': { latest: '6.12.0' },
      },
    });

    const result = await auditResolutions(dir, 'yarn');
    expect(result.packageManager).toBe('yarn');
    expect(result.entries[0].status).toBe('needed');
  });

  it('finds parent dependencies for removable overrides', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.18.0' },
        overrides: { qs: '6.12.0' },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/qs': {
        versions: {
          '6.12.0': {},
          '6.13.0': {},
        },
        'dist-tags': { latest: '6.13.0' },
      },
      'https://registry.npmjs.org/express': {
        versions: {
          '4.18.0': { dependencies: { qs: '>=6.11.0 <6.12.0' } },
          '4.18.2': { dependencies: { qs: '>=6.11.0 <6.12.0' } },
          '4.19.0': { dependencies: { qs: '>=6.12.0' } },
        },
        'dist-tags': { latest: '4.19.0' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].status).toBe('removable');
    expect(result.entries[0].parentDependencies).toHaveLength(1);

    const parent = result.entries[0].parentDependencies[0];
    expect(parent.name).toBe('express');
    expect(parent.currentVersion).toBe('4.18.0');
    expect(parent.targetVersion).toBe('4.19.0');
    expect(parent.versionChangeType).toBe('minor');
    expect(parent.isSafe).toBe(true);
  });

  it('reports major parent bump as unsafe', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { 'some-lib': '^1.0.0' },
        overrides: { 'vulnerable-child': '2.0.0' },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/vulnerable-child': {
        versions: { '2.0.0': {}, '2.1.0': {} },
        'dist-tags': { latest: '2.1.0' },
      },
      'https://registry.npmjs.org/some-lib': {
        versions: {
          '1.0.0': { dependencies: { 'vulnerable-child': '^1.0.0' } },
          '2.0.0': { dependencies: { 'vulnerable-child': '^2.0.0' } },
        },
        'dist-tags': { latest: '2.0.0' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].parentDependencies).toHaveLength(1);

    const parent = result.entries[0].parentDependencies[0];
    expect(parent.targetVersion).toBe('2.0.0');
    expect(parent.versionChangeType).toBe('major');
    expect(parent.isSafe).toBe(false);
  });

  it('reports no target when no parent version resolves the child', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { 'stuck-lib': '^1.0.0' },
        overrides: { 'old-child': '3.0.0' },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/old-child': {
        versions: { '3.0.0': {}, '3.1.0': {} },
        'dist-tags': { latest: '3.1.0' },
      },
      'https://registry.npmjs.org/stuck-lib': {
        versions: {
          '1.0.0': { dependencies: { 'old-child': '^2.0.0' } },
          '1.1.0': { dependencies: { 'old-child': '^2.5.0' } },
        },
        'dist-tags': { latest: '1.1.0' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].parentDependencies).toHaveLength(1);

    const parent = result.entries[0].parentDependencies[0];
    expect(parent.name).toBe('stuck-lib');
    expect(parent.targetVersion).toBeNull();
    expect(parent.isSafe).toBe(false);
  });

  it('returns empty parentDependencies for needed overrides', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.18.0' },
        overrides: { qs: '6.12.0' },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/qs': {
        versions: { '6.12.0': {} },
        'dist-tags': { latest: '6.12.0' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].status).toBe('needed');
    expect(result.entries[0].parentDependencies).toEqual([]);
  });

  it('finds multiple parent dependencies', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        dependencies: {
          'lib-a': '^1.0.0',
          'lib-b': '^2.0.0',
        },
        overrides: { 'shared-child': '1.5.0' },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/shared-child': {
        versions: { '1.5.0': {}, '1.6.0': {} },
        'dist-tags': { latest: '1.6.0' },
      },
      'https://registry.npmjs.org/lib-a': {
        versions: {
          '1.0.0': { dependencies: { 'shared-child': '^1.0.0' } },
          '1.1.0': { dependencies: { 'shared-child': '^1.5.0' } },
        },
        'dist-tags': { latest: '1.1.0' },
      },
      'https://registry.npmjs.org/lib-b': {
        versions: {
          '2.0.0': { dependencies: { 'shared-child': '^1.0.0' } },
          '2.0.1': { dependencies: { 'shared-child': '^1.5.0' } },
        },
        'dist-tags': { latest: '2.0.1' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].parentDependencies).toHaveLength(2);

    const names = result.entries[0].parentDependencies.map((p) => p.name);
    expect(names).toContain('lib-a');
    expect(names).toContain('lib-b');

    const libA = result.entries[0].parentDependencies.find((p) => p.name === 'lib-a');
    expect(libA?.targetVersion).toBe('1.1.0');
    expect(libA?.versionChangeType).toBe('minor');
    expect(libA?.isSafe).toBe(true);

    const libB = result.entries[0].parentDependencies.find((p) => p.name === 'lib-b');
    expect(libB?.targetVersion).toBe('2.0.1');
    expect(libB?.versionChangeType).toBe('patch');
    expect(libB?.isSafe).toBe(true);
  });

  it('classifies as stale when parents cannot safely resolve', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { 'parent-lib': '^1.0.0' },
        overrides: { 'child-pkg': '2.0.0' },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/child-pkg': {
        versions: { '1.0.0': {}, '2.0.0': {}, '2.5.0': {} },
        'dist-tags': { latest: '2.5.0' },
      },
      'https://registry.npmjs.org/parent-lib': {
        versions: {
          '1.0.0': { dependencies: { 'child-pkg': '^1.0.0' } },
          '2.0.0': { dependencies: { 'child-pkg': '^2.0.0' } },
        },
        'dist-tags': { latest: '2.0.0' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].status).toBe('stale');
    expect(result.entries[0].suggestedVersion).toBe('2.5.0');
    expect(result.entries[0].parentDependencies).toHaveLength(1);
    expect(result.entries[0].parentDependencies[0].isSafe).toBe(false);
  });

  it('classifies as stale when some parents cannot resolve', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        dependencies: {
          'safe-parent': '^1.0.0',
          'stuck-parent': '^1.0.0',
        },
        overrides: { 'child-dep': '2.0.0' },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/child-dep': {
        versions: { '2.0.0': {}, '2.5.0': {} },
        'dist-tags': { latest: '2.5.0' },
      },
      'https://registry.npmjs.org/safe-parent': {
        versions: {
          '1.0.0': { dependencies: { 'child-dep': '^1.0.0' } },
          '1.1.0': { dependencies: { 'child-dep': '^2.0.0' } },
        },
        'dist-tags': { latest: '1.1.0' },
      },
      'https://registry.npmjs.org/stuck-parent': {
        versions: {
          '1.0.0': { dependencies: { 'child-dep': '^1.0.0' } },
          '2.0.0': { dependencies: { 'child-dep': '^2.0.0' } },
        },
        'dist-tags': { latest: '2.0.0' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].status).toBe('stale');
    expect(result.entries[0].suggestedVersion).toBe('2.5.0');
    expect(result.entries[0].parentDependencies).toHaveLength(2);

    const safe = result.entries[0].parentDependencies.find((p) => p.name === 'safe-parent');
    expect(safe?.isSafe).toBe(true);

    const stuck = result.entries[0].parentDependencies.find((p) => p.name === 'stuck-parent');
    expect(stuck?.isSafe).toBe(false);
  });

  it('classifies as removable with no parents (orphaned override)', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { 'unrelated-pkg': '^1.0.0' },
        overrides: { 'orphan-child': '1.0.0' },
      }, null, 2)
    );
    mockFetch({
      'https://registry.npmjs.org/orphan-child': {
        versions: { '1.0.0': {}, '1.1.0': {} },
        'dist-tags': { latest: '1.1.0' },
      },
      'https://registry.npmjs.org/unrelated-pkg': {
        versions: {
          '1.0.0': { dependencies: { 'some-other-dep': '^1.0.0' } },
        },
        'dist-tags': { latest: '1.0.0' },
      },
    });

    const result = await auditResolutions(dir, 'npm');
    expect(result.entries[0].status).toBe('removable');
    expect(result.entries[0].parentDependencies).toEqual([]);
  });

  it('caches registry fetches across iterations', async () => {
    const dir = createTempDir();
    writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        overrides: { qs: '6.12.0', 'qs-extra': '1.0.0' },
      }, null, 2)
    );
    const fetchFn = mockFetch({
      'https://registry.npmjs.org/qs': {
        versions: { '6.12.0': {}, '6.13.0': {} },
        'dist-tags': { latest: '6.13.0' },
      },
      'https://registry.npmjs.org/qs-extra': {
        versions: { '1.0.0': {} },
        'dist-tags': { latest: '1.0.0' },
      },
    });

    await auditResolutions(dir, 'npm');
    // Each unique package should be fetched exactly once
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// removeResolutions
// ---------------------------------------------------------------------------
describe('removeResolutions', () => {
  it('removes specified packages from npm overrides', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        overrides: { qs: '6.12.0', lodash: '4.17.21' },
      }, null, 2)
    );

    removeResolutions(pkgPath, ['qs'], 'npm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.overrides).toEqual({ lodash: '4.17.21' });
  });

  it('removes specified packages from yarn resolutions', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        resolutions: { qs: '6.12.0', lodash: '4.17.21' },
      }, null, 2)
    );

    removeResolutions(pkgPath, ['qs'], 'yarn');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.resolutions).toEqual({ lodash: '4.17.21' });
  });

  it('removes specified packages from pnpm overrides', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        pnpm: { overrides: { qs: '6.12.0', lodash: '4.17.21' } },
      }, null, 2)
    );

    removeResolutions(pkgPath, ['qs'], 'pnpm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.pnpm.overrides).toEqual({ lodash: '4.17.21' });
  });

  it('cleans up empty overrides object for npm', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        overrides: { qs: '6.12.0' },
      }, null, 2)
    );

    removeResolutions(pkgPath, ['qs'], 'npm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.overrides).toBeUndefined();
  });

  it('cleans up empty resolutions object for yarn', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        resolutions: { qs: '6.12.0' },
      }, null, 2)
    );

    removeResolutions(pkgPath, ['qs'], 'yarn');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.resolutions).toBeUndefined();
  });

  it('cleans up empty pnpm object when overrides becomes empty', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        pnpm: { overrides: { qs: '6.12.0' } },
      }, null, 2)
    );

    removeResolutions(pkgPath, ['qs'], 'pnpm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.pnpm).toBeUndefined();
  });

  it('preserves pnpm object when it has other keys besides overrides', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        pnpm: {
          overrides: { qs: '6.12.0' },
          peerDependencyRules: { ignoreMissing: ['react'] },
        },
      }, null, 2)
    );

    removeResolutions(pkgPath, ['qs'], 'pnpm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.pnpm.overrides).toBeUndefined();
    expect(pkg.pnpm.peerDependencyRules).toBeDefined();
  });

  it('preserves other package.json fields', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        version: '1.0.0',
        dependencies: { express: '^4.0.0' },
        overrides: { qs: '6.12.0' },
      }, null, 2)
    );

    removeResolutions(pkgPath, ['qs'], 'npm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.name).toBe('test');
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.dependencies).toEqual({ express: '^4.0.0' });
  });

  it('removes multiple packages at once', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({
        name: 'test',
        overrides: { qs: '6.12.0', lodash: '4.17.21', semver: '7.6.0' },
      }, null, 2)
    );

    removeResolutions(pkgPath, ['qs', 'lodash'], 'npm');

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.overrides).toEqual({ semver: '7.6.0' });
  });

  it('preserves JSON formatting with 2-space indent and trailing newline', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test', overrides: { qs: '6.12.0' } }, null, 2)
    );

    removeResolutions(pkgPath, ['qs'], 'npm');

    const raw = readFileSync(pkgPath, 'utf-8');
    expect(raw).toContain('  "name"');
    expect(raw.endsWith('\n')).toBe(true);
  });
});
