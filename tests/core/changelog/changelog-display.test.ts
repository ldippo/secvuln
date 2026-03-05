import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChangelogAnalysis, ChangelogEntry, Vulnerability, FixAction } from '../../../src/types/index.js';

// Mock @clack/prompts before any imports that use it
vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
}));

// Mock the github module to avoid real HTTP calls
vi.mock('../../../src/core/changelog/github.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/core/changelog/github.js')>();
  return {
    ...orig,
    // Keep pure functions, mock the ones that do HTTP
    fetchGitHubReleases: vi.fn(),
    getPackageRepositoryUrl: vi.fn(),
  };
});

import { analyzeChangelog, formatChangelogForDisplay } from '../../../src/core/changelog/analyzer.js';
import { fetchGitHubReleases } from '../../../src/core/changelog/github.js';
import { displayVulnerability, promptVulnerabilityAction } from '../../../src/ui/prompts.js';
import { select } from '@clack/prompts';

const mockedFetchReleases = vi.mocked(fetchGitHubReleases);
const mockedSelect = vi.mocked(select);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeVuln(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: 'npm-123',
    title: 'Prototype Pollution',
    severity: 'high',
    packageName: 'lodash',
    currentVersion: '4.17.20',
    vulnerableVersions: '<4.17.21',
    patchedVersions: '>=4.17.21',
    recommendation: 'Upgrade to 4.17.21',
    url: 'https://github.com/advisories/GHSA-xxxx',
    cwe: ['CWE-1321'],
    cvss: 7.4,
    dependencyPath: ['lodash'],
    isDirect: true,
    rootDependency: null,
    ...overrides,
  };
}

function makeAction(overrides: Partial<FixAction> = {}): FixAction {
  return {
    type: 'upgrade',
    packageName: 'lodash',
    currentVersion: '4.17.20',
    targetVersion: '4.17.21',
    versionChangeType: 'patch',
    vulnerability: makeVuln(),
    reason: 'Upgrade to fix vulnerability',
    ...overrides,
  };
}

function makeChangelog(overrides: Partial<ChangelogAnalysis> = {}): ChangelogAnalysis {
  return {
    packageName: 'lodash',
    fromVersion: '4.17.20',
    toVersion: '4.17.21',
    entries: [
      {
        version: '4.17.21',
        date: '2021-02-20T00:00:00Z',
        body: 'Fixed prototype pollution vulnerability',
        url: 'https://github.com/lodash/lodash/releases/tag/v4.17.21',
        isBreaking: false,
        breakingChanges: [],
      },
    ],
    hasBreakingChanges: false,
    summary: 'Found 1 release(s).',
    ...overrides,
  };
}

