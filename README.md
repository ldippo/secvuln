# secvuln

A CLI tool for managing security vulnerability remediation in npm/yarn/pnpm projects.

## Features

- **Multi-package manager support**: Works with npm, yarn, and pnpm (auto-detected from lockfile)
- **Monorepo and workspace support**: Detects and scans all workspace packages
- **pnpm catalog support**: Resolves and updates `catalog:` references in `pnpm-workspace.yaml` instead of adding redundant overrides
- **Smart fix strategies**:
  - Patch version changes: Auto-applied with user consent (safest)
  - Minor/major version changes: Shows changelog analysis and risk assessment, requires confirmation
- **Transitive dependency handling**:
  - Checks if a parent package has a newer version that fixes the vulnerability
  - Falls back to resolutions/overrides only when no parent fix is available
- **Iterative fix-all workflow**: Fix, install, re-audit in a loop until the project is clean
- **Resolution auditing**: Detect stale, removable, or unnecessary overrides/resolutions
- **Remote changelog analysis**: Fetches GitHub releases to detect breaking changes
- **Interactive prompts**: Review each vulnerability and decide how to proceed
- **Test integration**: Run test/build commands to verify changes after fixing
- **VS Code extension auditing**: Check installed extensions for security vulnerabilities

## Requirements

- Node.js >= 18.0.0
- One of: npm, yarn, or pnpm

## Installation (from source)

Clone the repository and link it globally:

```bash
git clone <repo-url> secvuln
cd secvuln
```

**With pnpm:**
```bash
pnpm install
pnpm run build
pnpm link --global
```

**With npm:**
```bash
npm install
npm run build
npm link
```

**With yarn:**
```bash
yarn install
yarn build
yarn link
```

After linking, the `secvuln` command is available globally:

```bash
secvuln --help
```

To unlink later:
```bash
# pnpm
pnpm unlink --global secvuln

# npm
npm unlink -g secvuln

# yarn
yarn unlink
```

## Commands

### `secvuln fix`

Scan for vulnerabilities and interactively apply fixes:

```bash
secvuln fix                     # Run in current directory
secvuln fix --path /path/to/project
secvuln fix --dry-run           # Preview changes without modifying files
secvuln fix --verbose
```

Patch-level fixes are batched and can be auto-applied. Minor and major upgrades are presented individually with changelog analysis and risk assessment.

### `secvuln fix-all` (alias: `fa`)

Comprehensive iterative workflow that chains fix, install, re-audit until clean:

```bash
secvuln fix-all                 # Run the full loop
secvuln fa --max-rounds 3       # Limit to 3 fix rounds
secvuln fa --dry-run
```

**Flow:**
1. Runs `secvuln fix` interactively
2. Installs dependencies (`npm/yarn/pnpm install`)
3. Re-audits to check for remaining or newly introduced vulnerabilities
4. Prompts to run another round if vulnerabilities remain (up to `--max-rounds`, default 5)
5. When clean, prompts to run tests
6. Prompts to audit existing resolutions/overrides for staleness

### `secvuln audit-resolutions` (alias: `ar`)

Check whether existing overrides/resolutions are still necessary:

```bash
secvuln audit-resolutions       # Report only
secvuln ar --fix                # Interactively remove unnecessary resolutions
secvuln ar --verbose            # Show detailed info for each resolution
secvuln ar --json               # Machine-readable output
```

Each override is classified as:

| Status | Meaning |
|--------|---------|
| **needed** | Override is actively protecting; may include info about parent bumps that could eventually allow removal |
| **stale** | Override is still needed but can be bumped to a newer version |
| **removable** | Override can be safely deleted right now with no other changes |
| **unknown** | Cannot determine status (registry fetch failed, non-semver value, or unverifiable transitive paths) |

### `secvuln test`

Run test/build commands to verify changes:

```bash
secvuln test                    # Interactive selection of detected commands
secvuln test --all              # Run all detected test/build/lint commands
secvuln test --verbose          # Show full command output
```

Detects test, build, and lint scripts from `package.json` across all workspace packages.

### `secvuln extension` (alias: `ext`)

Check VS Code extensions for security vulnerabilities:

```bash
secvuln extension               # Interactive selection from installed extensions
secvuln ext -e esbenp.prettier-vscode   # Check a specific extension
secvuln ext --all               # Check all installed extensions
secvuln ext --verbose           # Detailed vulnerability information
```

## How It Works

### Vulnerability Detection

Runs `npm audit --json`, `yarn audit --json`, or `pnpm audit --json` (auto-detected from lockfile) and normalizes results into a unified format.

### Fix Strategy

| Scenario | Strategy |
|----------|----------|
| Direct dependency, patch fix available | Batch auto-apply |
| Direct dependency, minor/major fix | Show changelog + risk assessment, require confirmation |
| Transitive dependency, parent has fix | Suggest parent upgrade (patch/minor preferred) |
| Transitive dependency, no parent fix | Add resolution/override |
| pnpm catalog dependency | Update version in `pnpm-workspace.yaml` instead of adding override |

### Changelog Analysis

For minor and major version changes:

1. Fetches the package's repository URL from the npm registry
2. Retrieves GitHub releases between current and target versions
3. Parses release notes for breaking change indicators
4. Shows a risk assessment (low/medium/high)

Set a GitHub token for higher rate limits:

```bash
export GITHUB_TOKEN=your_token_here
```

### Resolution/Override Handling

For transitive dependencies that can't be fixed by upgrading the parent:

- **npm**: Adds to `overrides` in `package.json`
- **yarn**: Adds to `resolutions` in `package.json`
- **pnpm**: Adds to `pnpm.overrides` in `package.json`, unless the package is managed by a catalog (in which case, updates `pnpm-workspace.yaml`)

### pnpm Catalog Support

In pnpm workspaces using catalogs (`catalog:` references in `package.json`), secvuln:

- Resolves `catalog:` and `catalog:<name>` references before any semver operations
- Updates versions in `pnpm-workspace.yaml` (preserving YAML formatting and comments) rather than adding overrides
- Works with both the default catalog and named catalogs

## Development

```bash
# Install dependencies
pnpm install

# Build (TypeScript compilation)
pnpm run build

# Type check without emitting
pnpm run typecheck

# Run tests
pnpm test

# Run tests in watch mode
pnpm run test:watch

# Run in development mode (no build step)
pnpm run dev -- fix
pnpm run dev -- fix-all --path /path/to/project
```

## License

MIT
