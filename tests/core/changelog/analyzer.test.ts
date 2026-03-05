import { describe, it, expect } from 'vitest';
import { getVersionChangeType, isLikelySafeUpgrade, getUpgradeRisk } from '../../../src/core/changelog/analyzer.js';
import type { ChangelogAnalysis } from '../../../src/types/index.js';

function makeAnalysis(from: string, to: string, hasBreaking = false): ChangelogAnalysis {
  return {
    packageName: 'test',
    fromVersion: from,
    toVersion: to,
    entries: [],
    hasBreakingChanges: hasBreaking,
    summary: '',
  };
}

describe('getVersionChangeType', () => {
  it('should return "major" for a major version bump', () => {
    expect(getVersionChangeType('1.0.0', '2.0.0')).toBe('major');
  });

  it('should return "minor" for a minor version bump', () => {
    expect(getVersionChangeType('1.0.0', '1.1.0')).toBe('minor');
  });

  it('should return "patch" for a patch version bump', () => {
    expect(getVersionChangeType('1.0.0', '1.0.1')).toBe('patch');
  });

  it('should return "none" when versions are identical', () => {
    expect(getVersionChangeType('1.0.0', '1.0.0')).toBe('none');
  });

  it('should return "none" when fromVersion is invalid', () => {
    expect(getVersionChangeType('invalid', '1.0.0')).toBe('none');
  });

  it('should return "none" when toVersion is invalid', () => {
    expect(getVersionChangeType('1.0.0', 'invalid')).toBe('none');
  });
});

describe('isLikelySafeUpgrade', () => {
  it('should return true for a patch upgrade', () => {
    expect(isLikelySafeUpgrade('1.0.0', '1.0.1')).toBe(true);
  });

  it('should return false for a minor upgrade', () => {
    expect(isLikelySafeUpgrade('1.0.0', '1.1.0')).toBe(false);
  });

  it('should return false for a major upgrade', () => {
    expect(isLikelySafeUpgrade('1.0.0', '2.0.0')).toBe(false);
  });
});

describe('getUpgradeRisk', () => {
  it('should return "high" for a major version change', () => {
    const analysis = makeAnalysis('1.0.0', '2.0.0');
    expect(getUpgradeRisk(analysis)).toBe('high');
  });

  it('should return "medium" for a minor version change without breaking changes', () => {
    const analysis = makeAnalysis('1.0.0', '1.1.0');
    expect(getUpgradeRisk(analysis)).toBe('medium');
  });

  it('should return "low" for a patch version change without breaking changes', () => {
    const analysis = makeAnalysis('1.0.0', '1.0.1');
    expect(getUpgradeRisk(analysis)).toBe('low');
  });

  it('should return "high" for a minor version change with breaking changes', () => {
    const analysis = makeAnalysis('1.0.0', '1.1.0', true);
    expect(getUpgradeRisk(analysis)).toBe('high');
  });
});
