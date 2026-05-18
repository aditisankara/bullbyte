# Story 1.6: GitHub Actions CI/CD Pipeline

## Story

**As a** developer,
**I want** a GitHub Actions pipeline that runs automated quality checks on PRs and build verification on merge to main,
**So that** code quality and build health are enforced automatically from the first commit.

## Acceptance Criteria

1. **Given** a pull request is opened against `main`
   **When** the CI workflow triggers
   **Then** it runs lint + type-check + unit tests for the NestJS api
   **And** lint + type-check + unit tests for the Angular frontend
   **And** `pytest` for the FastAPI ml-sidecar
   **And** the workflow fails and blocks merge if any check fails

2. **Given** a PR is merged to `main`
   **When** the CI workflow triggers
   **Then** a Docker build check runs for all three services (api, frontend, ml-sidecar)
   **And** the workflow fails if any Dockerfile fails to build

3. **Given** `.github/workflows/ci.yml`
   **When** a developer inspects it
   **Then** no secrets, API keys, or environment variable values are hardcoded in the file
   **And** all secrets are referenced via GitHub Actions repository secrets

## Tasks / Subtasks

- [x] Task 1: Create `.github/workflows/ci.yml` with PR quality gate jobs
  - [x] Add workflow trigger: `pull_request` targeting `main`, and `push` to `main`
  - [x] Add `api-checks` job (runs on `pull_request` only): checkout → setup Node 22 → `npm ci` → `npm run lint` → `npx tsc --noEmit -p tsconfig.json` → `npm run test`
  - [x] Add `frontend-checks` job (runs on `pull_request` only): checkout → setup Node 22 → `npm ci` → `npm run lint` → `npx tsc --noEmit -p tsconfig.app.json` → `ng test --watch=false`
  - [x] Add `ml-sidecar-checks` job (runs on `pull_request` only): checkout → setup Python 3.12 → install uv → `uv sync --frozen` → `uv run pytest`
  - [x] Confirm no hardcoded secrets, environment values, or API keys appear anywhere in the file

- [x] Task 2: Create Docker build verification job
  - [x] Add `docker-build-check` job (runs on `push` to `main` only, conditional: `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`)
  - [x] Use matrix strategy over `[api, frontend, ml-sidecar]` to build each service's Docker image
  - [x] Each matrix entry runs `docker build` against its service directory — `push: false`
  - [x] Confirm job fails the workflow if any Docker build exits non-zero

## Dev Notes

### Workflow File Location & Trigger Design

Single file: `.github/workflows/ci.yml` (architecture doc specifies this exact path).

Trigger:
```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

- Quality checks (`api-checks`, `frontend-checks`, `ml-sidecar-checks`) run only on `pull_request` events via `if: github.event_name == 'pull_request'`.
- `docker-build-check` runs only on `push` to `main` via `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`.

This ensures a merged PR triggers Docker build verification without re-running unit tests redundantly.

### Exact Commands Per Service

**API (NestJS — `api/`):**
- `npm run lint` → runs ESLint via `eslint "{src,apps,libs,test}/**/*.ts" --fix` (from package.json)
- `npx tsc --noEmit -p tsconfig.json` → TypeScript type-check without emitting files
- `npm run test` → runs Jest; in CI (non-TTY), Jest exits automatically without `--watchAll`

**Frontend (Angular 21 — `frontend/`):**
- `npm run lint` → runs `ng lint` (angular-eslint)
- `npx tsc --noEmit -p tsconfig.app.json` → type-check app source only (not test files); avoids full `ng build` cost
- `npx ng test --watch=false` → runs vitest via `@angular/build:unit-test` with jsdom; `--watch=false` is required in CI or the process hangs indefinitely

**ML Sidecar (FastAPI — `ml-sidecar/`):**
- `uv sync --frozen` → installs all deps including dev group (`httpx`, `pytest`) from `uv.lock`; do NOT use `--no-dev`
- `uv run pytest` → runs pytest from within the uv environment; `testpaths = ["tests"]` is already configured in `pyproject.toml`

**Docker Builds:**
- `docker build ./api` → multi-stage Node 22 Alpine build (stage: build + production)
- `docker build ./frontend` → multi-stage Node 22 Alpine + nginx:alpine
- `docker build ./ml-sidecar` → python:3.12-slim + uv; note: uses `COPY --from=ghcr.io/astral-sh/uv:latest` as a Docker build stage — GitHub Actions runners have internet access, this works fine

### GitHub Actions Action Versions (Pin These)

Use pinned major versions to prevent unexpected breaks:
- `actions/checkout@v4`
- `actions/setup-node@v4` with `node-version: '22'`
- `actions/setup-python@v5` with `python-version: '3.12'`
- `astral-sh/setup-uv@v5` (official uv GitHub Action — installs uv into PATH)

### npm Caching in GitHub Actions

For Node jobs, enable npm caching to speed up CI:
```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'npm'
    cache-dependency-path: api/package-lock.json  # or frontend/package-lock.json
```

Each service job must set `cache-dependency-path` to the correct `package-lock.json` since both services live in subdirectories, not the repo root.

### Working Directory for Each Job

Use `defaults.run.working-directory` at the job level instead of repeating `working-directory` on every step:
```yaml
jobs:
  api-checks:
    defaults:
      run:
        working-directory: api
