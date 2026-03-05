import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYarnAudit } from '../../../src/core/audit/yarn.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures');

describe('parseYarnAudit', () => {
  it('parses yarn audit JSON lines format', () => {
    const input = readFileSync(join(fixturesDir, 'yarn-audit-basic.jsonl'), 'utf-8');
    const result = parseYarnAudit(input);

    expect(result.packageManager).toBe('yarn');
    expect(result.vulnerabilities).toHaveLength(2);
  });

  it('parses direct vulnerability', () => {
    const input = readFileSync(join(fixturesDir, 'yarn-audit-basic.jsonl'), 'utf-8');
    const result = parseYarnAudit(input);

    const lodashVuln = result.vulnerabilities.find(v => v.packageName === 'lodash');
    expect(lodashVuln).toBeDefined();
    expect(lodashVuln!.isDirect).toBe(true);
    expect(lodashVuln!.rootDependency).toBeNull();
    expect(lodashVuln!.currentVersion).toBe('4.17.20');
    expect(lodashVuln!.severity).toBe('high');
  });

  it('parses transitive vulnerability', () => {
    const input = readFileSync(join(fixturesDir, 'yarn-audit-basic.jsonl'), 'utf-8');
    const result = parseYarnAudit(input);

    const qsVuln = result.vulnerabilities.find(v => v.packageName === 'qs');
    expect(qsVuln).toBeDefined();
    expect(qsVuln!.isDirect).toBe(false);
    expect(qsVuln!.rootDependency).toBe('express');
    expect(qsVuln!.currentVersion).toBe('6.11.0');
  });

  it('extracts totalDependencies from summary', () => {
    const input = readFileSync(join(fixturesDir, 'yarn-audit-basic.jsonl'), 'utf-8');
    const result = parseYarnAudit(input);
    expect(result.metadata.totalDependencies).toBe(150);
  });

  it('deduplicates by unique ID', () => {
    // Same advisory + path twice
    const lines = [
      JSON.stringify({type:"auditAdvisory",data:{resolution:{id:1,path:"lodash",dev:false,optional:false,bundled:false},advisory:{id:1,title:"Test",module_name:"lodash",severity:"high",url:"https://test.com",vulnerable_versions:"<4.17.21",patched_versions:">=4.17.21",cwe:[],cvss:{score:7.0,vectorString:""},findings:[{version:"4.17.20",paths:["lodash"]}]}}}),
      JSON.stringify({type:"auditAdvisory",data:{resolution:{id:1,path:"lodash",dev:false,optional:false,bundled:false},advisory:{id:1,title:"Test",module_name:"lodash",severity:"high",url:"https://test.com",vulnerable_versions:"<4.17.21",patched_versions:">=4.17.21",cwe:[],cvss:{score:7.0,vectorString:""},findings:[{version:"4.17.20",paths:["lodash"]}]}}}),
    ].join('\n');
    const result = parseYarnAudit(lines);
    expect(result.vulnerabilities).toHaveLength(1);
  });

  it('returns empty result for malformed input', () => {
    const result = parseYarnAudit('not json');
    expect(result.packageManager).toBe('yarn');
    expect(result.vulnerabilities).toHaveLength(0);
  });

  it('handles missing patched_versions', () => {
    const line = JSON.stringify({
      type: 'auditAdvisory',
      data: {
        resolution: { id: 99, path: 'pkg', dev: false, optional: false, bundled: false },
        advisory: {
          id: 99, title: 'Test', module_name: 'pkg', severity: 'moderate',
          url: 'https://test.com', vulnerable_versions: '<1.0.0', patched_versions: '',
          cwe: [], cvss: { score: 5.0, vectorString: '' },
          findings: [{ version: '0.9.0', paths: ['pkg'] }]
        }
      }
    });
    const result = parseYarnAudit(line);
    expect(result.vulnerabilities[0].patchedVersions).toBeNull();
  });
});
