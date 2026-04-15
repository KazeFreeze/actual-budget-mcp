# CI/CD, Release Automation & Docker Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate build/test/release/publish pipeline with GitHub Actions, conventional commits, release-please, and multi-arch Docker images on ghcr.io.

**Architecture:** Two GitHub Actions workflows (CI + Release). Conventional commits enforced locally via commitlint + husky commit-msg hook. release-please creates Release PRs from commit history; merging a Release PR triggers Docker multi-arch build and push to GHCR.

**Tech Stack:** GitHub Actions, release-please, docker/build-push-action, docker/metadata-action, commitlint, husky

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `.github/workflows/ci.yml` | Create | CI pipeline: lint, test, build on PRs and main |
| `.github/workflows/release.yml` | Create | release-please + Docker build/push to GHCR |
| `commitlint.config.js` | Create | Conventional commit rules config |
| `.husky/commit-msg` | Create | Git hook running commitlint |
| `docker/docker-compose.production.yml` | Create | Production deployment example with GHCR image |
| `package.json` | Modify | Add commitlint devDependencies |

---

### Task 1: CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the CI workflow file**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  lint:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  test:
    name: Test
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npm test

  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npm run build
```

- [ ] **Step 2: Validate the workflow YAML syntax**

Run: `npx yaml-lint .github/workflows/ci.yml || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: No errors (valid YAML)

- [ ] **Step 3: Verify the scripts referenced exist**

Run: `npm run lint --dry-run 2>&1 | head -1 && npm test --dry-run 2>&1 | head -1 && npm run build --dry-run 2>&1 | head -1`
Expected: All three scripts resolve without "missing script" errors

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add CI workflow with lint, test, and build jobs"
```

---

### Task 2: Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the release workflow file**

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  packages: write

jobs:
  release-please:
    name: Release Please
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
      major: ${{ steps.release.outputs.major }}
      minor: ${{ steps.release.outputs.minor }}
      patch: ${{ steps.release.outputs.patch }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          release-type: node

  docker:
    name: Build & Push Docker Image
    runs-on: ubuntu-latest
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created == 'true' }}
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern=v{{version}},value=${{ needs.release-please.outputs.tag_name }}
            type=semver,pattern=v{{major}}.{{minor}},value=${{ needs.release-please.outputs.tag_name }}
            type=semver,pattern=v{{major}},value=${{ needs.release-please.outputs.tag_name }}
            type=raw,value=latest

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Validate the workflow YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('Valid YAML')"`
Expected: `Valid YAML`

- [ ] **Step 3: Verify Dockerfile exists and builds locally**

Run: `test -f Dockerfile && echo "Dockerfile exists" && head -1 Dockerfile`
Expected: `Dockerfile exists` and `FROM node:22-alpine AS builder`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow with release-please and Docker publishing"
```

---

### Task 3: Commitlint Setup

**Files:**
- Modify: `package.json` (add devDependencies)
- Create: `commitlint.config.js`
- Create: `.husky/commit-msg`

- [ ] **Step 1: Install commitlint packages**

Run: `npm install -D @commitlint/cli @commitlint/config-conventional`
Expected: Packages added to `devDependencies` in `package.json`

- [ ] **Step 2: Create commitlint config**

```javascript
export default { extends: ['@commitlint/config-conventional'] };
```

- [ ] **Step 3: Create the husky commit-msg hook**

```bash
npx --no -- commitlint --edit "$1"
```

Make the hook executable:

Run: `chmod +x .husky/commit-msg`

- [ ] **Step 4: Verify commitlint rejects bad messages**

Run: `echo "bad message" | npx commitlint`
Expected: Exit code 1 with error about type

- [ ] **Step 5: Verify commitlint accepts good messages**

Run: `echo "feat: add new feature" | npx commitlint`
Expected: Exit code 0 (no errors)

- [ ] **Step 6: Verify the hook runs on commit**

Run: `git commit --allow-empty -m "bad message" 2>&1`
Expected: Commit rejected by commitlint hook

Run: `git commit --allow-empty -m "chore: test commitlint hook" 2>&1`
Expected: Commit succeeds

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json commitlint.config.js .husky/commit-msg
git commit -m "chore: add commitlint with conventional commits enforcement"
```

