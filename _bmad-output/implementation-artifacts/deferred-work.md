# Deferred Work

## Deferred from: code review of 1-2-postgresql-schema-and-drizzle-migration-infrastructure (2026-05-06)

- Missing FK indexes on `analysis_jobs.company_id`, `verdicts.claim_id`, `reasoning_traces.verdict_id`, `tool_call_logs.job_id` — only `idx_claims_company_id` required by current spec; add remaining FK indexes in a future performance story
- `analysisJobs` table has no status transition timestamps (`started_at`, `finished_at`) — out of scope for Phase 1 append-only model; useful for debugging stuck jobs but not required until a job monitoring story lands

## Deferred from: code review of 1-5-angular-spa-scaffold-and-routing-shell (2026-05-18)

- All 4xx HTTP errors produce identical message — no 401/403/429 distinction; needs per-status handling in future auth/rate-limit stories
- `ApiError` discards original `HttpErrorResponse` — url, method, and body are lost; may be needed by future diagnostic/logging stories
- `environment.ts` not yet imported by any service — intentional scaffold; future HTTP service stories (Epic 5/6) will consume it
- `CompanyComponent` doesn't read `:ticker` route param — placeholder stub; Epic 6 stories will implement data fetching
- `<main>` has no ARIA `role` or skip-navigation link — accessibility deferred to Epic 2 design system stories
- Empty `:ticker` (`/company/`) and lazy-chunk-load failure after wildcard redirect lack route guards — feature-layer concern for Epic 6 stories
- API URL normalization at startup (trailing slash validation) — beyond scaffold scope; address when first HTTP service is wired
- No global `ErrorHandler` provided — cross-cutting observability concern; address in a future logging/monitoring story
- Ticker case/encoding normalization (e.g. `aapl` vs `AAPL`) — route guard/resolver concern for Epic 6

## Deferred from: code review of 1-1-docker-compose-stack-and-environment-configuration (2026-05-18)

- Redis has no password configured — `redis:7-alpine` listens unauthenticated on host port 6379; add `requirepass` and update `REDIS_URL` before any public deployment
- `ml-sidecar` container runs as root — no `USER` directive in Dockerfile; address in a production hardening story
- `uv:latest` pinned by tag not digest — `COPY --from=ghcr.io/astral-sh/uv:latest` in ml-sidecar/Dockerfile will silently drift on rebuild; pin to specific semver digest before production
- Hardcoded postgres password `postgres` in `docker-compose.yml` `environment:` block and `DATABASE_URL` — replace with a secret before deployment
- nginx performance tuning absent — no `gzip`, `sendfile`, or cache headers; address in Epic 6 / production hardening
- No graceful shutdown signal handling — NestJS `enableShutdownHooks()` not called; address in production hardening story
