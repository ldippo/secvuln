import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseCatalogReference,
  resolveCatalogVersion,
  parseCatalogs,
  updateCatalogVersion,
} from '../../../src/core/workspace/catalog.js';
import { createTempDir, writeTempFile, cleanupTempDirs } from '../../helpers/temp-dir.js';

describe('catalog', () => {
  afterEach(() => cleanupTempDirs());

  describe('parseCatalogReference', () => {
    it('should return empty string for default catalog reference "catalog:"', () => {
      expect(parseCatalogReference('catalog:')).toBe('');
    });

    it('should return the catalog name for a named catalog reference', () => {
      expect(parseCatalogReference('catalog:react17')).toBe('react17');
    });

    it('should return null for a caret version range', () => {
      expect(parseCatalogReference('^1.0.0')).toBeNull();
    });

    it('should return null for a tilde version range', () => {
      expect(parseCatalogReference('~2.3.0')).toBeNull();
    });
  });

  describe('resolveCatalogVersion', () => {
    const catalogs = {
      default: {
        react: '^17.0.0',
        lodash: '^4.17.21',
      },
      named: {
        react17: {
          react: '^17.0.0',
          'react-dom': '^17.0.0',
        },
      },
    };

    it('should resolve a default catalog reference to the version in catalogs.default', () => {
      expect(resolveCatalogVersion('react', 'catalog:', catalogs)).toBe('^17.0.0');
    });

    it('should resolve a named catalog reference to the version in the named catalog', () => {
      expect(resolveCatalogVersion('react', 'catalog:react17', catalogs)).toBe('^17.0.0');
    });

    it('should return the version spec as-is when it is not a catalog reference', () => {
      expect(resolveCatalogVersion('react', '^1.0.0', catalogs)).toBe('^1.0.0');
    });

    it('should return the version spec as-is when catalogs is undefined', () => {
      expect(resolveCatalogVersion('react', 'catalog:', undefined)).toBe('catalog:');
    });

    it('should return the version spec when the package is not found in the default catalog', () => {
      expect(resolveCatalogVersion('express', 'catalog:', catalogs)).toBe('catalog:');
    });

    it('should return the version spec when the package is not found in the named catalog', () => {
      expect(resolveCatalogVersion('express', 'catalog:react17', catalogs)).toBe('catalog:react17');
    });
  });

  describe('parseCatalogs', () => {
    it('should parse both default and named catalogs from YAML', () => {
      const tmpDir = createTempDir();
      writeTempFile(
        tmpDir,
        'pnpm-workspace.yaml',
        [
          'packages:',
          '  - "packages/*"',
          'catalog:',
          '  react: "^17.0.0"',
          '  lodash: "^4.17.21"',
          'catalogs:',
          '  react17:',
          '    react: "^17.0.0"',
          '    react-dom: "^17.0.0"',
        ].join('\n'),
      );

      const result = parseCatalogs(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.default).toEqual({
        react: '^17.0.0',
        lodash: '^4.17.21',
      });
      expect(result!.named).toEqual({
        react17: {
          react: '^17.0.0',
          'react-dom': '^17.0.0',
        },
      });
    });

    it('should parse default catalog only and return empty named', () => {
      const tmpDir = createTempDir();
      writeTempFile(
        tmpDir,
        'pnpm-workspace.yaml',
        [
          'packages:',
          '  - "packages/*"',
          'catalog:',
          '  react: "^17.0.0"',
          '  lodash: "^4.17.21"',
        ].join('\n'),
      );

      const result = parseCatalogs(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.default).toEqual({
        react: '^17.0.0',
        lodash: '^4.17.21',
      });
      expect(result!.named).toEqual({});
    });

    it('should parse named catalogs only and return empty default', () => {
      const tmpDir = createTempDir();
      writeTempFile(
        tmpDir,
        'pnpm-workspace.yaml',
        [
          'packages:',
          '  - "packages/*"',
          'catalogs:',
          '  react17:',
          '    react: "^17.0.0"',
          '    react-dom: "^17.0.0"',
        ].join('\n'),
      );

      const result = parseCatalogs(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.default).toEqual({});
      expect(result!.named).toEqual({
        react17: {
          react: '^17.0.0',
          'react-dom': '^17.0.0',
        },
      });
    });

    it('should return null when YAML has no catalog or catalogs keys', () => {
      const tmpDir = createTempDir();
      writeTempFile(
        tmpDir,
        'pnpm-workspace.yaml',
        ['packages:', '  - "packages/*"'].join('\n'),
      );

      const result = parseCatalogs(tmpDir);

      expect(result).toBeNull();
    });

    it('should return null when pnpm-workspace.yaml does not exist', () => {
      const tmpDir = createTempDir();

      const result = parseCatalogs(tmpDir);

      expect(result).toBeNull();
    });
  });

  describe('updateCatalogVersion', () => {
    it('should update an existing entry in the default catalog', () => {
      const tmpDir = createTempDir();
      writeTempFile(
        tmpDir,
        'pnpm-workspace.yaml',
        [
          'packages:',
          '  - "packages/*"',
          'catalog:',
          '  react: "^17.0.0"',
          '  lodash: "^4.17.21"',
        ].join('\n'),
      );

      updateCatalogVersion(tmpDir, '', 'react', '^18.0.0');

      const result = parseCatalogs(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.default['react']).toBe('^18.0.0');
      expect(result!.default['lodash']).toBe('^4.17.21');
    });

    it('should update an existing entry in a named catalog', () => {
      const tmpDir = createTempDir();
      writeTempFile(
        tmpDir,
        'pnpm-workspace.yaml',
        [
          'packages:',
          '  - "packages/*"',
          'catalogs:',
          '  react17:',
          '    react: "^17.0.0"',
          '    react-dom: "^17.0.0"',
        ].join('\n'),
      );

      updateCatalogVersion(tmpDir, 'react17', 'react', '^18.0.0');

      const result = parseCatalogs(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.named['react17']['react']).toBe('^18.0.0');
      expect(result!.named['react17']['react-dom']).toBe('^17.0.0');
    });

    it('should preserve YAML comments and formatting', () => {
      const tmpDir = createTempDir();
      writeTempFile(
        tmpDir,
        'pnpm-workspace.yaml',
        [
          '# Workspace configuration',
          'packages:',
          '  - "packages/*"',
          '',
          '# Default catalog versions',
          'catalog:',
          '  react: "^17.0.0"',
          '  lodash: "^4.17.21"',
        ].join('\n'),
      );

      updateCatalogVersion(tmpDir, '', 'react', '^18.0.0');

      const content = readFileSync(`${tmpDir}/pnpm-workspace.yaml`, 'utf-8');
      expect(content).toContain('# Workspace configuration');
      expect(content).toContain('# Default catalog versions');
      expect(content).toContain('^18.0.0');
    });

    it('should create a new entry in the default catalog', () => {
      const tmpDir = createTempDir();
      writeTempFile(
        tmpDir,
        'pnpm-workspace.yaml',
        [
          'packages:',
          '  - "packages/*"',
          'catalog:',
          '  react: "^17.0.0"',
        ].join('\n'),
      );

      updateCatalogVersion(tmpDir, '', 'express', '^4.18.0');

      const result = parseCatalogs(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.default['express']).toBe('^4.18.0');
      expect(result!.default['react']).toBe('^17.0.0');
    });
  });
});
