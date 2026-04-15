# CI/CD, Release Automation & Docker Publishing

## Goal

Automate the build-test-release-publish pipeline for the Actual Budget MCP server using GitHub Actions, conventional commits, semantic versioning via release-please, and multi-arch Docker image publishing to GitHub Container Registry (ghcr.io).

## Architecture

Two GitHub Actions workflows with clear separation of concerns:

1. **CI** (`ci.yml`) — validates every code change via lint, test, and build
2. **Release** (`release.yml`) — automates versioning, changelog, GitHub releases, and Docker image publishing

Conventional commit messages are enforced locally via commitlint + husky and drive the automated version bumping.

## Workflow 1: CI (`ci.yml`)

**Triggers:** Pull requests to `main`, pushes to `main`.

**Three parallel jobs:**

### Job: lint
- Checkout, setup Node 22 with `cache: 'npm'`, `npm ci`
- Run `npm run lint` (ESLint strict + TypeScript type check)
- Timeout: 10 minutes

### Job: test
- Checkout, setup Node 22 with `cache: 'npm'`, `npm ci`
- Run `npm test` (vitest, 58 tests)
- Timeout: 10 minutes

### Job: build
- Checkout, setup Node 22 with `cache: 'npm'`, `npm ci`
- Run `npm run build` (TypeScript compilation via `tsconfig.build.json`)
- Timeout: 10 minutes

**Permissions:** `contents: read` only.

## Workflow 2: Release (`release.yml`)

**Trigger:** Push to `main`.

### Job 1: release-please
- Uses `googleapis/release-please-action@v4` with `release-type: node`
- Scans conventional commit history since last release
- Creates or updates a "Release PR" with version bump and changelog
- When the Release PR is merged, creates a GitHub release and git tag
- Outputs: `release_created`, `tag_name`, `major`, `minor`, `patch`

### Job 2: docker (conditional — runs only if `release_created`)
- Depends on `release-please` job
- Checkout code at the release tag
- Setup Docker Buildx for multi-arch builds
- Login to ghcr.io using `GITHUB_TOKEN` (no PAT needed)
- `docker/metadata-action@v5` generates tags:
  - `ghcr.io/<owner>/actual-budget-mcp:v1.2.3` (immutable semver)
  - `ghcr.io/<owner>/actual-budget-mcp:v1.2` (floating minor)
  - `ghcr.io/<owner>/actual-budget-mcp:v1` (floating major)
  - `ghcr.io/<owner>/actual-budget-mcp:latest`
- `docker/build-push-action@v6` builds for `linux/amd64` and `linux/arm64`, pushes all tags

**Permissions:** `contents: write`, `pull-requests: write`, `packages: write`.

## Conventional Commits Enforcement

### commitlint
- Package: `@commitlint/cli` + `@commitlint/config-conventional`
- Config file: `commitlint.config.js` at repo root
- Standard types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ci`, `perf`, `build`
- Enforces: type required, subject required, no empty subject

### Husky commit-msg hook
- File: `.husky/commit-msg`
- Runs `npx --no -- commitlint --edit "$1"` on every commit
- Catches invalid commit messages before they're pushed

### How it drives releases
- `feat:` commits → minor version bump (0.1.0 → 0.2.0)
- `fix:` commits → patch version bump (0.1.0 → 0.1.1)
- `feat!:` or `BREAKING CHANGE:` → major version bump (0.1.0 → 1.0.0)
- Other types (`chore`, `docs`, `ci`, etc.) → no version bump, no release

## Docker Compose

### Development (`docker/docker-compose.yml`)
Existing file. Uses `build: ../` for local development builds. No changes needed.

### Production (`docker/docker-compose.production.yml`)
New file showing users how to deploy with the published GHCR image:

```yaml
services:
  actual-budget:
    image: actualbudget/actual-server:latest
    # ...

  actual-http-api:
    image: jhonderson/actual-http-api:latest
    # ...

  actual-mcp:
    image: ghcr.io/<owner>/actual-budget-mcp:latest
    # ... same env vars and config as dev compose
```

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `.github/workflows/ci.yml` | Create | CI pipeline |
| `.github/workflows/release.yml` | Create | Release + Docker publish |
| `commitlint.config.js` | Create | Conventional commit rules |
| `.husky/commit-msg` | Create | Git hook for commitlint |
| `docker/docker-compose.production.yml` | Create | Production deployment example |
| `package.json` | Modify | Add commitlint devDependencies |

## Dependencies to Add (devDependencies)

- `@commitlint/cli` — commit message linter
- `@commitlint/config-conventional` — conventional commits ruleset

## No npm Publishing

This project is a Docker-deployed MCP server, not an npm library. The release workflow creates GitHub releases and Docker images only — no `npm publish` step.
