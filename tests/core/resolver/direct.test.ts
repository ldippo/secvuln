import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getCurrentVersion,
  applyUpgrade,
  applyResolution,
  getTargetVersion,
  createDirectFixAction,
} from '../../../src/core/resolver/direct.js';
import { createTempDir, writeTempFile, cleanupTempDirs } from '../../helpers/temp-dir.js';
import { mockFetch } from '../../helpers/mock-fetch.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Vulnerability, CatalogData } from '../../../src/types/index.js';

function makeVuln(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: 'test-1',
    title: 'Test Vuln',
    severity: 'high',
    packageName: 'lodash',
    currentVersion: '4.17.20',
    vulnerableVersions: '<4.17.21',
    patchedVersions: '>=4.17.21',
    recommendation: 'Upgrade',
    url: 'https://test.com',
    cwe: [],
    cvss: null,
    dependencyPath: ['lodash'],
    isDirect: true,
    rootDependency: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTempDirs();
});

// ---------------------------------------------------------------------------
// getCurrentVersion
// ---------------------------------------------------------------------------
describe('getCurrentVersion', () => {
  it('returns the base version from a caret range', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { lodash: '^1.2.3' } }),
    );
    expect(getCurrentVersion(pkgPath, 'lodash')).toBe('1.2.3');
  });

  it('returns the base version from a tilde range', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { lodash: '~1.2.3' } }),
    );
    expect(getCurrentVersion(pkgPath, 'lodash')).toBe('1.2.3');
  });

  it('returns an exact version as-is', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { lodash: '1.2.3' } }),
    );
    expect(getCurrentVersion(pkgPath, 'lodash')).toBe('1.2.3');
  });

  it('resolves a catalog reference when catalogs are provided', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { react: 'catalog:' } }),
    );
    const catalogs: CatalogData = {
      default: { react: '^18.2.0' },
      named: {},
    };
    expect(getCurrentVersion(pkgPath, 'react', catalogs)).toBe('18.2.0');
  });

  it('returns null when the package is not listed', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { lodash: '^1.0.0' } }),
    );
    expect(getCurrentVersion(pkgPath, 'express')).toBeNull();
  });

  it('reads from devDependencies', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }),
    );
    expect(getCurrentVersion(pkgPath, 'vitest')).toBe('2.0.0');
  });

  it('returns null when the file does not exist', () => {
    expect(getCurrentVersion('/nonexistent/path/package.json', 'lodash')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyUpgrade
// ---------------------------------------------------------------------------
describe('applyUpgrade', () => {
  it('updates a dependency in dependencies', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { lodash: '^4.17.20' } }, null, 2) + '\n',
    );

    applyUpgrade(pkgPath, 'lodash', '4.17.21');

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.dependencies.lodash).toBe('^4.17.21');
  });

  it('updates a dependency in devDependencies', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ devDependencies: { vitest: '^1.0.0' } }, null, 2) + '\n',
    );

    applyUpgrade(pkgPath, 'vitest', '2.0.0');

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.devDependencies.vitest).toBe('^2.0.0');
  });

  it('updates pnpm-workspace.yaml for a catalog reference', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { react: 'catalog:' } }, null, 2) + '\n',
    );
    writeTempFile(
      dir,
      'pnpm-workspace.yaml',
      'packages:\n  - "packages/*"\ncatalog:\n  react: ^18.2.0\n',
    );

    const catalogs: CatalogData = {
      default: { react: '^18.2.0' },
      named: {},
    };

    applyUpgrade(pkgPath, 'react', '18.3.1', { catalogs, rootPath: dir });

    const yamlContent = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf-8');
    expect(yamlContent).toContain('^18.3.1');

    // package.json should remain unchanged (catalog ref preserved)
    const pkgContent = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkgContent.dependencies.react).toBe('catalog:');
  });

  it('writes to package.json for a standard dep (no catalog)', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { lodash: '^4.17.20' } }, null, 2) + '\n',
    );

    applyUpgrade(pkgPath, 'lodash', '4.17.21', { catalogs: undefined, rootPath: undefined });

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.dependencies.lodash).toBe('^4.17.21');
  });

  it('does not modify other dependencies when upgrading one', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify(
        { dependencies: { lodash: '^4.17.20', express: '^4.18.0' } },
        null,
        2,
      ) + '\n',
    );

    applyUpgrade(pkgPath, 'lodash', '4.17.21');

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.dependencies.lodash).toBe('^4.17.21');
    expect(result.dependencies.express).toBe('^4.18.0');
  });

  it('updates catalog via fallback when dep is not in root package.json (monorepo)', () => {
    const dir = createTempDir();
    // Root package.json does NOT have react — it's only in sub-packages
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'monorepo-root' }, null, 2) + '\n',
    );
    writeTempFile(
      dir,
      'pnpm-workspace.yaml',
      'packages:\n  - "packages/*"\ncatalog:\n  react: ^18.2.0\n',
    );

    const catalogs: CatalogData = {
      default: { react: '^18.2.0' },
      named: {},
    };

    applyUpgrade(pkgPath, 'react', '18.3.1', { catalogs, rootPath: dir });

    const yamlContent = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf-8');
    expect(yamlContent).toContain('^18.3.1');

    // Root package.json should not have react added
    const pkgContent = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkgContent.dependencies).toBeUndefined();
  });

  it('updates a named catalog reference in pnpm-workspace.yaml', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { react: 'catalog:react17' } }, null, 2) + '\n',
    );
    writeTempFile(
      dir,
      'pnpm-workspace.yaml',
      'packages:\n  - "packages/*"\ncatalogs:\n  react17:\n    react: ^17.0.2\n',
    );

    const catalogs: CatalogData = {
      default: {},
      named: { react17: { react: '^17.0.2' } },
    };

    applyUpgrade(pkgPath, 'react', '17.0.3', { catalogs, rootPath: dir });

    const yamlContent = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf-8');
    expect(yamlContent).toContain('^17.0.3');

    // package.json should preserve the catalog reference
    const pkgContent = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkgContent.dependencies.react).toBe('catalog:react17');
  });
});

