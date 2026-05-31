# Story 3.7: Press Release Transcript Fallback

Status: done

## Story

As a **developer**,
I want the ingestion service to fall back to EX-99.1 press releases when no full earnings call transcript is found in an 8-K filing,
So that Epic 4 claim extraction has real financial-guidance text for every company-quarter instead of zero cached transcripts.

## Acceptance Criteria

1. **Given** an 8-K exhibit that scores 1–2 keyword matches (likely a press release, not a full transcript)
   **When** `_extract_transcript_text` processes it
   **Then** it returns `(text, "PRESS_RELEASE")` — the text is extracted and the status distinguishes it from a full transcript hit

2. **Given** an 8-K exhibit that scores 0 keyword matches (non-financial document)
   **When** `_extract_transcript_text` processes it
   **Then** it returns `(None, "NO_TRANSCRIPT")` — unchanged from current behaviour

3. **Given** a filing whose best exhibit scores `PRESS_RELEASE`
   **When** ingestion completes for that quarter
   **Then** the press release text is persisted to the `transcripts` table with `parse_status = "PRESS_RELEASE"`
   **And** `press_releases_extracted` in the `IngestionSummary` is incremented by 1
   **And** `transcripts_extracted` is NOT incremented (reserved for `SUCCESS` only)

4. **Given** a filing whose best exhibit scores `SUCCESS`
   **When** ingestion completes for that quarter
   **Then** behaviour is unchanged — `SUCCESS` is cached, `transcripts_extracted` incremented — `PRESS_RELEASE` is never chosen over `SUCCESS`

5. **Given** `PRESS_RELEASE` or `SUCCESS` cached for a quarter
   **When** ingestion is triggered again for the same ticker + quarter
   **Then** the cache hit path returns the cached row with its original `parse_status` — no re-fetch occurs

6. **Given** the deferred-work.md transcript coverage gap entry
   **When** this story is complete
   **Then** that entry is updated to reflect: press releases now implemented; Finnhub documented as the paid upgrade path when full transcript fidelity is required

## Tasks / Subtasks

- [x] Task 1: Extend `ParseStatus` in `ml-sidecar/src/models/ingestion_models.py` (AC: 1, 2, 3)
  - [x] Add `"PRESS_RELEASE"` to the `ParseStatus` Literal — new value: `Literal["SUCCESS", "PRESS_RELEASE", "PARSE_FAILURE", "NO_TRANSCRIPT", "FETCH_ERROR"]`
  - [x] Add `press_releases_extracted: int` field to `IngestionSummary` (after `transcripts_extracted`, before `skipped_no_transcript`)
  - [x] Default value is `0` — no other callers need updating

- [x] Task 2: Update keyword scorer in `_extract_transcript_text` (AC: 1, 2)
  - [x] Current logic: `if score < 3: return None, "NO_TRANSCRIPT"`
  - [x] New logic (exact replacement):
    ```python
    if score >= 3:
        pass  # fall through to extract
    elif score >= 1:
        soup = BeautifulSoup(response.text, "lxml")
        raw = soup.get_text(separator="\n", strip=True)
        cleaned = re.sub(r"\n{3,}", "\n\n", raw)
        return cleaned, "PRESS_RELEASE"
    else:
        return None, "NO_TRANSCRIPT"
    ```
  - [x] The `SUCCESS` path below is unchanged — reaching it means `score >= 3`

- [x] Task 3: Update cache persist and counter logic in `ingest_8k_transcripts` (AC: 3, 4)
  - [x] Add `press_releases_extracted = 0` counter initialisation alongside `transcripts_extracted = 0`
  - [x] In the `best_status` branch block (currently lines ~347-363), add `PRESS_RELEASE` handling:
    ```python
    if best_status == "SUCCESS":
        transcripts_extracted += 1
    elif best_status == "PRESS_RELEASE":
        press_releases_extracted += 1
        logger.info(
            "8-K press release accepted as transcript fallback",
            extra={"ticker": ticker, "filing_url": best_url, "filing_date": filing_date},
        )
    elif best_status == "NO_TRANSCRIPT":
        ...  # unchanged
    ```
  - [x] Change cache persist condition from `if best_status == "SUCCESS":` to `if best_status in ("SUCCESS", "PRESS_RELEASE"):`
  - [x] Pass `press_releases_extracted=press_releases_extracted` to `IngestionSummary` constructor

- [x] Task 4: Update `transcripts` schema comment in `api/src/db/schema.ts` (AC: 3)
  - [x] Change `parseStatus` comment from `// always "SUCCESS" when cached` to `// "SUCCESS" or "PRESS_RELEASE" when cached`
  - [x] No migration needed — column type is already `text`, no constraint on values