describe('changelog display integration', () => {
  describe('analyzeChangelog fetches and produces analysis', () => {
    it('returns analysis with entries from fetched releases', async () => {
      const releases: ChangelogEntry[] = [
        {
          version: '7.6.0',
          date: '2024-04-01T00:00:00Z',
          body: 'Added new comparison API\n## Breaking Changes\n- Dropped Node 14 support',
          url: 'https://github.com/npm/node-semver/releases/tag/v7.6.0',
          isBreaking: true,
          breakingChanges: ['Dropped Node 14 support'],
        },
        {
          version: '7.5.5',
          date: '2024-03-01T00:00:00Z',
          body: 'Fixed range parsing edge case',
          url: 'https://github.com/npm/node-semver/releases/tag/v7.5.5',
          isBreaking: false,
          breakingChanges: [],
        },
      ];

      mockedFetchReleases.mockResolvedValue(releases);

      const analysis = await analyzeChangelog('semver', '7.5.4', '7.6.0');

      expect(mockedFetchReleases).toHaveBeenCalledWith('semver', '7.5.4', '7.6.0');
      expect(analysis.packageName).toBe('semver');
      expect(analysis.fromVersion).toBe('7.5.4');
      expect(analysis.toVersion).toBe('7.6.0');
      expect(analysis.entries).toHaveLength(2);
      expect(analysis.hasBreakingChanges).toBe(true);
      expect(analysis.summary).toContain('2 release(s)');
      expect(analysis.summary).toContain('breaking changes');
      expect(analysis.summary).toContain('Dropped Node 14 support');
    });

    it('returns no-breaking summary when releases are clean', async () => {
      mockedFetchReleases.mockResolvedValue([
        {
          version: '4.17.21',
          date: '2021-02-20T00:00:00Z',
          body: 'Fixed prototype pollution vulnerability',
          url: 'https://github.com/lodash/lodash/releases/tag/v4.17.21',
          isBreaking: false,
          breakingChanges: [],
        },
      ]);

      const analysis = await analyzeChangelog('lodash', '4.17.20', '4.17.21');

      expect(analysis.hasBreakingChanges).toBe(false);
      expect(analysis.entries).toHaveLength(1);
      expect(analysis.summary).toContain('No breaking changes');
    });

    it('returns empty entries with manual-check summary when no releases found', async () => {
      mockedFetchReleases.mockResolvedValue([]);

      const analysis = await analyzeChangelog('empty-pkg', '1.0.0', '2.0.0');

      expect(analysis.entries).toHaveLength(0);
      expect(analysis.summary).toContain('No changelog entries found');
      expect(analysis.summary).toContain('GitHub releases manually');
    });
  });

  describe('formatChangelogForDisplay renders content', () => {
    it('displays package name, version range, risk level, and release entries', () => {
      const analysis = makeChangelog({
        packageName: 'express',
        fromVersion: '4.18.2',
        toVersion: '4.19.0',
        entries: [
          {
            version: '4.19.0',
            date: '2024-03-20T00:00:00Z',
            body: 'Fixed path traversal',
            url: 'https://github.com/expressjs/express/releases/tag/v4.19.0',
            isBreaking: false,
            breakingChanges: [],
          },
          {
            version: '4.18.3',
            date: '2024-02-01T00:00:00Z',
            body: 'Security patch',
            url: 'https://github.com/expressjs/express/releases/tag/v4.18.3',
            isBreaking: false,
            breakingChanges: [],
          },
        ],
      });

      const output = formatChangelogForDisplay(analysis);

      expect(output).toContain('express');
      expect(output).toContain('4.18.2');
      expect(output).toContain('4.19.0');
      expect(output).toContain('MEDIUM');
      expect(output).toContain('Recent releases');
      expect(output).toContain('4.18.3');
    });

    it('displays breaking changes prominently when present', () => {
      const analysis = makeChangelog({
        packageName: 'test-pkg',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        entries: [
          {
            version: '2.0.0',
            date: '2024-06-01T00:00:00Z',
            body: 'Major rewrite',
            url: 'https://github.com/test/pkg/releases/tag/v2.0.0',
            isBreaking: true,
            breakingChanges: ['Removed deprecated API', 'Changed default export'],
          },
        ],
        hasBreakingChanges: true,
      });

      const output = formatChangelogForDisplay(analysis);

      expect(output).toContain('HIGH');
      expect(output).toContain('BREAKING CHANGES DETECTED');
      expect(output).toContain('Removed deprecated API');
      expect(output).toContain('Changed default export');
      expect(output).toContain('Version 2.0.0');
    });

    it('shows manual review message when no entries are available', () => {
      const analysis = makeChangelog({
        packageName: 'no-releases',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        entries: [],
      });

      const output = formatChangelogForDisplay(analysis);

      expect(output).toContain('no-releases');
      expect(output).toContain('No release notes available');
      expect(output).toContain('Manual review recommended');
      expect(output).not.toContain('Risk level');
      expect(output).not.toContain('Recent releases');
    });

    it('respects maxEntries limit for breaking changes', () => {
      const entries: ChangelogEntry[] = Array.from({ length: 8 }, (_, i) => ({
        version: `2.${i}.0`,
        date: '2024-01-01T00:00:00Z',
        body: `Release ${i}`,
        url: `https://github.com/test/pkg/releases/tag/v2.${i}.0`,
        isBreaking: true,
        breakingChanges: [`Breaking in ${i}`],
      }));

      const analysis = makeChangelog({
        packageName: 'many-breaking',
        fromVersion: '1.0.0',
        toVersion: '3.0.0',
        entries,
        hasBreakingChanges: true,
      });

      const output = formatChangelogForDisplay(analysis, 3);

      expect(output).toContain('and 5 more releases');
    });
  });

  describe('promptVulnerabilityAction changelog integration', () => {
    it('prints changelog content when changelog is provided', async () => {
      mockedSelect.mockResolvedValue('apply');

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });

      const vuln = makeVuln();
      const action = makeAction({ versionChangeType: 'minor' });
      const changelog = makeChangelog();

      await promptVulnerabilityAction(vuln, action, changelog);

      const joined = logs.join('\n');

      // Vulnerability info should be displayed
      expect(joined).toContain('Prototype Pollution');
      expect(joined).toContain('lodash');

      // Changelog content should be printed (formatChangelogForDisplay output)
      expect(joined).toContain('4.17.20');
      expect(joined).toContain('4.17.21');
      expect(joined).toContain('Recent releases');
    });

    it('does not say "review changelog above" when no changelog is provided for major change', async () => {
      mockedSelect.mockResolvedValue('skip');

      const vuln = makeVuln({
        packageName: 'minimatch',
        currentVersion: '3.0.4',
        isDirect: false,
        rootDependency: 'some-tool',
        dependencyPath: ['some-tool', 'minimatch'],
      });

      const action = makeAction({
        packageName: 'minimatch',
        currentVersion: '3.0.4',
        targetVersion: '5.1.0',
        versionChangeType: 'major',
        vulnerability: vuln,
      });

      // No changelog passed
      await promptVulnerabilityAction(vuln, action, undefined);

      // The version warning is in the select() message param
      const selectMessage = String((mockedSelect.mock.calls[0][0] as { message: string }).message);
      expect(selectMessage).not.toContain('review changelog above');
      expect(selectMessage).toContain('review changelog before deploying');
    });

    it('says "review changelog above" when changelog IS provided for major change', async () => {
      mockedSelect.mockResolvedValue('apply');

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });

      const vuln = makeVuln({
        packageName: 'axios',
        currentVersion: '0.21.1',
        severity: 'critical',
      });

      const action = makeAction({
        packageName: 'axios',
        currentVersion: '0.21.1',
        targetVersion: '1.6.0',
        versionChangeType: 'major',
        vulnerability: vuln,
      });

      const changelog = makeChangelog({
        packageName: 'axios',
        fromVersion: '0.21.1',
        toVersion: '1.6.0',
        entries: [
          {
            version: '1.0.0',
            date: '2023-01-01T00:00:00Z',
            body: 'Major rewrite',
            url: 'https://github.com/axios/axios/releases/tag/v1.0.0',
            isBreaking: true,
            breakingChanges: ['New API surface'],
          },
        ],
        hasBreakingChanges: true,
      });

      await promptVulnerabilityAction(vuln, action, changelog);

      // Changelog content should be printed via console.log
      const joined = logs.join('\n');
      expect(joined).toContain('BREAKING CHANGES DETECTED');
      expect(joined).toContain('New API surface');

      // The version warning referencing the changelog is in the select() message param
      const selectMessage = String((mockedSelect.mock.calls[0][0] as { message: string }).message);
      expect(selectMessage).toContain('review changelog above');
    });

    it('does not say "review changelog above" when changelog has no entries for major change', async () => {
      mockedSelect.mockResolvedValue('skip');

      const vuln = makeVuln({ packageName: 'big-lib', currentVersion: '1.0.0' });

      const action = makeAction({
        packageName: 'big-lib',
        currentVersion: '1.0.0',
        targetVersion: '2.0.0',
        versionChangeType: 'major',
        vulnerability: vuln,
      });

      // Changelog object exists but has no entries (GitHub had no releases)
      const emptyChangelog = makeChangelog({
        packageName: 'big-lib',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        entries: [],
        hasBreakingChanges: false,
      });

      await promptVulnerabilityAction(vuln, action, emptyChangelog);

      const selectMessage = String((mockedSelect.mock.calls[0][0] as { message: string }).message);
      expect(selectMessage).not.toContain('review changelog above');
      expect(selectMessage).toContain('review changelog before deploying');
    });
  });

  describe('displayVulnerability transitive dependency display', () => {
    it('shows root dependency name for transitive deps', () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });

      const vuln = makeVuln({
        isDirect: false,
        rootDependency: 'express',
        dependencyPath: ['express', 'qs'],
        packageName: 'qs',
      });

      displayVulnerability(vuln);

      const joined = logs.join('\n');
      expect(joined).toContain('Transitive dependency via:');
      expect(joined).toContain('express');
    });

    it('falls back to dependencyPath when rootDependency is null', () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });

      const vuln = makeVuln({
        isDirect: false,
        rootDependency: null,
        dependencyPath: ['webpack', 'terser'],
        packageName: 'terser',
      });

      displayVulnerability(vuln);

      const joined = logs.join('\n');
      expect(joined).toContain('Transitive dependency via:');
      expect(joined).toContain('webpack');
    });

    it('shows just "Transitive dependency" when no parent info available', () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });

      const vuln = makeVuln({
        isDirect: false,
        rootDependency: null,
        dependencyPath: ['orphan-pkg'],
        packageName: 'orphan-pkg',
      });

      displayVulnerability(vuln);

      const joined = logs.join('\n');
      expect(joined).toContain('Transitive dependency');
      expect(joined).not.toContain('via:');
    });

    it('does not show transitive info for direct dependencies', () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });

      const vuln = makeVuln({ isDirect: true, rootDependency: null });

      displayVulnerability(vuln);

      const joined = logs.join('\n');
      expect(joined).not.toContain('Transitive');
    });
  });
});
