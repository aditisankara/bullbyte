# Deferred Work

## Deferred from: code review of 4-4-quantitative-delta-calculation-and-verification-confidence-scoring (2026-06-08)

- Float arithmetic for financial delta — `_parse_numeric_value` returns `float` and delta arithmetic is IEEE-754; Decimal would eliminate precision loss on large currency values (e.g. $383,000,000,000 ± cents); address in a future numeric-precision story [`ml-sidecar/src/services/verification_service.py`]
- `"raw"` vs `"raw"` magnitude mismatch silently accepted — delta between a multiplier target and raw absolute actual produces a meaningless value with no warning; requires a heuristic magnitude-difference threshold not specified in this story [`ml-sidecar/src/services/verification_service.py`]
- No DB transaction wrapping `insert_verdict` + `insert_reasoning_trace` — partial failure mid-trace leaves an orphaned verdict row with no rollback; wrapping verdict+traces in a single `asyncpg` transaction belongs in a future DB reliability story [`ml-sidecar/src/services/verification_service.py`]
- `step_index=1` hardcoded for unit-normalization trace entries — will conflict when multiple trace steps per verdict are written; address when full trace logging (story 4.5+) introduces step sequencing [`ml-sidecar/src/services/verification_service.py`]

## Deferred from: code review of 4-3-claim-verification-agent-verdict-engine (2026-06-07)

- `zip(claim_ids, result.claims)` silently truncates with no assertion — not triggered by current code but a future deduplication step could silently skip tail claims [`ml-sidecar/src/routers/analysis_router.py`]
- `messages` array passes `{"role": "system", ...}` inside messages list — Anthropic API requires system prompt as top-level param; correctness depends on `provider.complete()` implementation [`ml-sidecar/src/services/verification_service.py`]
- `get_provider()` called inside per-claim loop — can raise `ValueError` on env misconfiguration; should be resolved once before the loop [`ml-sidecar/src/services/verification_service.py`]
- `AMBIGUOUS` alignment status would bypass the `filing_url`-based guard if returned with a non-empty URL — not currently produced by the aligner; guard should check `decision.status != "ALIGNED"` explicitly [`ml-sidecar/src/services/verification_service.py`]

## Deferred from: code review of 4-1-llm-based-numerical-claim-extraction-agent (2026-05-31)

- Unbounded transcript `raw_text` size sent to LLM without token/character guard [`ml-sidecar/src/routers/analysis_router.py`] — transcript size is bounded by EDGAR/press-release ingestion; a hard cap + warning belongs in a later performance/reliability story
- No idempotency in `insert_claim_batch` — re-running `/analyze/{ticker}` duplicates all claims in DB [`ml-sidecar/src/db/queries.py`] — requires a unique index on `(company_id, quarter, metric, raw_quote)` and `ON CONFLICT DO NOTHING`; schema change deferred to avoid unplanned migration in this story
- Ticker path parameter has no regex validation — arbitrary strings reach DB [`ml-sidecar/src/routers/analysis_router.py`] — input validation at the API gateway layer is a cross-cutting concern; address in a dedicated validation/hardening story

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

## Transcript source decisions and Finnhub upgrade path (2026-05-29)

**Implemented (story 3.7):** EX-99.1 press releases accepted as `PRESS_RELEASE`-status fallback
transcripts when no full earnings call transcript is found. Keyword scorer now uses tiered thresholds:
score ≥ 3 → `SUCCESS`, score 1–2 → `PRESS_RELEASE`, score 0 → `NO_TRANSCRIPT`.

**Finnhub — viable paid upgrade when full transcript fidelity is required:**
- API: `GET /api/v1/stock/transcripts` — verbatim spoken-word earnings call transcripts
- Coverage: ~80% of large/mid-cap US companies; near-100% for S&P 500
- Pricing: Premium tier required (~$130–200/month); free tier does NOT include transcripts
- Legal risk: LOW — licensed commercial data with proper ToS (unlike Seeking Alpha scraping)
- Integration: drop-in — same pipeline architecture, different source URL in exhibit fetcher
- When to upgrade: if Epic 4 extraction_confidence scores are systematically lower for
  `PRESS_RELEASE` rows than `SUCCESS` rows, Finnhub closes that fidelity gap cleanly

**Options ruled out:**
- Seeking Alpha scraping — legally grey (copyright), risk of DMCA/IP block; do not build
- Earnings call audio + Whisper — GPU required, speaker diarization needed, 2–3 week project; last resort only

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

## Deferred from: code review of 3-5-yfinance-financial-data-supplement (2026-05-28)

- No timeout on `quarterly_income_stmt` network call — blocked thread pool slot; a stalled HTTP connection holds a pool thread indefinitely with no timeout bound; add `asyncio.wait_for` wrapper or yfinance session timeout when production reliability is needed
- No rate-limit/retry logic for yfinance calls — tenacity is already a project dependency; a single failure silently returns `[]`; add retry with backoff if yfinance throttling becomes an issue in production
- No defensive guard for `quarterly_income_stmt` returning `None` (invalid/private tickers) — covered by outer `except Exception`, returns `[]` as intended; add explicit `if df is None or df.empty: return []` for clarity when the service is hardened
- `_METRIC_TO_ROW_LABEL` covers only 6 metrics and silently skips unknown names — by design per spec; add a `logger.warning` for unmapped metric names when observability of supplement coverage gaps is needed

## Deferred from: code review of 3-6-postgresql-caching-and-re-ingestion-prevention (2026-05-28)