- [x] Task 5: Update tests in `ml-sidecar/tests/test_ingestion.py` (AC: 1, 2, 3, 4)
  - [x] Add test: `test_low_score_exhibit_returns_press_release` — mock exhibit with score 1 keyword match, assert `(text, "PRESS_RELEASE")` returned
  - [x] Add test: `test_zero_score_exhibit_returns_no_transcript` — mock exhibit with 0 keyword matches, assert `(None, "NO_TRANSCRIPT")` returned
  - [x] Add test: `test_press_release_persisted_to_cache` — mock the full ingestion flow with a PRESS_RELEASE exhibit, assert `insert_transcript` called with `parse_status="PRESS_RELEASE"` and `press_releases_extracted == 1`
  - [x] Add test: `test_success_beats_press_release` — two exhibits: first scores PRESS_RELEASE, second scores SUCCESS, assert final result is SUCCESS (the break-on-success logic is unchanged)
  - [x] Verify all existing caching tests still pass (`test_caching.py`) — `_CACHED_TRANSCRIPT_ROW` uses `"SUCCESS"` which remains valid

- [x] Task 6: Update `deferred-work.md` (AC: 6)
  - [x] Replace the existing "Transcript coverage gap" section (lines ~56-70) with:
    ```
    ## Transcript source: press releases implemented; Finnhub is the upgrade path

    Story 3.7 relaxed the keyword scorer to accept EX-99.1 earnings press releases
    (score 1–2) as `PRESS_RELEASE`-status fallback transcripts. Forward-guidance
    language in press releases is rich enough for LLM claim extraction.

    **Finnhub upgrade path (when full transcript fidelity is required):**
    - API endpoint: `GET /api/v1/stock/transcripts` — verbatim spoken-word transcripts
    - Coverage: ~80% of large/mid-cap US companies
    - Pricing: Premium tier required (~$130–200/month); free tier does not include transcripts
    - Legal risk: LOW — licensed commercial data, not scraped content
    - Integration: drop-in replacement — same pipeline, different source URL
    - Revisit when: claim extraction yield from press releases is demonstrably low
      (Epic 4 observability will surface this via extraction_confidence scores)
    ```

## Dev Notes

### Context: why this story exists

The EDGAR 8-K pipeline (story 3.2) correctly detects that most 8-K EX-99 exhibits are earnings press releases, not full spoken-word transcripts. The keyword scorer rejects them (`score < 3 → NO_TRANSCRIPT`). Result: `transcripts_extracted: 0` for all 5 demo tickers — Epic 4 has no text to work with.

This story relaxes the threshold so press releases (score 1–2) are accepted as lower-fidelity fallbacks. Epic 4 will see `parse_status = "PRESS_RELEASE"` and can treat these as a distinct source type.

### Key files and their current state

| File | Current state | This story changes |
|---|---|---|
| `ml-sidecar/src/models/ingestion_models.py` | `ParseStatus = Literal["SUCCESS", "PARSE_FAILURE", "NO_TRANSCRIPT", "FETCH_ERROR"]`; `IngestionSummary` has 4 counters | Add `"PRESS_RELEASE"` to Literal; add `press_releases_extracted: int` counter |
| `ml-sidecar/src/services/ingestion_service.py` | `_extract_transcript_text`: score < 3 → NO_TRANSCRIPT; cache persist: `if best_status == "SUCCESS"` | Tiered scorer; `PRESS_RELEASE` persist; new counter |
| `api/src/db/schema.ts` | `parseStatus` comment says `// always "SUCCESS" when cached` | Update comment only — no migration |
| `ml-sidecar/tests/test_ingestion.py` | Tests for `_extract_transcript_text` exist but use score ≥ 3 and score = 0 | Add PRESS_RELEASE path tests |

### Scorer threshold design

```
score = len({kw for kw in _TRANSCRIPT_KEYWORDS if kw in preview})  # unchanged

score >= 3  →  SUCCESS       (conference call / Q&A detected — full transcript)
score 1–2  →  PRESS_RELEASE  (financial language present — likely EX-99.1 PR)
score == 0  →  NO_TRANSCRIPT (non-financial document — skip entirely)
```

The 7 keywords are: `"operator"`, `"conference call"`, `"earnings call"`, `"q&a"`, `"fiscal quarter"`, `"per share"`, `"revenue"`. A press release will always hit at least `"revenue"` and usually `"per share"` or `"fiscal quarter"`, giving score 1–2. A proxy statement or 8-K cover form scores 0.

### `PRESS_RELEASE` in `_extract_transcript_text` — exact code shape

