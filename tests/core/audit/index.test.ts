import { describe, it, expect } from 'vitest';
import {
  deduplicateVulnerabilities,
  groupBySeverity,
} from '../../../src/core/audit/index.js';
import type { AuditResult, Vulnerability } from '../../../src/types/index.js';

function makeVuln(
  id: string,
  pkg: string,
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'info' = 'high',
): Vulnerability {
  return {
    id,
    title: 'Test',
    severity,
    packageName: pkg,
    currentVersion: '1.0.0',
    vulnerableVersions: '<2.0.0',
    patchedVersions: '>=2.0.0',
    recommendation: 'Upgrade',
    url: null,
    cwe: [],
    cvss: null,
    dependencyPath: [pkg],
    isDirect: true,
    rootDependency: null,
  };
}

function makeResult(vulns: Vulnerability[]): AuditResult {
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  for (const v of vulns) counts[v.severity]++;
  return {
    packageManager: 'npm',
    vulnerabilities: vulns,
    metadata: { totalDependencies: 10, vulnerabilityCounts: counts },
  };
}

describe('deduplicateVulnerabilities', () => {
  it('removes duplicates by id+packageName', () => {
    const vulns = [
      makeVuln('CVE-1', 'lodash', 'high'),
      makeVuln('CVE-1', 'lodash', 'high'),
      makeVuln('CVE-2', 'express', 'critical'),
    ];
    const result = deduplicateVulnerabilities(makeResult(vulns));

    expect(result.vulnerabilities).toHaveLength(2);
    expect(result.vulnerabilities[0].id).toBe('CVE-1');
    expect(result.vulnerabilities[1].id).toBe('CVE-2');
  });

  it('keeps unique vulnerabilities unchanged', () => {
    const vulns = [
      makeVuln('CVE-1', 'lodash', 'high'),
      makeVuln('CVE-2', 'express', 'critical'),
      makeVuln('CVE-3', 'axios', 'moderate'),
    ];
    const result = deduplicateVulnerabilities(makeResult(vulns));

    expect(result.vulnerabilities).toHaveLength(3);
  });

  it('recalculates severity counts after dedup', () => {
    const vulns = [
      makeVuln('CVE-1', 'lodash', 'high'),
      makeVuln('CVE-1', 'lodash', 'high'),
      makeVuln('CVE-2', 'express', 'critical'),
      makeVuln('CVE-2', 'express', 'critical'),
      makeVuln('CVE-3', 'axios', 'low'),
    ];
    const result = deduplicateVulnerabilities(makeResult(vulns));

    expect(result.vulnerabilities).toHaveLength(3);
    expect(result.metadata.vulnerabilityCounts).toEqual({
      critical: 1,
      high: 1,
      moderate: 0,
      low: 1,
      info: 0,
    });
  });

  it('handles empty input', () => {
    const result = deduplicateVulnerabilities(makeResult([]));

    expect(result.vulnerabilities).toHaveLength(0);
    expect(result.metadata.vulnerabilityCounts).toEqual({
      critical: 0,
      high: 0,
      moderate: 0,
      low: 0,
      info: 0,
    });
  });
});

describe('groupBySeverity', () => {
  it('groups vulnerabilities correctly by severity', () => {
    const vulns = [
      makeVuln('CVE-1', 'lodash', 'high'),
      makeVuln('CVE-2', 'express', 'critical'),
      makeVuln('CVE-3', 'axios', 'moderate'),
      makeVuln('CVE-4', 'chalk', 'high'),
    ];
    const groups = groupBySeverity(makeResult(vulns));

    expect(groups.critical).toHaveLength(1);
    expect(groups.critical[0].id).toBe('CVE-2');
    expect(groups.high).toHaveLength(2);
    expect(groups.moderate).toHaveLength(1);
    expect(groups.low).toHaveLength(0);
    expect(groups.info).toHaveLength(0);
  });

  it('returns empty groups for unused severities', () => {
    const vulns = [makeVuln('CVE-1', 'lodash', 'high')];
    const groups = groupBySeverity(makeResult(vulns));

    expect(groups.critical).toHaveLength(0);
    expect(groups.high).toHaveLength(1);
    expect(groups.moderate).toHaveLength(0);
    expect(groups.low).toHaveLength(0);
    expect(groups.info).toHaveLength(0);
  });

  it('puts all vulnerabilities in one group when same severity', () => {
    const vulns = [
      makeVuln('CVE-1', 'lodash', 'critical'),
      makeVuln('CVE-2', 'express', 'critical'),
      makeVuln('CVE-3', 'axios', 'critical'),
    ];
    const groups = groupBySeverity(makeResult(vulns));

    expect(groups.critical).toHaveLength(3);
    expect(groups.high).toHaveLength(0);
    expect(groups.moderate).toHaveLength(0);
    expect(groups.low).toHaveLength(0);
    expect(groups.info).toHaveLength(0);
  });
});
