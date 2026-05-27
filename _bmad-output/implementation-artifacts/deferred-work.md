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

## Deferred from: code review of 1-3-fastapi-ml-sidecar-scaffold (2026-05-18)

- `_split_system` silently keeps only the last system-role message — acceptable for current single-system-message usage; multi-system handling if needed by Epic 4 prompting strategy
- DB pool startup failure silently swallowed — intentional resilience design; queries will raise `asyncpg` exceptions mid-request if pool never initialized; consider a startup health gate in production
- `get_provider()` singleton not thread/concurrency-safe — safe for single-worker uvicorn; add a lock if moving to multi-worker or threaded execution
- `asyncio.Lock` created at module scope in `ml-sidecar/src/db/pool.py` — pre-existing from story 1.2; raises deprecation warning in Python 3.10+ before running event loop
- `/analyze/{ticker}` accepts any string with no length or format validation — intentional stub; add `Path(..., min_length=1, max_length=10, pattern=r'^[A-Z.]{1,10}$')` in Epic 6
- `get_logger` re-evaluates `LOG_LEVEL` on every call — minor inconsistency for long-running processes; harmless for current usage
- Test route mutation via `app.routes[:]` — existing working pattern; consider fixture-based route isolation in a future test quality story
- `HTTPException` handler hardcodes `"HTTP_ERROR"` code — per-status codes (e.g. `"UNAUTHORIZED"`, `"FORBIDDEN"`) deferred to auth/rate-limit stories in Epic 5
- `OpenAIProvider.complete` will `IndexError` on empty `choices` list — add a guard when real LLM calls land in Epic 4

## Deferred from: code review of 1-6-github-actions-ci-cd-pipeline (2026-05-18)

- `npm run lint` in `api-checks` uses `--fix` — auto-fixable ESLint violations pass CI silently; fix by adding a separate `lint:ci` script in `api/package.json` that omits `--fix`
- No uv dependency cache for `ml-sidecar-checks` — all Python packages re-downloaded on each run; add `enable-cache: true` to `astral-sh/setup-uv@v5` in a future CI improvement story
- `ml-sidecar` docker build may bundle `.venv/` into the image — add a `.dockerignore` in `ml-sidecar/` to exclude `.venv/`, `__pycache__`, and `*.pyc`
- `tsc --noEmit -p tsconfig.json` in `api-checks` excludes test files — type errors in `*.spec.ts` are invisible to CI; address by adding a separate `tsc -p tsconfig.json` step that includes test files, or updating tsconfig
- Direct push to `main` bypasses all PR quality gates — enforce branch protection rules (require PRs, require status checks) in GitHub repo settings
- `packageManager: npm@10.9.7` in `frontend/package.json` may conflict with Node 22 bundled npm if corepack is active on CI runners; pin npm version explicitly or remove the `packageManager` field

## Deferred from: code review of 3-1-edgar-http-client-with-rate-limiting-queue (2026-05-19)

- `_retrying` tenacity wrapper is recreated on every `_do_fetch` call — minor allocation waste; refactor to a class-level or module-level constant when optimizing the hot path
- `EdgarFetchLog` Pydantic model is defined but never used in the logging path — spec requires its definition; wire it to enforce the log schema in a future observability story
- No production shutdown hook for `await client._http_client.aclose()` on FastAPI app teardown — requires touching `src/main.py`; address in a production hardening story alongside other lifecycle hooks

## Transcript coverage gap — revisit before Epic 4 if claim extraction yield is low (2026-05-26)

EDGAR 8-K filings rarely include a full earnings call transcript as EX-99. Most only contain
the earnings press release (EX-99.1), which has forward-looking language but not the CEO's
spoken remarks verbatim. If claim extraction yield in Epic 4 is too low to be useful, consider:

1. **Include EX-99.1 press releases as a claims source** — already fetched by the pipeline,
   just filtered out by the keyword scorer. Forward-guidance language is rich enough for LLM
   claim extraction even without the spoken-call format. Lowest effort.
2. **Seek Alpha transcripts** — structured HTML, near-100% coverage of public companies.
   Legally grey; evaluate before building.
3. **Earnings call audio + OpenAI Whisper (OSS speech-to-text)** — fetch webcast audio URL
   from the 8-K filing, transcribe locally. Full fidelity but operationally heavy (large audio
   files, GPU recommended, speaker diarization needed for CEO attribution).

The pipeline architecture (CIK resolution → filing discovery → exhibit scoring → text extraction)
is reusable for any of the above; only the source URL and keyword scorer threshold change.

## Deferred from: code review of 3-2-8-k-earnings-call-transcript-ingestion-and-parsing (2026-05-26)

- 8000-char preamble may miss keywords in markup-heavy files — spec-mandated threshold (Task 6); revisit if real-world transcript recall is low
- No deduplication across `recent` and paginated `files` blocks in submissions JSON — EDGAR pagination is non-overlapping by design; address if duplication is observed in production
- Filing index table column order assumed stable — EDGAR HTML has been stable for years; re-evaluate if SEC changes the index format
- `best_url` tracks last error URL, not most informative URL — minor logging inaccuracy; improve in a future observability story
- `ParseStatus` as `Literal` not `StrEnum` — Pydantic validates correctly; consider StrEnum migration in a future type-safety story
- `lxml` parser corrupts plain-text `.txt` filings with `<>` characters — spec mandates lxml; add `.txt` content-type detection in a future parser-quality story
- No test for concurrent `_load_ticker_cik_map` race — asyncio concurrency testing requires additional infrastructure (e.g. `asyncio.TaskGroup`); address in a future test-quality story
- No test for empty submissions JSON response — graceful fallback confirmed in code; add regression test in a future test-quality story

## Deferred from: code review of 3-3-10-q-10-k-financial-actuals-ingestion-and-parsing (2026-05-26, updated 2026-05-27)

- No test for 10-K (Q4) `fp=="FY"` XBRL matching path — test gap not in the 13 specified tests; add in a future test-quality story once 10-K path is exercised against real data
- No test for malformed quarter string input to `_quarter_to_period_end` (e.g. `"bad"`, `"Q5-2024"`) — not in specified 13 tests; add defensive tests when input validation is hardened
- Tolerance boundary test uses 5-day offset, not the 45-day boundary — `test_extract_xbrl_metrics_period_end_tolerance_45_days` validates tolerance works but not the exact edge; strengthen in a future test-quality story
- Amended filings (`10-Q/A`, `10-K/A`) excluded by `form == filing_type` filter in `_find_filing_accession` — per-spec behavior (exact form match mandated); known data gap if a company only has an amendment on file; evaluate real-world impact when 10-K/10-Q pipeline runs against production data