```python
async def _extract_transcript_text(
    url: str, ticker: str, filing_date: str
) -> tuple[str | None, ParseStatus]:
    try:
        response = await get_client().fetch(url, ticker=ticker, filing_type="8-K-exhibit")
        preview = response.text[:8000].lower()
        score = len({kw for kw in _TRANSCRIPT_KEYWORDS if kw in preview})
        if score >= 3:
            pass  # fall through to extract text below
        elif score >= 1:
            soup = BeautifulSoup(response.text, "lxml")
            raw = soup.get_text(separator="\n", strip=True)
            cleaned = re.sub(r"\n{3,}", "\n\n", raw)
            return cleaned, "PRESS_RELEASE"
        else:
            return None, "NO_TRANSCRIPT"
        # SUCCESS path — reached only when score >= 3
        soup = BeautifulSoup(response.text, "lxml")
        raw = soup.get_text(separator="\n", strip=True)
        cleaned = re.sub(r"\n{3,}", "\n\n", raw)
        return cleaned, "SUCCESS"
    except EdgarFetchError:
        raise
    except Exception as exc:
        logger.error(
            "8-K parse failure",
            extra={"ticker": ticker, "filing_url": url, "filing_date": filing_date, "error": str(exc)},
        )
        return None, "PARSE_FAILURE"
```

Note: the text extraction logic (`BeautifulSoup` + `re.sub`) is intentionally duplicated for `PRESS_RELEASE` and `SUCCESS` — this keeps each branch self-contained and avoids a shared helper that would complicate the `PARSE_FAILURE` exception boundary.

### Cache persist condition

Change one line only:
```python
# Before (line ~373 in ingestion_service.py):
if best_status == "SUCCESS":
    await insert_transcript(...)

# After:
if best_status in ("SUCCESS", "PRESS_RELEASE"):
    await insert_transcript(...)
```

The `insert_transcript` helper signature is unchanged — `parse_status` is already a freetext `str`, so `"PRESS_RELEASE"` passes through without modification. The DB column `parse_status` is `text` — no migration needed.

### `SUCCESS` always beats `PRESS_RELEASE`

The exhibit scoring loop breaks on first `SUCCESS` (`break` at line ~342 in ingestion_service.py). If any exhibit scores `SUCCESS`, that result is used and `PRESS_RELEASE` exhibits are never considered. This is correct — the loop tries exhibits in order and the first full transcript wins.

The only case where `PRESS_RELEASE` is the final `best_status` is when no exhibit scores `SUCCESS` or higher.

### Testing patterns (follow existing style)

Tests in `test_ingestion.py` use `unittest.mock.patch` for `_extract_transcript_text` and `_get_8k_filings`. See existing tests like `test_no_transcript_filing_skipped` for the pattern. The `conftest.py` `_mock_db_cache` fixture already stubs `insert_transcript` as a noop, so caching tests can assert it was called without DB setup.

### What Epic 4 should know

Epic 4 (claim extraction) reads from the `transcripts` table. It will encounter rows with:
- `parse_status = "SUCCESS"` — full verbatim transcript, highest fidelity
- `parse_status = "PRESS_RELEASE"` — earnings press release, lower fidelity but contains forward guidance

Epic 4's extraction prompt or pre-filter should handle both. Consider passing `source_type` to the LLM prompt so it can calibrate extraction confidence accordingly. This is an Epic 4 design decision, not a 3.7 concern.

### Project Structure Notes

- All changes are within `ml-sidecar/` except the schema comment fix in `api/src/db/schema.ts`
- No new files needed — modify existing ones only
- Follow the `asyncio`-safe test pattern from `conftest.py`: `_reset_lock_registries` fixture handles event loop isolation
- `deferred-work.md` update is part of the story definition of done

### References