- `_reconstruct_financials_result` raises uncaught `ValidationError` if DB JSONB row schema doesn't match current `FinancialMetric` model — pre-existing future risk; handle in a schema-evolution or cache-migration story when the model changes
- `PARTIAL` financials cached permanently with no invalidation mechanism — SUCCESS data from a later EDGAR fetch is never used once PARTIAL is stored; deliberate spec choice, revisit with a TTL/cache-upgrade story before production
- `fetch_duration_ms` in financials cache-miss log includes fast-path DB check and lock acquisition time, not only EDGAR fetch — misleading for performance monitoring; fix by moving `start_time` assignment after the optimistic DB check, or rename the field

## Deferred from: code review of 3-7-press-release-transcript-fallback (2026-05-29)

- `parse_status` column in `transcripts` table has no `CHECK` constraint — text column accepts any value; no DB-level enum enforcement [api/src/db/schema.ts:169]; address in a schema hardening story
- No `TranscriptResult` appended when `_get_exhibit_documents` returns an empty list — creates inconsistency with other failure paths (index FETCH_ERROR does append a result); pre-existing pattern, low impact [ingestion_service.py:314]; address in a future result-consistency story

## Deferred from: 3-7 manual testing and data strategy brainstorm (2026-05-31)

- **8-K keyword scorer fix applied (not a story — hotfix):** `_extract_transcript_text` in
  `ingestion_service.py` was scoring keywords against raw HTML (`response.text[:8000]`).
  Fixed to strip HTML via BeautifulSoup first, then score plain text. Result: MSFT/GOOGL/META
  reclassified from PRESS_RELEASE → SUCCESS; AMZN went from 8 skipped → 6 PRESS_RELEASE.
  All 133 tests pass. No story needed — change is already in `ingestion_service.py`.

- **Multi-8-K-per-quarter caching: first-filing-wins may cache wrong document** —
  Pipeline processes 8-Ks in filing-date order and caches the first result per
  `ticker+quarter`. If a non-earnings 8-K filed earlier in the quarter accidentally
  scores ≥1 keyword, it gets cached and the actual earnings press release is never
  processed for that quarter. Low probability for current 5 demo tickers (non-earnings
  8-Ks typically score 0) but a real risk at scale. Fix options: filter by 8-K item type
  (item 2.02 = earnings results), or use exhibit description labels from the filing index
  instead of keyword scoring. Revisit before expanding beyond demo tickers.

- **`press_releases_extracted` counter double-counts cache hits** — the summary counter
  increments for both new DB inserts and cache hits on PRESS_RELEASE rows (by design from
  3.7 review patch). This causes the ingestion summary to report more press releases than
  rows actually inserted (observed: counter=6, DB rows=3 for AMZN). Misleading for
  monitoring. Consider splitting into `press_releases_inserted` vs `press_releases_cached`
  in a future observability story.

- **AMZN Q3-2024 still skipped** — 2 AMZN quarters remain as NO_TRANSCRIPT after the
  hotfix. Q4-2024 is explained by the test script's `end_date="2024-12-31"` cutoff
  (earnings filed Feb 2025). Q3-2024 cause unknown — likely a non-earnings 8-K cached
  ahead of the earnings one, or the earnings 8-K has a different exhibit structure.
  Investigate by fetching the Q3-2024 8-K index directly from EDGAR for accession number.

## Deferred from: code review of 3-8-executive-tenure-schema (2026-05-31)

- No partial unique index on `(company_id, role) WHERE end_date IS NULL` in `executives` table — nothing prevents two simultaneous active "CEO" rows for the same company; `ORDER BY start_date DESC LIMIT 1` picks one silently. Low risk for schema-only story but will cause silent data integrity issues when rows are inserted; add `CREATE UNIQUE INDEX idx_executives_active_role ON executives (company_id, role) WHERE end_date IS NULL` before the first data seeding in Epic 4.

## Deferred from: code review of 4-2-safe-harbour-boilerplate-filter-and-extraction-confidence-scoring (2026-06-06)

- `insert_claim_batch` rolls back entire batch on single claim failure — any DB constraint violation (e.g., duplicate re-run) causes `asyncpg` transaction rollback, silently losing all claims for that transcript; no per-claim retry or partial-success path [`ml-sidecar/src/db/queries.py`]
- DB check constraint `extraction_confidence_range` (0 ≤ x ≤ 1) existence not confirmed in this diff — dev notes assert the column and constraint already exist from story 4.1 migration; verify against `api/src/db/schema.ts` before production load testing [`api/src/db/schema.ts`]

## Deferred from: code review of 3-4-temporal-alignment-engine (2026-05-27)

- `acc_no.replace("-", "")` has no accession number format validation [temporal_aligner.py] — pre-existing pattern in financials_service.py; EDGAR is reliable source; scope creep for 3.4
- `str(int(cik))` will raise uncaught `ValueError` if non-numeric CIK passed [temporal_aligner.py] — internal function; `resolve_cik` guarantees zero-padded numeric string; address if CIK handling is generalized
- Filing date window lower bound (`period_end_dt <= filing_dt`) excludes any filing filed before period end [temporal_aligner.py] — calendar-quarter design is intentional; fiscal year offset handled by alt-quarter fallback path
- Earliest fili ng selected over later amendments within 180-day window [temporal_aligner.py] — pre-existing pattern in financials_service.py; for temporal alignment the original filing is the canonical source; revisit if amendment handling is needed
- `_quarter_to_period_end` inconsistently lacks `len(parts) != 2` guard vs `_next_quarter` [temporal_aligner.py] — `IndexError` is caught and re-raised as `ValueError`; works correctly; minor style inconsistency
- `PENDING` status assigned `LOW` confidence — spec AC3 only requires `PENDING` status; `LOW` is the most reasonable default given no filing is confirmed; clarify if consumers need a distinct confidence value for pending states
