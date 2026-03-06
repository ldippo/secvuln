import { Octokit } from '@octokit/rest';
import type { ChangelogEntry, ChangelogAnalysis } from '../../types/index.js';

// Initialize Octokit - will use GITHUB_TOKEN if available
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

/**
 * Extract GitHub owner and repo from a repository URL
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Handle various GitHub URL formats:
  // - https://github.com/owner/repo
  // - https://github.com/owner/repo.git
  // - git+https://github.com/owner/repo.git
  // - git://github.com/owner/repo.git
  // - git@github.com:owner/repo.git
  
  const patterns = [
    /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/,
    /github\.com[/:]([\w.-]+)\/([\w.-]+)$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  return null;
}

/**
 * Fetch the repository URL and optional directory from npm registry for a package
 */
export async function getPackageRepositoryUrl(packageName: string): Promise<{
  url: string;
  directory: string | null;
} | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`);
    if (!response.ok) return null;

    const data = await response.json() as {
      repository?: { url?: string; directory?: string } | string;
    };

    if (typeof data.repository === 'string') {
      return { url: data.repository, directory: null };
    }
    if (data.repository?.url) {
      return { url: data.repository.url, directory: data.repository.directory || null };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch GitHub releases for a package
 */
export async function fetchGitHubReleases(
  packageName: string,
  fromVersion?: string,
  toVersion?: string
): Promise<ChangelogEntry[]> {
  const entries: ChangelogEntry[] = [];
  
  // First, get the repository URL from npm
  const repoInfo = await getPackageRepositoryUrl(packageName);
  if (!repoInfo) {
    return entries;
  }

  const parsed = parseGitHubUrl(repoInfo.url);
  if (!parsed) {
    return entries;
  }

  try {
    // Fetch releases from GitHub
    const { data: releases } = await octokit.repos.listReleases({
      owner: parsed.owner,
      repo: parsed.repo,
      per_page: 100, // Get enough releases to cover version range
    });

    for (const release of releases) {
      // Extract version from tag name (remove 'v' prefix if present)
      const version = release.tag_name.replace(/^v/, '');
      
      // Filter to version range if specified
      if (fromVersion && toVersion) {
        if (!isVersionInRange(version, fromVersion, toVersion)) {
          continue;
        }
      }

      const body = release.body || '';
      const breakingChanges = extractBreakingChanges(body);

      entries.push({
        version,
        date: release.published_at,
        body,
        url: release.html_url,
        isBreaking: breakingChanges.length > 0,
        breakingChanges,
      });
    }

    // Sort by version descending (newest first)
    entries.sort((a, b) => compareVersions(b.version, a.version));

    if (entries.length === 0) {
      return fetchChangelogFile(parsed.owner, parsed.repo, fromVersion, toVersion, repoInfo.directory);
    }

    return entries;
  } catch (error) {
    // API rate limit or other error
    console.error(`Failed to fetch releases for ${packageName}:`, error);
    return entries;
  }
}

/**
 * Check if a version is within a range (exclusive of fromVersion, inclusive of toVersion)
 */
function isVersionInRange(version: string, fromVersion: string, toVersion: string): boolean {
  const v = parseVersion(version);
  const from = parseVersion(fromVersion);
  const to = parseVersion(toVersion);
  
  if (!v || !from || !to) return false;
  
  // version > fromVersion && version <= toVersion
  return compareVersions(version, fromVersion) > 0 && compareVersions(version, toVersion) <= 0;
}

/**
 * Parse a semver version string
 */
function parseVersion(version: string): number[] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

/**
 * Compare two versions (-1, 0, 1)
 */
function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  
  if (!va || !vb) return 0;
  
  for (let i = 0; i < 3; i++) {
    if (va[i] > vb[i]) return 1;
    if (va[i] < vb[i]) return -1;
  }
  
  return 0;
}

/**
 * Extract breaking changes from release notes
 */
export function extractBreakingChanges(body: string): string[] {
  const breakingChanges: string[] = [];
  const lines = body.split('\n');
  
  let inBreakingSection = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check for breaking change section headers
    if (/^#+\s*(breaking\s*changes?|⚠️\s*breaking)/i.test(trimmed)) {
      inBreakingSection = true;
      continue;
    }
    
    // Check for other section headers (end breaking section)
    if (/^#+\s+/.test(trimmed) && inBreakingSection) {
      inBreakingSection = false;
      continue;
    }
    
    // Collect items in breaking section
    if (inBreakingSection && trimmed.startsWith('-')) {
      breakingChanges.push(trimmed.substring(1).trim());
      continue;
    }
    
    // Also check for inline breaking change markers
    if (/breaking\s*change/i.test(trimmed) && !inBreakingSection) {
      breakingChanges.push(trimmed);
    }
  }
  
  return breakingChanges;
}

/**
 * Parse a markdown changelog file into structured entries
 */
export function parseChangelogMarkdown(content: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const lines = content.split('\n');

  // Match headings like: ## [1.2.3], ## [1.2.3] - 2024-01-15, ## 1.2.3, ## v1.2.3, # 1.2.3, # [1.2.3]
  const headingPattern = /^#{1,2}\s+\[?v?(\d+\.\d+\.\d+[^\]\s]*)\]?(?:\s*[-–(]\s*(\d{4}-\d{2}-\d{2}))?/;

  let currentVersion: string | null = null;
  let currentDate: string | null = null;
  let currentBodyLines: string[] = [];

  const pushEntry = () => {
    if (currentVersion) {
      const body = currentBodyLines.join('\n').trim();
      const breakingChanges = extractBreakingChanges(body);
      entries.push({
        version: currentVersion,
        date: currentDate,
        body,
        url: '',
        isBreaking: breakingChanges.length > 0,
        breakingChanges,
      });
    }
  };

  for (const line of lines) {
    const match = line.match(headingPattern);
    if (match) {
      pushEntry();
      currentVersion = match[1];
      currentDate = match[2] || null;
      currentBodyLines = [];
    } else if (currentVersion) {
      currentBodyLines.push(line);
    }
  }

  // Push the last entry
  pushEntry();

  // Sort newest first
  entries.sort((a, b) => compareVersions(b.version, a.version));

  return entries;
}

/**
 * Fetch and parse a CHANGELOG.md file from GitHub as a fallback.
 * Tries common changelog filenames (case-sensitive on GitHub API)
 * and supports monorepo directory prefixes from npm registry.
 */
async function fetchChangelogFile(
  owner: string,
  repo: string,
  fromVersion?: string,
  toVersion?: string,
  directory?: string | null
): Promise<ChangelogEntry[]> {
  const filenames = [
    'CHANGELOG.md',
    'changelog.md',
    'Changelog.md',
    'CHANGELOG',
    'CHANGES.md',
    'changes.md',
    'HISTORY.md',
    'History.md',
    'history.md',
  ];

  for (const filename of filenames) {
    try {
      const filePath = directory ? `${directory}/${filename}` : filename;
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: filePath,
      });

      const fileData = data as { content: string };
      const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
      let entries = parseChangelogMarkdown(content);
      if (fromVersion && toVersion) {
        entries = entries.filter((entry) =>
          isVersionInRange(entry.version, fromVersion, toVersion)
        );
      }

      entries.sort((a, b) => compareVersions(b.version, a.version));

      return entries;
    } catch {
      // File not found or other error, try next filename
      continue;
    }
  }

  return [];
}

/**
 * Detect if release notes indicate breaking changes
 */
export function hasBreakingChangeIndicators(body: string): boolean {
  const indicators = [
    /breaking\s*change/i,
    /\bBREAKING\b/,
    /⚠️/,
    /major\s*version/i,
    /incompatible/i,
    /migration\s*required/i,
    /deprecated.*removed/i,
  ];

  return indicators.some((pattern) => pattern.test(body));
}