- [Source: ml-sidecar/src/services/ingestion_service.py#_extract_transcript_text] — keyword scorer (lines 161–189)
- [Source: ml-sidecar/src/services/ingestion_service.py#ingest_8k_transcripts] — cache persist logic (lines ~373–381)
- [Source: ml-sidecar/src/models/ingestion_models.py] — `ParseStatus` and `IngestionSummary`
- [Source: api/src/db/schema.ts#transcripts] — `parseStatus` column (lines 163–181)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — "Transcript coverage gap" section (lines 56–70)
- [Source: ml-sidecar/tests/test_ingestion.py] — existing keyword scorer tests
- [Source: ml-sidecar/tests/conftest.py] — `_mock_db_cache`, `_reset_lock_registries` fixtures

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (story creation via bmad-create-story, 2026-05-29)
claude-sonnet-4-6 (implementation via bmad-dev-story, 2026-05-29)

### Debug Log References

### Completion Notes List

- Added `"PRESS_RELEASE"` to `ParseStatus` Literal and `press_releases_extracted: int = 0` to `IngestionSummary`
- Updated `_extract_transcript_text` with tiered scorer: score ≥3 → SUCCESS, 1–2 → PRESS_RELEASE, 0 → NO_TRANSCRIPT
- Updated exhibit scoring loop to capture first PRESS_RELEASE as fallback; SUCCESS still breaks and wins
- PARSE_FAILURE no longer overwrites a previously found PRESS_RELEASE (keeps the text)
- Cache persist condition extended to `if best_status in ("SUCCESS", "PRESS_RELEASE")`
- IngestionSummary constructor and completion log updated with `press_releases_extracted`
- 4 new tests added; all 130 tests pass with zero regressions
- `deferred-work.md` already contained the correct updated section from story creation

### Post-Close Hotfix (2026-05-31) — HTML strip before keyword scoring

**Found during:** Manual testing of 3-7 across 5 demo tickers (AAPL, MSFT, GOOGL, AMZN, META)

**Root cause:** `_extract_transcript_text` was scoring keywords against `response.text[:8000]` — raw HTML. AMZN's EX-99.1 exhibits are ~578KB HTML files with heavy inline CSS and SEC boilerplate. All financial keywords (`"revenue"`, `"per share"`, `"conference call"`) existed in the document but appeared well past the 8000-char raw HTML window. Result: AMZN scored 0 on all 8 filings → all skipped.

**Fix applied to:** `ml-sidecar/src/services/ingestion_service.py` — `_extract_transcript_text`

**Change:** Strip HTML via BeautifulSoup first, score plain text preview instead of raw HTML. Also eliminated duplicate BeautifulSoup parse calls (previously parsed once per branch; now parsed once and reused).

**Before:**
```python
preview = response.text[:8000].lower()
score = ...
if score >= 3:
    pass
elif score >= 1:
    soup = BeautifulSoup(response.text, "lxml")  # parse #1
    ...
    return cleaned, "PRESS_RELEASE"
soup = BeautifulSoup(response.text, "lxml")  # parse #2
...
return cleaned, "SUCCESS"
```

**After:**
```python
soup = BeautifulSoup(response.text, "lxml")   # parse once
raw = soup.get_text(separator="\n", strip=True)
cleaned = re.sub(r"\n{3,}", "\n\n", raw)
preview = cleaned[:8000].lower()              # score plain text
score = ...
if score >= 3:
    return cleaned, "SUCCESS"
elif score >= 1:
    return cleaned, "PRESS_RELEASE"
else:
    return None, "NO_TRANSCRIPT"
```

**Impact across 5 demo tickers:**

| Ticker | Before | After |
|---|---|---|
| AAPL | 9 transcripts | 9 transcripts — unchanged |
| MSFT | 0 transcripts / 7 press releases | 7 transcripts / 0 press releases |
| GOOGL | 0 transcripts / 11 press releases | 11 transcripts / 0 press releases |
| AMZN | 0 press releases / 8 skipped | 6 press releases / 2 skipped |
| META | 0 transcripts / 6 press releases | 6 transcripts / 0 press releases |

All 133 tests pass (130 original + 3 added by post-close review patches).

### File List

- ml-sidecar/src/models/ingestion_models.py
- ml-sidecar/src/services/ingestion_service.py
- ml-sidecar/tests/test_ingestion.py
- api/src/db/schema.ts

### Review Findings

- [x] [Review][Patch] Cached PRESS_RELEASE not counted in `press_releases_extracted` on cache hit [ml-sidecar/src/services/ingestion_service.py:276]
- [x] [Review][Patch] FETCH_ERROR unconditionally overwrites a previously found PRESS_RELEASE in exhibit loop [ml-sidecar/src/services/ingestion_service.py:344]
- [x] [Review][Patch] Score=1 boundary not tested — AC1 specifies 1–2 matches but only score=2 is covered by `_PRESS_RELEASE_HTML` [ml-sidecar/tests/test_ingestion.py]
- [x] [Review][Patch] Missing test for cached PRESS_RELEASE cache-hit path (AC5) — no test in `test_caching.py` verifies `press_releases_extracted` is incremented on cache hit [ml-sidecar/tests/test_caching.py]
- [x] [Review][Patch] Missing test: FETCH_ERROR on exhibit 2 should not overwrite a PRESS_RELEASE found on exhibit 1 [ml-sidecar/tests/test_ingestion.py]
- [x] [Review][Patch] Misleading comment in `test_press_release_persisted_to_cache` — "exhibit 2 → PRESS_RELEASE (loop continues)" implies it is processed, but the `best_status == "NO_TRANSCRIPT"` guard silently ignores it [ml-sidecar/tests/test_ingestion.py]
- [x] [Review][Defer] `parse_status` DB column has no CHECK constraint — text column accepts any value; no enum enforcement [api/src/db/schema.ts:169] — deferred, pre-existing
- [x] [Review][Defer] No `TranscriptResult` appended when `_get_exhibit_documents` returns empty list — inconsistency with other failure paths [ml-sidecar/src/services/ingestion_service.py:314] — deferred, pre-existing
