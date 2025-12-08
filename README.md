# secvuln

A CLI tool for managing security vulnerability remediation in npm/yarn/pnpm projects.

## Features

- **Multi-package manager support**: Works with npm, yarn, and pnpm
- **Monorepo support**: Detects and scans all workspace packages
- **Smart fix strategies**:
  - Patch version changes: Auto-applied (safest)
  - Minor version changes: Shows changelog summary, auto-applies if no breaking changes detected
  - Major version changes: Shows full changelog analysis, requires explicit confirmation
- **Transitive dependency handling**:
  - Checks if parent package has a newer version that fixes the vulnerability
  - Falls back to resolutions/overrides if no parent fix available
- **Remote changelog analysis**: Fetches GitHub releases to detect breaking changes
- **Interactive prompts**: Review each vulnerability and decide how to proceed
- **Test integration**: Run test/build commands to verify changes didn't break anything
- **Comprehensive reporting**: Severity-grouped summaries of actions taken
- **VS Code extension auditing**: Check installed extensions for security vulnerabilities

## Installation

```bash
npm install -g secvuln
```

Or run directly with npx:

```bash
npx secvuln fix
```

## Usage

### Fix Command

Scan for vulnerabilities and interactively apply fixes:

```bash
# Run in current directory
secvuln fix

# Run on a specific path
secvuln fix --path /path/to/project

# Dry run - see what would be changed without modifying files
secvuln fix --dry-run

# Verbose output
secvuln fix --verbose
```

### Test Command

Run test/build commands to verify changes:

```bash
# Interactive selection of test commands
secvuln test

# Run all detected test commands
secvuln test --all

# Verbose output showing full command output
secvuln test --verbose
```

### Extension Command

Check VS Code extensions for security vulnerabilities:

```bash
# Interactive selection from installed extensions
secvuln extension
# or use the alias
secvuln ext

# Check a specific extension by ID
secvuln ext -e esbenp.prettier-vscode

# Check all installed extensions
secvuln ext --all

# Verbose output showing detailed vulnerability information
secvuln ext -e dbaeumer.vscode-eslint --verbose
```

## How It Works

### 1. Vulnerability Detection

The tool runs `npm audit`, `yarn audit`, or `pnpm audit` (auto-detected based on lockfile) and normalizes the results into a unified format.

### 2. Fix Strategy Selection

For each vulnerability, the tool determines the best fix strategy:

| Scenario | Strategy |
|----------|----------|
| Direct dependency, patch fix available | Auto-apply |
| Direct dependency, minor fix available | Check changelog, auto-apply if safe |
| Direct dependency, major fix required | Show changelog, require confirmation |
| Transitive dependency, parent has fix | Suggest parent upgrade |
| Transitive dependency, no parent fix | Add resolution/override |

### 3. Changelog Analysis

For minor and major version changes, the tool:

1. Fetches the package's repository URL from npm registry
2. Retrieves GitHub releases between current and target versions
3. Parses release notes for breaking change indicators
4. Shows a risk assessment (low/medium/high)

### 4. Resolution/Override Generation

For transitive dependencies that can't be fixed by upgrading the parent:

- **npm**: Adds to `overrides` in package.json
- **yarn**: Adds to `resolutions` in package.json  
- **pnpm**: Adds to `pnpm.overrides` in package.json

### 5. Test Verification

After applying fixes, run the test command to:

1. Detect test/build commands in package.json scripts
2. Select which commands to run
3. Execute commands and report results

### 6. VS Code Extension Auditing

The extension command checks your VS Code extensions for vulnerabilities:

1. Lists installed extensions via the `code` CLI
2. Fetches extension metadata from the VS Code Marketplace
3. Locates the extension's GitHub repository (from marketplace metadata or known mappings)
4. Clones the repository and runs `npm audit`
5. Reports any vulnerabilities found in the extension's dependencies

This helps identify security risks in your development environment beyond just your project dependencies.

## Configuration

### GitHub Token (Optional)

For better changelog fetching (higher rate limits), set a GitHub token:

```bash
export GITHUB_TOKEN=your_token_here
```

## Example Session

```
$ secvuln fix

┌   secvuln - Security Vulnerability Remediation 
│
◇  Detecting workspace configuration
│
●  Package manager: npm
●  Monorepo: Yes
●  Packages found: 5

◇  Running security audit

Vulnerability Summary:
────────────────────────────────────────
   CRITICAL  2
  HIGH: 3
  MODERATE: 8
  LOW: 1
────────────────────────────────────────
  Total: 14 vulnerabilities

◇  Found 6 patch-level fixes. Auto-apply all patch fixes? Yes

✓ Applied 6 patch-level fixes

 CRITICAL  Prototype Pollution in lodash
  Package: lodash@4.17.15
  Vulnerable: <4.17.21
  Patched: >=4.17.21

📦 lodash: 4.17.15 → 4.17.21
──────────────────────────────────────────────────
  Risk level: 🟢 LOW

  ✓ No breaking changes detected in release notes.

? Suggested: Upgrade lodash to 4.17.21
> Apply fix (PATCH change)
  Skip this vulnerability
  Skip all remaining vulnerabilities

...

════════════════════════════════════════════════════════════
  FIX SUMMARY
════════════════════════════════════════════════════════════

  Packages scanned: 5
  Duration: 12.3s

  Actions Taken:
    ✓ Upgrades applied: 10
    ✓ Resolutions added: 2
    ○ Skipped: 2

════════════════════════════════════════════════════════════

  Next Steps:
    1. Run `secvuln test` to verify changes
    2. Review any major version upgrades
    3. Commit changes if tests pass
```

## Extension Audit Example

```
$ secvuln ext -e esbenp.prettier-vscode -v

┌   secvuln - Security Vulnerability Remediation 
│
●  Checking 1 extension(s)...
│
◇  ✓ Checking esbenp.prettier-vscode

────────────────────────────────────────────────────────────
  Prettier - Code formatter
  esbenp.prettier-vscode v11.0.2
────────────────────────────────────────────────────────────
  Code formatter using prettier
  Repository: https://github.com/prettier/prettier-vscode.git

  ⚠ Found 1 vulnerabilities:

    HIGH: 1

════════════════════════════════════════════════════════════
  EXTENSION SECURITY SUMMARY
════════════════════════════════════════════════════════════

  Extensions checked: 1
  With GitHub repository: 1
  Clean (no vulnerabilities): 0
  With vulnerabilities: 1

  Extensions with vulnerabilities:
    • Prettier - Code formatter (1 issues)

════════════════════════════════════════════════════════════
│
▲  1 extension(s) have known vulnerabilities
│
└  Done! Remember to run tests to verify changes.
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- fix

# Type check
npm run typecheck

# Build
npm run build
```

## License

MIT
