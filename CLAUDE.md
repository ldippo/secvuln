# secvuln — Agent Team Configuration

## Project Overview

CLI tool for security vulnerability remediation in npm/yarn/pnpm projects. TypeScript, ES modules, no test framework yet.

- **Entry point:** `src/bin/secvuln.ts`
- **Commands:** `fix`, `test`, `extension` (in `src/commands/`)
- **Core modules:** `audit/`, `changelog/`, `resolver/`, `workspace/`, `vscode/` (in `src/core/`)
- **Types:** `src/types/index.ts`
- **UI:** `src/ui/` (prompts, reporter, spinners via `@clack/prompts` + `ora`)
- **Build:** `pnpm run build` (tsc)
- **No test framework configured yet** — tests need to be added

## Build & Verify

```
pnpm run build        # TypeScript compilation — MUST pass after every change
pnpm run typecheck    # Type-check without emitting
```

Always run `pnpm run build` after making changes to verify compilation.

## Conventions

- ES modules with `.js` extensions in imports (TypeScript `NodeNext` resolution)
- Strict TypeScript — no `any`, no `@ts-ignore`
- Functional style — prefer pure functions, avoid classes
- Errors: use try/catch, return null for missing data, never throw in utility functions
- File structure: barrel exports via `index.ts` in each module directory
- New modules should be exported from `src/index.ts` if they're part of the public API

## Agent Team

When working on this codebase, use these specialized agents for parallel and efficient development.

### Architect (Plan agent)

Use for: designing new features, planning refactors, evaluating trade-offs.

```
Task(subagent_type="Plan", prompt="<feature description + constraints>")
```

- Reads existing code to understand patterns before proposing changes
- Identifies all files that need modification
- Considers edge cases (npm/yarn/pnpm differences, monorepo vs single-package)
- Outputs a step-by-step implementation plan with file paths

### Explorer (Explore agent)

Use for: understanding code paths, finding usages, tracing data flow.

```
Task(subagent_type="Explore", prompt="<question about the codebase>")
```

- Quick searches: function/type usages, import chains, file discovery
- Medium: trace a feature end-to-end (e.g., "how does audit data flow from pnpm to the UI?")
- Thorough: cross-cutting concerns (e.g., "every place that reads package.json")

### Implementer (general-purpose agent, in worktree)

Use for: writing code changes that can be developed in isolation.

```
Task(subagent_type="general-purpose", isolation="worktree", prompt="<implementation task>")
```

- Use worktree isolation for changes that might conflict or need review before merging
- Always include "run `pnpm run build` to verify compilation" in the prompt
- For independent features, launch multiple implementers in parallel

### Reviewer (general-purpose agent)

Use for: code review, security audit, checking for regressions.

```
Task(subagent_type="general-purpose", prompt="Review the following changes for correctness, security issues, and adherence to project conventions: <description or diff>")
```

Review checklist:
- No `semver.coerce()` on unresolved catalog refs (must resolve first)
- Package manager differences handled (npm overrides vs yarn resolutions vs pnpm.overrides)
- Monorepo paths: never assume single package.json at root
- No hardcoded paths — use `join()` from `node:path`
- Catalog refs preserved in package.json (never overwrite `"catalog:"` with a semver range)
- YAML writes use `parseDocument` for format preservation

### Builder (haiku model for speed)

Use for: quick compilation checks.

```
Task(subagent_type="general-purpose", model="haiku", prompt="Run `pnpm run build` in /home/lyle/projects/secvuln and report any TypeScript errors. If there are errors, include the full error output.")
```

Launch this in the background after changes:
```
Task(subagent_type="general-purpose", model="haiku", run_in_background=true, prompt="...")
```

## Parallel Workflow Patterns

### New Feature

1. **Architect** — plan the feature (foreground, need results before proceeding)
2. **Implementer(s)** — implement in parallel if changes are independent (worktree for risky changes)
3. **Builder** — verify compilation (background)
4. **Reviewer** — review the diff (can run while builder runs)

### Bug Fix

1. **Explorer** — find the root cause and all affected code paths
2. **Implement** the fix directly (small fixes don't need worktree isolation)
3. **Builder** — verify compilation
4. **Explorer** — verify no other call sites are affected

### Refactor

1. **Explorer** (thorough) — find every usage of the code being refactored
2. **Architect** — plan the refactor steps to avoid breaking intermediate states
3. **Implementer(s)** — execute the plan
4. **Builder** — verify after each step

## Key Architecture Notes

### Package Manager Abstraction
Each package manager has its own audit parser (`src/core/audit/{npm,yarn,pnpm}.ts`) that normalizes to `AuditResult`. New package manager features should follow this pattern.

### Resolver Pipeline
```
Vulnerability → createDirectFixAction() or createResolutionFix()
  → FixAction { type: 'upgrade' | 'resolution' | 'skip' }
  → applyUpgrade() or applyResolution()
```

### Catalog Support (pnpm)
```
pnpm-workspace.yaml → parseCatalogs() → WorkspaceInfo.catalogs
  → resolveCatalogVersion() before any semver.coerce() call
  → updateCatalogVersion() writes YAML instead of package.json for catalog deps
```

Critical invariant: **never call `semver.coerce()` on a raw version spec that might be `"catalog:"`** — always resolve through `resolveCatalogVersion()` first.

### Workspace Detection
`detectWorkspace()` returns `WorkspaceInfo` with all packages enumerated. The `catalogs` field is populated only for pnpm workspaces that have catalog entries.
