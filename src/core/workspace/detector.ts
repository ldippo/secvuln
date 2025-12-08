import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import type { PackageManager, WorkspaceInfo, WorkspacePackage } from '../../types/index.js';
import { detectPackageManager } from '../package-manager.js';

/**
 * Parse a package.json file and extract relevant information
 */
function parsePackageJson(packageJsonPath: string): WorkspacePackage | null {
  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return {
      name: pkg.name || basename(dirname(packageJsonPath)),
      path: dirname(packageJsonPath),
      packageJsonPath,
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
    };
  } catch {
    return null;
  }
}

/**
 * Get workspace patterns from package.json or pnpm-workspace.yaml
 */
function getWorkspacePatterns(rootPath: string, pm: PackageManager): string[] {
  // Check pnpm-workspace.yaml first for pnpm
  if (pm === 'pnpm') {
    const pnpmWorkspacePath = join(rootPath, 'pnpm-workspace.yaml');
    if (existsSync(pnpmWorkspacePath)) {
      const content = readFileSync(pnpmWorkspacePath, 'utf-8');
      // Simple YAML parsing for packages array
      const match = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (match) {
        return match[1]
          .split('\n')
          .filter(Boolean)
          .map((line) => line.replace(/^\s+-\s+['"]?([^'"]+)['"]?\s*$/, '$1').trim())
          .filter(Boolean);
      }
    }
  }

  // Check package.json workspaces field
  const packageJsonPath = join(rootPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const content = readFileSync(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      
      if (pkg.workspaces) {
        // Handle both array format and object format
        if (Array.isArray(pkg.workspaces)) {
          return pkg.workspaces;
        }
        if (pkg.workspaces.packages && Array.isArray(pkg.workspaces.packages)) {
          return pkg.workspaces.packages;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return [];
}

/**
 * Simple glob pattern matching for workspace patterns
 * Handles patterns like "packages/*" and "apps/**"
 */
function matchWorkspacePattern(rootPath: string, pattern: string): string[] {
  const results: string[] = [];
  
  // Normalize pattern - remove trailing /* or /**
  const basePattern = pattern.replace(/\/\*\*?$/, '');
  const basePath = join(rootPath, basePattern);
  
  if (!existsSync(basePath)) {
    return results;
  }
  
  try {
    const entries = readdirSync(basePath);
    
    for (const entry of entries) {
      const entryPath = join(basePath, entry);
      const packageJsonPath = join(entryPath, 'package.json');
      
      // Check if it's a directory with a package.json
      if (statSync(entryPath).isDirectory() && existsSync(packageJsonPath)) {
        results.push(entryPath);
      }
    }
  } catch {
    // Directory read failed, skip
  }
  
  return results;
}

/**
 * Expand glob patterns to actual package paths
 */
function expandWorkspacePatterns(
  rootPath: string,
  patterns: string[]
): string[] {
  const packagePaths: string[] = [];

  for (const pattern of patterns) {
    const matches = matchWorkspacePattern(rootPath, pattern);
    for (const match of matches) {
      if (!packagePaths.includes(match)) {
        packagePaths.push(match);
      }
    }
  }

  return packagePaths;
}

/**
 * Detect workspace configuration and enumerate all packages
 */
export async function detectWorkspace(rootPath: string): Promise<WorkspaceInfo> {
  const pm = detectPackageManager(rootPath);
  const patterns = getWorkspacePatterns(rootPath, pm);
  
  const packages: WorkspacePackage[] = [];
  
  // Always include root package
  const rootPackage = parsePackageJson(join(rootPath, 'package.json'));
  if (rootPackage) {
    packages.push(rootPackage);
  }

  if (patterns.length > 0) {
    // This is a monorepo, find all workspace packages
    const packagePaths = expandWorkspacePatterns(rootPath, patterns);
    
    for (const pkgPath of packagePaths) {
      const pkg = parsePackageJson(join(pkgPath, 'package.json'));
      if (pkg && pkg.path !== rootPath) {
        packages.push(pkg);
      }
    }
  }

  return {
    isMonorepo: patterns.length > 0,
    rootPath,
    packages,
    packageManager: pm,
  };
}

/**
 * Find the root of a project (walk up until we find a lockfile or root package.json)
 */
export function findProjectRoot(startPath: string): string {
  let currentPath = startPath;
  
  while (currentPath !== '/') {
    // Check for lockfiles
    if (
      existsSync(join(currentPath, 'package-lock.json')) ||
      existsSync(join(currentPath, 'yarn.lock')) ||
      existsSync(join(currentPath, 'pnpm-lock.yaml'))
    ) {
      return currentPath;
    }
    
    // Check for root-level package.json (one without being in node_modules)
    const packageJsonPath = join(currentPath, 'package.json');
    if (existsSync(packageJsonPath) && !currentPath.includes('node_modules')) {
      // Check if this has workspaces (indicating it's a root)
      try {
        const content = readFileSync(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content);
        if (pkg.workspaces) {
          return currentPath;
        }
      } catch {
        // Continue searching
      }
    }
    
    currentPath = dirname(currentPath);
  }
  
  return startPath;
}