---

### Task 4: Production Docker Compose

**Files:**
- Create: `docker/docker-compose.production.yml`

- [ ] **Step 1: Create the production compose file**

```yaml
# Production deployment using published GHCR image.
# Copy to your server and configure .env with your secrets.
#
# Usage:
#   cp .env.example .env
#   # Edit .env with your values
#   docker compose -f docker/docker-compose.production.yml up -d

services:
  actual-budget:
    image: actualbudget/actual-server:latest
    ports:
      - "5006:5006"
    volumes:
      - actual-data:/data
    restart: unless-stopped
    networks:
      - actual-network

  actual-http-api:
    image: jhonderson/actual-http-api:latest
    environment:
      - ACTUAL_SERVER_URL=http://actual-budget:5006
      - ACTUAL_SERVER_PASSWORD=${ACTUAL_SERVER_PASSWORD}
      - API_KEY=${API_KEY}
    depends_on:
      - actual-budget
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5007/v1/actualhttpapiversion"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped
    networks:
      - actual-network

  actual-mcp:
    image: ghcr.io/bernardjr/actual-budget-mcp:latest
    ports:
      - "127.0.0.1:3001:3001"
    environment:
      - ACTUAL_HTTP_API_URL=http://actual-http-api:5007
      - ACTUAL_HTTP_API_KEY=${API_KEY}
      - ACTUAL_BUDGET_SYNC_ID=${ACTUAL_BUDGET_SYNC_ID}
      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
      - MCP_TRANSPORT=sse
      - MCP_PORT=3001
      - LOG_LEVEL=info
    depends_on:
      actual-http-api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped
    networks:
      - actual-network

volumes:
  actual-data:

networks:
  actual-network:
    driver: bridge
```

- [ ] **Step 2: Validate the compose file syntax**

Run: `docker compose -f docker/docker-compose.production.yml config --quiet 2>&1 || python3 -c "import yaml; yaml.safe_load(open('docker/docker-compose.production.yml')); print('Valid YAML')"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add docker/docker-compose.production.yml
git commit -m "chore: add production docker-compose with GHCR image"
```

---

### Task 5: Verify Full Pipeline

No files to create — this is a verification task.

- [ ] **Step 1: Verify all CI scripts pass locally**

Run: `npm run lint && npm test && npm run build`
Expected: All three pass (0 lint errors, 58 tests, clean build)

- [ ] **Step 2: Verify commitlint hook works end-to-end**

Run: `echo "not valid" | npx commitlint; echo "exit: $?"`
Expected: `exit: 1`

Run: `echo "feat: valid commit" | npx commitlint; echo "exit: $?"`
Expected: `exit: 0`

- [ ] **Step 3: Verify all workflow files are valid YAML**

Run: `python3 -c "import yaml; [yaml.safe_load(open(f'.github/workflows/{f}')) for f in ['ci.yml', 'release.yml']]; print('All workflows valid')"`
Expected: `All workflows valid`

- [ ] **Step 4: Verify file tree is correct**

Run: `find .github -type f && echo "---" && ls commitlint.config.js .husky/commit-msg docker/docker-compose.production.yml`
Expected:
```
.github/workflows/ci.yml
.github/workflows/release.yml
---
commitlint.config.js
.husky/commit-msg
docker/docker-compose.production.yml
```

- [ ] **Step 5: Final commit (if any unstaged changes remain)**

```bash
git status
# Only commit if there are changes
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] CI workflow (lint, test, build) → Task 1
- [x] Release workflow (release-please + Docker) → Task 2
- [x] Conventional commits (commitlint + husky) → Task 3
- [x] Production docker-compose → Task 4
- [x] Docker tags (v1.2.3, v1.2, v1, latest) → Task 2 metadata-action config
- [x] GHCR auth via GITHUB_TOKEN → Task 2 login-action step
- [x] Multi-arch (amd64 + arm64) → Task 2 build-push-action platforms
- [x] No npm publish → Not included (correct)
- [x] commitlint devDependencies → Task 3 step 1

**Placeholder scan:** No TBDs, TODOs, or vague instructions found.

**Type consistency:** N/A (no application code with types/signatures in this plan).
