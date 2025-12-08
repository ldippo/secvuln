import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Severity } from '../../types/index.js';

/**
 * VS Code extension metadata from the marketplace
 */
export interface ExtensionInfo {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  repository: string | null;
  homepage: string | null;
}

/**
 * Extension vulnerability summary
 */
export interface ExtensionVulnerabilitySummary {
  extension: ExtensionInfo;
  repositoryFound: boolean;
  auditRan: boolean;
  vulnerabilities: {
    total: number;
    bySeverity: Record<Severity, number>;
  };
  rawAuditOutput: string | null;
  error: string | null;
}

/**
 * Get list of installed VS Code extensions
 */
export function getInstalledExtensions(): string[] {
  try {
    const output = execSync('code --list-extensions', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    // Try code-insiders if regular code command fails
    try {
      const output = execSync('code-insiders --list-extensions', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}

/**
 * Fetch extension metadata from VS Code Marketplace
 */
export async function fetchExtensionInfo(extensionId: string): Promise<ExtensionInfo | null> {
  const [publisher, name] = extensionId.split('.');
  
  if (!publisher || !name) {
    return null;
  }

  try {
    // Use the VS Code Marketplace API with more flags to get all properties
    const response = await fetch(
      'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json;api-version=6.0-preview.1',
        },
        body: JSON.stringify({
          filters: [
            {
              criteria: [
                { filterType: 7, value: extensionId },
              ],
            },
          ],
          flags: 0x200 | 0x100 | 0x80 | 0x20 | 0x10 | 0x1, // Include all available data
        }),
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      results: Array<{
        extensions: Array<{
          extensionId: string;
          extensionName: string;
          displayName: string;
          publisher: { publisherName: string };
          versions: Array<{
            version: string;
            properties: Array<{ key: string; value: string }>;
          }>;
          shortDescription: string;
        }>;
      }>;
    };

    const extension = data.results?.[0]?.extensions?.[0];
    if (!extension) {
      return null;
    }

    // Extract repository URL from properties
    const latestVersion = extension.versions?.[0];
    const properties = latestVersion?.properties || [];
    
    // Try multiple property keys for repository
    const repoKeys = [
      'Microsoft.VisualStudio.Services.Links.Source',
      'Microsoft.VisualStudio.Services.Links.GitHub',
      'Microsoft.VisualStudio.Services.Links.Repository',
    ];
    
    let repository: string | null = null;
    for (const key of repoKeys) {
      const prop = properties.find((p) => p.key === key);
      if (prop?.value) {
        repository = prop.value;
        break;
      }
    }
    
    const homepageProperty = properties.find(
      (p) => p.key === 'Microsoft.VisualStudio.Services.Links.Homepage'
    );
    
    // If no explicit repo, try to infer from homepage or common GitHub patterns
    if (!repository && homepageProperty?.value) {
      const homepage = homepageProperty.value;
      if (homepage.includes('github.com')) {
        repository = homepage;
      }
    }
    
    // Try inferring from publisher name for well-known publishers
    if (!repository) {
      repository = inferRepositoryFromExtension(publisher, name);
    }

    return {
      id: extensionId,
      name: extension.extensionName,
      displayName: extension.displayName,
      publisher: extension.publisher.publisherName,
      version: latestVersion?.version || 'unknown',
      description: extension.shortDescription || '',
      repository,
      homepage: homepageProperty?.value || null,
    };
  } catch {
    return null;
  }
}

/**
 * Infer GitHub repository from well-known extension publishers
 */
function inferRepositoryFromExtension(publisher: string, name: string): string | null {
  // Map of well-known publishers to their GitHub organizations
  const publisherToGitHub: Record<string, string> = {
    'esbenp': 'prettier',
    'dbaeumer': 'microsoft',
    'ms-vscode': 'microsoft/vscode',
    'ms-python': 'microsoft/vscode-python',
    'ms-azuretools': 'microsoft',
    'redhat': 'redhat-developer',
    'golang': 'golang',
    'rust-lang': 'rust-lang',
    'formulahendry': 'formulahendry',
    'eamodio': 'gitkraken',
    'streetsidesoftware': 'streetsidesoftware',
  };

  // Common repo patterns for known extensions
  const knownRepos: Record<string, string> = {
    'esbenp.prettier-vscode': 'https://github.com/prettier/prettier-vscode',
    'dbaeumer.vscode-eslint': 'https://github.com/microsoft/vscode-eslint',
    'ms-vscode.vscode-typescript-next': 'https://github.com/microsoft/vscode',
    'redhat.vscode-yaml': 'https://github.com/redhat-developer/vscode-yaml',
    'golang.go': 'https://github.com/golang/vscode-go',
    'rust-lang.rust-analyzer': 'https://github.com/rust-lang/rust-analyzer',
    'streetsidesoftware.code-spell-checker': 'https://github.com/streetsidesoftware/vscode-spell-checker',
    'eamodio.gitlens': 'https://github.com/gitkraken/vscode-gitlens',
    'formulahendry.auto-rename-tag': 'https://github.com/formulahendry/vscode-auto-rename-tag',
    'formulahendry.auto-close-tag': 'https://github.com/formulahendry/vscode-auto-close-tag',
    'bradlc.vscode-tailwindcss': 'https://github.com/tailwindlabs/tailwindcss-intellisense',
    'astro-build.astro-vscode': 'https://github.com/withastro/language-tools',
    'svelte.svelte-vscode': 'https://github.com/sveltejs/language-tools',
    'vue.volar': 'https://github.com/vuejs/language-tools',
    'biomejs.biome': 'https://github.com/biomejs/biome',
  };

  const fullId = `${publisher}.${name}`;
  
  // Check if we have a known repo for this exact extension
  if (knownRepos[fullId]) {
    return knownRepos[fullId];
  }

  // Try to construct a likely repo URL based on publisher
  const githubOrg = publisherToGitHub[publisher];
  if (githubOrg) {
    return `https://github.com/${githubOrg}/vscode-${name}`;
  }

  return null;
}

/**
 * Extract GitHub repo URL from various URL formats
 */
export function extractGitHubRepo(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null;

  // Handle various GitHub URL formats
  const patterns = [
    /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/,
    /github\.com[/:]([\w.-]+)\/([\w.-]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  }

  return null;
}

/**
 * Clone a repository and run npm audit on it
 */
export async function auditRepository(
  repoUrl: string
): Promise<{ success: boolean; output: string; vulnerabilities: Record<Severity, number> }> {
  const tempDir = mkdtempSync(join(tmpdir(), 'secvuln-'));
  
  try {
    // Clone the repository (shallow clone for speed)
    execSync(`git clone --depth 1 ${repoUrl} ${tempDir}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Check if package.json exists
    if (!existsSync(join(tempDir, 'package.json'))) {
      return {
        success: false,
        output: 'No package.json found in repository',
        vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
      };
    }

    // Install dependencies (needed for accurate audit)
    try {
      execSync('npm install --package-lock-only --ignore-scripts', {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // Continue anyway, audit might still work
    }

    // Run npm audit
    let auditOutput: string;
    try {
      auditOutput = execSync('npm audit --json', {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      // npm audit exits with non-zero when vulnerabilities are found
      auditOutput = (err as { stdout?: string }).stdout || '';
    }

    // Parse audit output
    const vulnerabilities = parseAuditOutput(auditOutput);

    return {
      success: true,
      output: auditOutput,
      vulnerabilities,
    };
  } catch (err) {
    return {
      success: false,
      output: err instanceof Error ? err.message : String(err),
      vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
    };
  } finally {
    // Cleanup
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Parse npm audit JSON output to extract vulnerability counts
 */
function parseAuditOutput(output: string): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    info: 0,
  };

  try {
    const data = JSON.parse(output) as {
      metadata?: {
        vulnerabilities?: Record<string, number>;
      };
    };

    if (data.metadata?.vulnerabilities) {
      const vulns = data.metadata.vulnerabilities;
      counts.critical = vulns.critical || 0;
      counts.high = vulns.high || 0;
      counts.moderate = vulns.moderate || 0;
      counts.low = vulns.low || 0;
      counts.info = vulns.info || 0;
    }
  } catch {
    // Failed to parse, return zeros
  }

  return counts;
}

/**
 * Check a single extension for vulnerabilities
 */
export async function checkExtension(extensionId: string): Promise<ExtensionVulnerabilitySummary> {
  // Fetch extension info
  const info = await fetchExtensionInfo(extensionId);

  if (!info) {
    return {
      extension: {
        id: extensionId,
        name: extensionId.split('.')[1] || extensionId,
        displayName: extensionId,
        publisher: extensionId.split('.')[0] || 'unknown',
        version: 'unknown',
        description: '',
        repository: null,
        homepage: null,
      },
      repositoryFound: false,
      auditRan: false,
      vulnerabilities: {
        total: 0,
        bySeverity: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
      },
      rawAuditOutput: null,
      error: 'Failed to fetch extension information from marketplace',
    };
  }

  // Try to find GitHub repository
  const repoUrl = info.repository || info.homepage;
  const githubRepo = extractGitHubRepo(repoUrl);

  if (!githubRepo) {
    return {
      extension: info,
      repositoryFound: false,
      auditRan: false,
      vulnerabilities: {
        total: 0,
        bySeverity: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
      },
      rawAuditOutput: null,
      error: 'No GitHub repository found for this extension',
    };
  }

  // Clone and audit the repository
  const gitUrl = `https://github.com/${githubRepo.owner}/${githubRepo.repo}.git`;
  const auditResult = await auditRepository(gitUrl);

  const total = Object.values(auditResult.vulnerabilities).reduce((a, b) => a + b, 0);

  return {
    extension: info,
    repositoryFound: true,
    auditRan: auditResult.success,
    vulnerabilities: {
      total,
      bySeverity: auditResult.vulnerabilities,
    },
    rawAuditOutput: auditResult.output,
    error: auditResult.success ? null : auditResult.output,
  };
}
