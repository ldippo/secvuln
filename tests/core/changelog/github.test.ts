import { describe, it, expect } from 'vitest';
import {
  parseGitHubUrl,
  extractBreakingChanges,
  hasBreakingChangeIndicators,
  parseChangelogMarkdown,
} from '../../../src/core/changelog/github.js';

describe('parseGitHubUrl', () => {
  it('parses a standard GitHub HTTPS URL', () => {
    const result = parseGitHubUrl('https://github.com/expressjs/express');
    expect(result).toEqual({ owner: 'expressjs', repo: 'express' });
  });

  it('parses a GitHub HTTPS URL with .git suffix', () => {
    const result = parseGitHubUrl('https://github.com/owner/repo.git');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses a git+https GitHub URL with .git suffix', () => {
    const result = parseGitHubUrl('git+https://github.com/owner/repo.git');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses an SSH-style GitHub URL', () => {
    const result = parseGitHubUrl('git@github.com:owner/repo.git');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses a git:// protocol GitHub URL', () => {
    const result = parseGitHubUrl('git://github.com/owner/repo.git');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('returns null for non-GitHub URLs', () => {
    const result = parseGitHubUrl('https://gitlab.com/owner/repo');
    expect(result).toBeNull();
  });
});

describe('extractBreakingChanges', () => {
  it('extracts items from a breaking changes section', () => {
    const body = '## Breaking Changes\n- Removed foo\n- Changed bar\n## Other';
    const result = extractBreakingChanges(body);
    expect(result).toEqual(['Removed foo', 'Changed bar']);
  });

  it('detects inline breaking change markers', () => {
    const body = 'This is a breaking change in the API';
    const result = extractBreakingChanges(body);
    expect(result).toEqual(['This is a breaking change in the API']);
  });

  it('returns an empty array when there are no breaking changes', () => {
    const body = 'This release includes minor bug fixes and performance improvements.';
    const result = extractBreakingChanges(body);
    expect(result).toEqual([]);
  });

  it('extracts items from a section with ⚠️ header', () => {
    const body = '## ⚠️ Breaking\n- item';
    const result = extractBreakingChanges(body);
    expect(result).toEqual(['item']);
  });
});

describe('hasBreakingChangeIndicators', () => {
  it('detects "breaking change" in text', () => {
    expect(hasBreakingChangeIndicators('This has a breaking change')).toBe(true);
  });

  it('detects uppercase "BREAKING" keyword', () => {
    expect(hasBreakingChangeIndicators('BREAKING: removed API')).toBe(true);
  });

  it('returns false for text with no breaking indicators', () => {
    expect(hasBreakingChangeIndicators('This is a minor fix with no issues')).toBe(false);
  });

  it('detects "migration required" indicator', () => {
    expect(hasBreakingChangeIndicators('migration required for v2')).toBe(true);
  });

  it('detects ⚠️ emoji indicator', () => {
    expect(hasBreakingChangeIndicators('⚠️ Important update')).toBe(true);
  });

  it('detects "deprecated" combined with "removed"', () => {
    expect(hasBreakingChangeIndicators('deprecated feature removed')).toBe(true);
  });
});

describe('parseChangelogMarkdown', () => {
  it('parses ## [1.2.3] - 2024-01-15 heading format (Keep a Changelog)', () => {
    const content = '## [1.2.3] - 2024-01-15\n\n- Fixed a bug\n';
    const entries = parseChangelogMarkdown(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe('1.2.3');
    expect(entries[0].date).toBe('2024-01-15');
  });

  it('parses ## 1.2.3 heading format (no brackets)', () => {
    const content = '## 1.2.3\n\n- Some change\n';
    const entries = parseChangelogMarkdown(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe('1.2.3');
  });

  it('parses ## v1.2.3 heading format (v prefix)', () => {
    const content = '## v1.2.3\n\n- Some change\n';
    const entries = parseChangelogMarkdown(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe('1.2.3');
  });

  it('parses # [1.2.3] heading format (h1)', () => {
    const content = '# [1.2.3]\n\n- Some change\n';
    const entries = parseChangelogMarkdown(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe('1.2.3');
  });

  it('extracts body text between version headings', () => {
    const content = '## [2.0.0]\n\n- First change\n- Second change\n\n## [1.0.0]\n\n- Old change\n';
    const entries = parseChangelogMarkdown(content);
    expect(entries).toHaveLength(2);
    const v2 = entries.find((e) => e.version === '2.0.0');
    expect(v2).toBeDefined();
    expect(v2!.body).toContain('First change');
    expect(v2!.body).toContain('Second change');
    expect(v2!.body).not.toContain('Old change');
  });

  it('extracts date when present', () => {
    const content = '## [3.0.0] - 2025-06-01\n\n- Change\n';
    const entries = parseChangelogMarkdown(content);
    expect(entries[0].date).toBe('2025-06-01');
  });

  it('sets date to null when not present', () => {
    const content = '## [3.0.0]\n\n- Change\n';
    const entries = parseChangelogMarkdown(content);
    expect(entries[0].date).toBeNull();
  });

  it('detects breaking changes in body text', () => {
    const content = '## [2.0.0]\n\n### Breaking Changes\n- Removed deprecated API\n\n## [1.0.0]\n\n- Minor fix\n';
    const entries = parseChangelogMarkdown(content);
    const v2 = entries.find((e) => e.version === '2.0.0');
    expect(v2!.isBreaking).toBe(true);
    expect(v2!.breakingChanges).toContain('Removed deprecated API');

    const v1 = entries.find((e) => e.version === '1.0.0');
    expect(v1!.isBreaking).toBe(false);
    expect(v1!.breakingChanges).toEqual([]);
  });

  it('returns empty array for content with no version headings', () => {
    const content = '# My Project\n\nThis is just a readme with no version headings.\n';
    const entries = parseChangelogMarkdown(content);
    expect(entries).toEqual([]);
  });

  it('sorts entries newest-first', () => {
    const content = '## [1.0.0]\n\n- First\n\n## [3.0.0]\n\n- Third\n\n## [2.0.0]\n\n- Second\n';
    const entries = parseChangelogMarkdown(content);
    expect(entries.map((e) => e.version)).toEqual(['3.0.0', '2.0.0', '1.0.0']);
  });

  it('handles multiple entries correctly', () => {
    const content = [
      '## [3.1.0] - 2025-03-01',
      '',
      '- Added feature X',
      '',
      '## [3.0.0] - 2025-02-15',
      '',
      '### Breaking Changes',
      '- Dropped Node 14 support',
      '',
      '## [2.5.0] - 2025-01-10',
      '',
      '- Bug fix Y',
      '',
    ].join('\n');

    const entries = parseChangelogMarkdown(content);
    expect(entries).toHaveLength(3);
    expect(entries[0].version).toBe('3.1.0');
    expect(entries[0].date).toBe('2025-03-01');
    expect(entries[0].isBreaking).toBe(false);

    expect(entries[1].version).toBe('3.0.0');
    expect(entries[1].date).toBe('2025-02-15');
    expect(entries[1].isBreaking).toBe(true);
    expect(entries[1].breakingChanges).toContain('Dropped Node 14 support');

    expect(entries[2].version).toBe('2.5.0');
    expect(entries[2].date).toBe('2025-01-10');
    expect(entries[2].isBreaking).toBe(false);
  });
});
