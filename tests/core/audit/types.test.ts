import { describe, it, expect } from 'vitest';
import {
  normalizeSeverity,
  extractVersionFromPath,
  parseDependencyPath,
  isDirect,
  getRootDependency,
  createEmptyAuditResult,
} from '../../../src/core/audit/types.js';

describe('normalizeSeverity', () => {
  it('should return "critical" for "critical"', () => {
    expect(normalizeSeverity('critical')).toBe('critical');
  });

  it('should return "high" for "high"', () => {
    expect(normalizeSeverity('high')).toBe('high');
  });

  it('should return "moderate" for "moderate"', () => {
    expect(normalizeSeverity('moderate')).toBe('moderate');
  });

  it('should return "moderate" for "medium" (alias)', () => {
    expect(normalizeSeverity('medium')).toBe('moderate');
  });

  it('should return "low" for "low"', () => {
    expect(normalizeSeverity('low')).toBe('low');
  });

  it('should return "info" for "info"', () => {
    expect(normalizeSeverity('info')).toBe('info');
  });

  it('should be case insensitive (e.g. "CRITICAL" -> "critical")', () => {
    expect(normalizeSeverity('CRITICAL')).toBe('critical');
  });

  it('should return "info" for unknown severity values', () => {
    expect(normalizeSeverity('unknown')).toBe('info');
  });

  it('should return "info" for empty string', () => {
    expect(normalizeSeverity('')).toBe('info');
  });
});

describe('parseDependencyPath', () => {
  it('should split a path with ">" into trimmed parts', () => {
    expect(parseDependencyPath('express > qs')).toEqual(['express', 'qs']);
  });

  it('should return a single-element array for a direct dependency', () => {
    expect(parseDependencyPath('lodash')).toEqual(['lodash']);
  });

  it('should handle deep dependency chains', () => {
    expect(parseDependencyPath('a > b > c')).toEqual(['a', 'b', 'c']);
  });
});

describe('isDirect', () => {
  it('should return true for a direct dependency (no ">")', () => {
    expect(isDirect('lodash')).toBe(true);
  });

  it('should return false for a transitive dependency path', () => {
    expect(isDirect('express > qs')).toBe(false);
  });
});

describe('getRootDependency', () => {
  it('should extract the root dependency name stripping the version', () => {
    expect(getRootDependency('express@4.18.0 > qs@6.11.0')).toBe('express');
  });

  it('should return null for a direct dependency (single segment)', () => {
    expect(getRootDependency('lodash')).toBeNull();
  });

  it('should handle scoped packages correctly', () => {
    expect(getRootDependency('@scope/pkg@1.0.0 > child')).toBe('@scope/pkg');
  });

  it('should return the root for deep dependency chains', () => {
    expect(getRootDependency('a > b > c')).toBe('a');
  });

  it('should handle paths without version numbers', () => {
    expect(getRootDependency('express > qs')).toBe('express');
  });
});

describe('extractVersionFromPath', () => {
  it('should extract the version from a versioned path segment', () => {
    const result = extractVersionFromPath('express@4.18.0 > qs@6.11.0');
    expect(result).toContain('4.18.0');
  });

  it('should return "unknown" when no version is present', () => {
    expect(extractVersionFromPath('lodash')).toBe('unknown');
  });
});

describe('createEmptyAuditResult', () => {
  it('should create an empty audit result for npm', () => {
    const result = createEmptyAuditResult('npm');
    expect(result).toEqual({
      packageManager: 'npm',
      vulnerabilities: [],
      metadata: {
        totalDependencies: 0,
        vulnerabilityCounts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
      },
    });
  });

  it('should create an empty audit result for pnpm', () => {
    const result = createEmptyAuditResult('pnpm');
    expect(result).toEqual({
      packageManager: 'pnpm',
      vulnerabilities: [],
      metadata: {
        totalDependencies: 0,
        vulnerabilityCounts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
      },
    });
  });
});