```

Exception: `actions/checkout` does not respect `defaults.run.working-directory` — it always checks out to the workspace root, which is correct.

### Secrets Hygiene (AC3)

The workflow must reference zero literal values for secrets. Valid patterns:
- `${{ secrets.SOME_SECRET }}` — for GitHub Actions repository secrets
- `${{ github.token }}` — for GITHUB_TOKEN

**Do NOT** set any `env:` block with actual values. The PR check jobs (lint, type-check, test) do not need any secrets — NestJS unit tests mock all external calls, FastAPI pytest mocks DB calls, Angular tests use `HttpClientTestingModule`.

The Docker build check similarly needs no secrets — images are built but not pushed (`push: false` / no `docker push`).

### No tests/ Directory For This Story

This story creates only a YAML workflow file. There are no application code files to test. The "test" is the CI pipeline itself executing correctly. The dev agent does NOT need to write any `*.spec.ts` or `test_*.py` files for this story.

Validation of the story is done by inspecting the final `.github/workflows/ci.yml` against the acceptance criteria.

### Previous Story Context (1.5 — Angular SPA Scaffold)

Story 1.5 is `done`. The Angular test command `ng test` (vitest-backed) was confirmed working. The `--watch=false` flag is essential for CI — without it, `ng test` enters watch mode and the CI job never exits.

The `frontend/angular.json` includes a production `fileReplacements` for `environment.prod.ts`. The Docker build for `frontend` runs `ng build` (default config), which references `environment.ts` — no `API_BASE_URL` injection needed for a build-check-only job.

### Anti-Patterns to Avoid

- **Do not** use `actions/cache` manually for npm — `actions/setup-node` with `cache: 'npm'` handles it.
- **Do not** hardcode `env:` values for `DATABASE_URL`, `ANTHROPIC_API_KEY`, or any other secret — unit tests and build checks must not require real credentials.
- **Do not** run `docker push` or authenticate to a registry — this story is build-check only.
- **Do not** run migrations (`drizzle-kit migrate`) in CI — the architecture doc explicitly states migrations run at API startup, not in CI.
- **Do not** add `--ci` flag to Jest in the test script — it changes snapshot behavior and is not required here; plain `npm run test` is sufficient.
- **Do not** pin to `actions/checkout@v3` or older — use `@v4`.

### Architecture Compliance Notes

From the architecture doc:
- CI/CD: GitHub Actions — lint + type-check + unit tests on PR; build check on merge to main.
- Migrations run at api service startup (Docker Compose), NOT in CI.
- No secrets in source code — all via env vars.

### Review Findings

- [x] [Review][Patch] Duplicate `Type-check` step in `api-checks` job [.github/workflows/ci.yml:~line 36-39] — false positive, file was already clean
- [x] [Review][Patch] No `fail-fast: false` on `docker-build-check` matrix — first service failure cancels sibling builds [.github/workflows/ci.yml:~line 75] — fixed
- [x] [Review][Patch] `astral-sh/setup-uv@v5` version not pinned — a breaking uv release could break `uv sync --frozen` without any workflow change [.github/workflows/ci.yml:~line 68] — fixed, pinned to 0.11.8
- [x] [Review][Defer] Lint `--fix` baked into `npm run lint` — auto-fixable ESLint violations pass CI silently [api/package.json:15] — deferred, pre-existing
- [x] [Review][Defer] No uv dependency cache for `ml-sidecar-checks` — all Python deps re-downloaded each run [.github/workflows/ci.yml:~line 68] — deferred, pre-existing
- [x] [Review][Defer] `ml-sidecar` docker build may include `.venv/` — no `.dockerignore` confirmed [ml-sidecar/] — deferred, pre-existing
- [x] [Review][Defer] `tsc --noEmit -p tsconfig.json` excludes test files — type errors in `*.spec.ts` are invisible [api/tsconfig.json] — deferred, pre-existing
- [x] [Review][Defer] Direct push to `main` bypasses all quality gates — requires branch protection policy, not a workflow fix — deferred, pre-existing
- [x] [Review][Defer] `packageManager: npm@10.9.7` in `frontend/package.json` may conflict with Node 22 bundled npm — deferred, pre-existing

## Dev Agent Record

### Implementation Plan

Created a single `.github/workflows/ci.yml` file with four jobs:
- `api-checks`: PR-only, NestJS (Node 22, npm ci, lint, tsc --noEmit, jest)
- `frontend-checks`: PR-only, Angular (Node 22, npm ci, ng lint, tsc --noEmit, ng test --watch=false)
- `ml-sidecar-checks`: PR-only, FastAPI (Python 3.12, uv, uv sync --frozen, uv run pytest)
- `docker-build-check`: push-to-main only, matrix over [api, frontend, ml-sidecar]

Used `defaults.run.working-directory` at the job level instead of per-step. Pinned all action versions to major (v4/v5). npm caching enabled via `actions/setup-node` cache field with correct `cache-dependency-path` per service. No secrets or env vars with literal values anywhere.

### Debug Log

_None_

### Completion Notes

All tasks complete. Single workflow file satisfies all three ACs:
- AC1: Three PR-only quality gate jobs (lint + type-check + test) for all services
- AC2: Docker build matrix job on push to main only, no push/registry auth needed
- AC3: Zero hardcoded secrets or env values in the workflow file

No test files required for this story — the CI pipeline itself is the validation artifact.

## File List

- `.github/workflows/ci.yml` (new)

## Change Log

- 2026-05-18: Story created with comprehensive CI/CD pipeline context for GitHub Actions
- 2026-05-18: Implemented `.github/workflows/ci.yml` — all tasks complete, status set to review
- 2026-05-18: Code review complete — 2 patches applied (fail-fast: false, uv version pin); 6 items deferred; status set to done

## Status

done
