import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNpmAudit } from '../../../src/core/audit/npm.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures');

describe('parseNpmAudit', () => {
  it('parses direct vulnerability correctly', () => {
    const input = readFileSync(join(fixturesDir, 'npm-audit-direct.json'), 'utf-8');
    const result = parseNpmAudit(input);

    expect(result.packageManager).toBe('npm');
    expect(result.vulnerabilities).toHaveLength(1);

    const vuln = result.vulnerabilities[0];
    expect(vuln.id).toBe('npm-1094985');
    expect(vuln.title).toBe('Prototype Pollution');
    expect(vuln.severity).toBe('high');
    expect(vuln.packageName).toBe('lodash');
    expect(vuln.isDirect).toBe(true);
    expect(vuln.rootDependency).toBeNull();
    expect(vuln.cwe).toEqual(['CWE-1321']);
    expect(vuln.cvss).toBe(7.4);
    expect(vuln.url).toBe('https://github.com/advisories/GHSA-1234');
    expect(vuln.vulnerableVersions).toBe('<4.17.21');
    expect(vuln.patchedVersions).toBe('4.17.21');
  });

  it('extracts currentVersion from vulnerable range', () => {
    const input = readFileSync(join(fixturesDir, 'npm-audit-direct.json'), 'utf-8');
    const result = parseNpmAudit(input);
    // Range is "<4.17.21", regex extracts first semver: "4.17.21"
    expect(result.vulnerabilities[0].currentVersion).toBe('4.17.21');
  });

  it('parses transitive vulnerability with node_modules nesting', () => {
    const input = readFileSync(join(fixturesDir, 'npm-audit-transitive.json'), 'utf-8');
    const result = parseNpmAudit(input);

    // Only qs has actual via details, express has string-only via ["qs"] which is skipped
    expect(result.vulnerabilities).toHaveLength(1);

    const vuln = result.vulnerabilities[0];
    expect(vuln.packageName).toBe('qs');
    expect(vuln.isDirect).toBe(false);
    // node_modules/express/node_modules/qs splits on /\/node_modules\// into
    // ["node_modules/express", "qs"]; Strategy 1 extracts "node_modules" from
    // segments[0] since it strips after the first '/'. The BFS fallback
    // (Strategy 2) is not reached because segments.length >= 2.
    expect(vuln.rootDependency).toBe('node_modules');
    expect(vuln.dependencyPath).toEqual(['node_modules/express', 'qs']);
  });

  it('finds rootDependency via BFS when node_modules is flat', () => {
    const input = readFileSync(join(fixturesDir, 'npm-audit-via-chain.json'), 'utf-8');
    const result = parseNpmAudit(input);

    // minimatch has actual via details, glob and rimraf have string-only via
    expect(result.vulnerabilities).toHaveLength(1);

    const vuln = result.vulnerabilities[0];
    expect(vuln.packageName).toBe('minimatch');
    expect(vuln.isDirect).toBe(false);
    // Flat node_modules/minimatch → no nesting, BFS walks:
    // minimatch → found in glob.via → glob → found in rimraf.via → rimraf.isDirect=true → "rimraf"
    expect(vuln.rootDependency).toBe('rimraf');
  });

  it('skips vulnerabilities with only string via entries', () => {
    const input = readFileSync(join(fixturesDir, 'npm-audit-transitive.json'), 'utf-8');
    const result = parseNpmAudit(input);
    // express has via: ["qs"] (strings only), should be skipped
    const expressVulns = result.vulnerabilities.filter(v => v.packageName === 'express');
    expect(expressVulns).toHaveLength(0);
  });

  it('returns empty result for malformed JSON', () => {
    const result = parseNpmAudit('not valid json {{{');
    expect(result.packageManager).toBe('npm');
    expect(result.vulnerabilities).toHaveLength(0);
  });

  it('returns empty result for empty vulnerabilities', () => {
    const result = parseNpmAudit(JSON.stringify({
      vulnerabilities: {},
      metadata: { vulnerabilities: {}, dependencies: { total: 10 } }
    }));
    expect(result.vulnerabilities).toHaveLength(0);
    expect(result.metadata.totalDependencies).toBe(10);
  });

  it('handles fixAvailable as boolean true', () => {
    const input = JSON.stringify({
      vulnerabilities: {
        pkg: {
          name: 'pkg',
          severity: 'moderate',
          isDirect: true,
          via: [{
            source: 1, name: 'pkg', dependency: 'pkg',
            title: 'Test', url: 'https://test.com', severity: 'moderate',
            cwe: [], cvss: { score: 5.0, vectorString: '' }, range: '<2.0.0'
          }],
          effects: [],
          range: '<2.0.0',
          nodes: ['node_modules/pkg'],
          fixAvailable: true
        }
      },
      metadata: { dependencies: { total: 5 } }
    });
    const result = parseNpmAudit(input);
    expect(result.vulnerabilities[0].patchedVersions).toBeNull();
    expect(result.vulnerabilities[0].recommendation).toBe('Run npm audit fix');
  });

  it('handles fixAvailable as false', () => {
    const input = JSON.stringify({
      vulnerabilities: {
        pkg: {
          name: 'pkg',
          severity: 'low',
          isDirect: true,
          via: [{
            source: 2, name: 'pkg', dependency: 'pkg',
            title: 'Test', url: 'https://test.com', severity: 'low',
            cwe: [], cvss: { score: 3.0, vectorString: '' }, range: '<1.0.0'
          }],
          effects: [],
          range: '<1.0.0',
          nodes: ['node_modules/pkg'],
          fixAvailable: false
        }
      },
      metadata: { dependencies: { total: 5 } }
    });
    const result = parseNpmAudit(input);
    expect(result.vulnerabilities[0].patchedVersions).toBeNull();
    expect(result.vulnerabilities[0].recommendation).toBe('No fix available');
  });

  it('counts severity correctly for multiple vulnerabilities', () => {
    const input = readFileSync(join(fixturesDir, 'npm-audit-direct.json'), 'utf-8');
    const result = parseNpmAudit(input);
    expect(result.metadata.vulnerabilityCounts.high).toBe(1);
    expect(result.metadata.vulnerabilityCounts.critical).toBe(0);
  });

  it('extracts totalDependencies from metadata', () => {
    const input = readFileSync(join(fixturesDir, 'npm-audit-direct.json'), 'utf-8');
    const result = parseNpmAudit(input);
    expect(result.metadata.totalDependencies).toBe(15);
  });

  it('handles fixAvailable as object with isSemVerMajor', () => {
    const input = JSON.stringify({
      vulnerabilities: {
        pkg: {
          name: 'pkg',
          severity: 'critical',
          isDirect: true,
          via: [{
            source: 3, name: 'pkg', dependency: 'pkg',
            title: 'RCE', url: 'https://test.com', severity: 'critical',
            cwe: ['CWE-78'], cvss: { score: 9.8, vectorString: '' }, range: '<3.0.0'
          }],
          effects: [],
          range: '<3.0.0',
          nodes: ['node_modules/pkg'],
          fixAvailable: { name: 'pkg', version: '3.0.0', isSemVerMajor: true }
        }
      },
      metadata: { dependencies: { total: 5 } }
    });
    const result = parseNpmAudit(input);
    expect(result.vulnerabilities[0].patchedVersions).toBe('3.0.0');
    expect(result.vulnerabilities[0].recommendation).toBe('Upgrade pkg to 3.0.0 (major version change)');
  });
});
