import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePnpmAudit } from '../../../src/core/audit/pnpm.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures');

describe('parsePnpmAudit', () => {
  it('parses pnpm audit JSON format', () => {
    const input = readFileSync(join(fixturesDir, 'pnpm-audit-basic.json'), 'utf-8');
    const result = parsePnpmAudit(input);

    expect(result.packageManager).toBe('pnpm');
    // 2 findings paths: "lodash" and "express > lodash"
    expect(result.vulnerabilities).toHaveLength(2);
  });

  it('parses direct vulnerability path', () => {
    const input = readFileSync(join(fixturesDir, 'pnpm-audit-basic.json'), 'utf-8');
    const result = parsePnpmAudit(input);

    const directVuln = result.vulnerabilities.find(v => v.isDirect);
    expect(directVuln).toBeDefined();
    expect(directVuln!.packageName).toBe('lodash');
    expect(directVuln!.currentVersion).toBe('4.17.20');
    expect(directVuln!.rootDependency).toBeNull();
  });

  it('parses transitive vulnerability path', () => {
    const input = readFileSync(join(fixturesDir, 'pnpm-audit-basic.json'), 'utf-8');
    const result = parsePnpmAudit(input);

    const transitiveVuln = result.vulnerabilities.find(v => !v.isDirect);
    expect(transitiveVuln).toBeDefined();
    expect(transitiveVuln!.rootDependency).toBe('express');
  });

  it('extracts totalDependencies from metadata', () => {
    const input = readFileSync(join(fixturesDir, 'pnpm-audit-basic.json'), 'utf-8');
    const result = parsePnpmAudit(input);
    expect(result.metadata.totalDependencies).toBe(100);
  });

  it('returns empty result for malformed JSON', () => {
    const result = parsePnpmAudit('not json');
    expect(result.packageManager).toBe('pnpm');
    expect(result.vulnerabilities).toHaveLength(0);
  });

  it('handles empty advisories', () => {
    const result = parsePnpmAudit(JSON.stringify({
      advisories: {},
      metadata: { vulnerabilities: {}, dependencies: 10, devDependencies: 5, totalDependencies: 15 }
    }));
    expect(result.vulnerabilities).toHaveLength(0);
    expect(result.metadata.totalDependencies).toBe(15);
  });
});