// ---------------------------------------------------------------------------
// applyResolution
// ---------------------------------------------------------------------------
describe('applyResolution', () => {
  it('creates npm overrides field', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test-project' }, null, 2) + '\n',
    );

    applyResolution(pkgPath, 'lodash', '4.17.21', 'npm');

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.overrides).toEqual({ lodash: '4.17.21' });
  });

  it('creates yarn resolutions field', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test-project' }, null, 2) + '\n',
    );

    applyResolution(pkgPath, 'lodash', '4.17.21', 'yarn');

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.resolutions).toEqual({ lodash: '4.17.21' });
  });

  it('creates pnpm.overrides nested structure', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test-project' }, null, 2) + '\n',
    );

    applyResolution(pkgPath, 'lodash', '4.17.21', 'pnpm');

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.pnpm).toEqual({ overrides: { lodash: '4.17.21' } });
  });

  it('merges with existing overrides for npm', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify(
        { name: 'test-project', overrides: { express: '4.18.2' } },
        null,
        2,
      ) + '\n',
    );

    applyResolution(pkgPath, 'lodash', '4.17.21', 'npm');

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.overrides).toEqual({ express: '4.18.2', lodash: '4.17.21' });
  });

  it('updates pnpm catalog instead of adding override when package is in catalog', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test-project' }, null, 2) + '\n',
    );
    writeTempFile(
      dir,
      'pnpm-workspace.yaml',
      'packages:\n  - "packages/*"\ncatalog:\n  lodash: ^4.17.20\n',
    );

    const catalogs: CatalogData = {
      default: { lodash: '^4.17.20' },
      named: {},
    };

    applyResolution(pkgPath, 'lodash', '4.17.21', 'pnpm', { catalogs, rootPath: dir });

    // Catalog should be updated
    const yamlContent = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf-8');
    expect(yamlContent).toContain('^4.17.21');

    // package.json should NOT have pnpm.overrides
    const pkgContent = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkgContent.pnpm).toBeUndefined();
  });

  it('still creates pnpm.overrides when package is NOT in catalog', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test-project' }, null, 2) + '\n',
    );

    const catalogs: CatalogData = {
      default: { react: '^18.2.0' },
      named: {},
    };

    applyResolution(pkgPath, 'lodash', '4.17.21', 'pnpm', { catalogs, rootPath: dir });

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.pnpm).toEqual({ overrides: { lodash: '4.17.21' } });
  });

  it('ignores catalogs for npm even if provided', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify({ name: 'test-project' }, null, 2) + '\n',
    );

    const catalogs: CatalogData = {
      default: { lodash: '^4.17.20' },
      named: {},
    };

    applyResolution(pkgPath, 'lodash', '4.17.21', 'npm', { catalogs, rootPath: dir });

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.overrides).toEqual({ lodash: '4.17.21' });
  });

  it('creates nested pnpm structure when pnpm key already exists but has no overrides', () => {
    const dir = createTempDir();
    const pkgPath = writeTempFile(
      dir,
      'package.json',
      JSON.stringify(
        { name: 'test-project', pnpm: { peerDependencyRules: {} } },
        null,
        2,
      ) + '\n',
    );

    applyResolution(pkgPath, 'lodash', '4.17.21', 'pnpm');

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(result.pnpm.overrides).toEqual({ lodash: '4.17.21' });
    expect(result.pnpm.peerDependencyRules).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getTargetVersion
// ---------------------------------------------------------------------------
describe('getTargetVersion', () => {
  it('returns the minimum satisfying version from the registry', async () => {
    mockFetch({
      'https://registry.npmjs.org/lodash': {
        versions: {
          '1.0.0': {},
          '1.0.1': {},
          '1.1.0': {},
          '2.0.0': {},
        },
      },
    });

    const result = await getTargetVersion('lodash', '1.0.0', '>=1.0.1');
    expect(result).toBe('1.0.1');
  });

  it('returns null when patchedVersions is null', async () => {
    const result = await getTargetVersion('lodash', '1.0.0', null);
    expect(result).toBeNull();
  });

  it('returns null when fetch fails', async () => {
    mockFetch({});

    const result = await getTargetVersion('lodash', '1.0.0', '>=1.0.1');
    expect(result).toBeNull();
  });

  it('filters versions to only those >= current version', async () => {
    mockFetch({
      'https://registry.npmjs.org/lodash': {
        versions: {
          '1.0.0': {},
          '1.0.1': {},
          '1.1.0': {},
          '2.0.0': {},
          '0.9.0': {},
        },
      },
    });

    // patchedVersions allows 0.9.0, but currentVersion is 1.0.0 so 0.9.0 is excluded
    const result = await getTargetVersion('lodash', '1.0.0', '>=0.9.0');
    expect(result).toBe('1.0.0');
  });

  it('returns null when no versions satisfy the patched range', async () => {
    mockFetch({
      'https://registry.npmjs.org/lodash': {
        versions: {
          '1.0.0': {},
          '1.0.1': {},
        },
      },
    });

    const result = await getTargetVersion('lodash', '1.0.0', '>=3.0.0');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createDirectFixAction
// ---------------------------------------------------------------------------
describe('createDirectFixAction', () => {
  it('returns an upgrade action when a target version is found', async () => {
    mockFetch({
      'https://registry.npmjs.org/lodash': {
        versions: {
          '4.17.20': {},
          '4.17.21': {},
          '4.18.0': {},
        },
      },
    });

    const vuln = makeVuln();
    const action = await createDirectFixAction(vuln);

    expect(action.type).toBe('upgrade');
    expect(action.targetVersion).toBe('4.17.21');
    expect(action.packageName).toBe('lodash');
    expect(action.currentVersion).toBe('4.17.20');
    expect(action.vulnerability).toBe(vuln);
  });

  it('returns a skip action when patchedVersions is null', async () => {
    const vuln = makeVuln({ patchedVersions: null });
    const action = await createDirectFixAction(vuln);

    expect(action.type).toBe('skip');
    expect(action.targetVersion).toBeNull();
    expect(action.reason).toBe('No patched version available');
  });

  it('returns a skip action when getTargetVersion returns null (fetch failure)', async () => {
    mockFetch({});

    const vuln = makeVuln();
    const action = await createDirectFixAction(vuln);

    expect(action.type).toBe('skip');
    expect(action.targetVersion).toBeNull();
    expect(action.versionChangeType).toBe('none');
    expect(action.reason).toBe('No patched version available');
  });

  it('sets the correct versionChangeType for a patch upgrade', async () => {
    mockFetch({
      'https://registry.npmjs.org/lodash': {
        versions: {
          '4.17.20': {},
          '4.17.21': {},
        },
      },
    });

    const vuln = makeVuln();
    const action = await createDirectFixAction(vuln);

    expect(action.type).toBe('upgrade');
    expect(action.versionChangeType).toBe('patch');
  });

  it('includes the correct reason string with version and change type', async () => {
    mockFetch({
      'https://registry.npmjs.org/lodash': {
        versions: {
          '4.17.20': {},
          '4.17.21': {},
        },
      },
    });

    const vuln = makeVuln();
    const action = await createDirectFixAction(vuln);

    expect(action.reason).toBe('Upgrade to 4.17.21 (patch version change)');
  });
});
