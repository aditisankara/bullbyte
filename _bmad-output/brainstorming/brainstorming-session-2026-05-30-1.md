---
stepsCompleted: [1]
inputDocuments: []
session_topic: 'BullByte data strategy — transcript/press release sourcing limitations and alternatives'
session_goals: 'Identify better approaches to document classification, expand data sources beyond EDGAR 8-Ks, handle AMZN-style gaps, improve claim extraction coverage for Epic 4'
selected_approach: ''
techniques_used: []
ideas_generated: []
context_file: ''
---

## Session Overview

**Topic:** BullByte data strategy — transcript/press release sourcing limitations and alternatives
**Goals:** Identify better approaches to document classification, expand data sources beyond EDGAR 8-Ks, handle AMZN-style gaps, improve claim extraction coverage for Epic 4

### Context Guidance

- Current pipeline fetches 8-K exhibits from EDGAR and classifies them using a 7-keyword scorer
- Manual test revealed: AAPL → full transcripts (SUCCESS), MSFT/GOOGL/META → press releases (PRESS_RELEASE), AMZN → 0 usable docs (all skipped)
- Keyword scorer is fragile: "operator", "conference call", "earnings call", "q&a", "fiscal quarter", "per share", "revenue"
- AMZN likely files PDF exhibits or has boilerplate-heavy HTML preamble that pushes content past the 8000-char preview window
- Epic 4 needs text to extract forward-guidance claims from — AMZN is a dead end right now
- Legal constraint: scraping licensed content (Seeking Alpha) is prohibited; need licensed or public-domain sources

### Session Setup

_Initialized from conversation context — 2026-05-31. Session ran as Phase 1 (Expansive Exploration) of a Progressive Technique Flow. Phases 2–4 deferred to next session._

---

## Phase 1 Ideas Generated

### Cluster A — Replace keyword scoring with better classification

**[Source #1]: Exhibit Label Classifier**
_Concept:_ EDGAR's filing index already contains a human-readable exhibit description ("Earnings Release", "Press Release", "Transcript of Earnings Call"). Parse the label from the index metadata before fetching the document — only download when the label is ambiguous or missing.
_Novelty:_ Zero document downloads for clear cases. Eliminates the need for content-based scoring entirely for well-labelled filings.

**[Source #2]: Content-Type Gate**
_Concept:_ Detect MIME type of the EDGAR response before scoring. If `application/pdf`, route to a PDF text extractor (pdfminer/pypdf) instead of BeautifulSoup. If plain `.txt`, skip lxml.
_Novelty:_ Fixes PDF-class failures as a pre-processing step, independent of the scorer.

**[Hotfix — SHIPPED 2026-05-31]:** Strip HTML to plain text before keyword scoring.
Root cause found during session: AMZN's EX-99.1 is 578KB HTML with heavy inline CSS. All keywords existed in the document but appeared past the 8000-char raw HTML preview window. Fix: `BeautifulSoup → get_text() → score plain text[:8000]`. Result: AMZN 0→6 press releases, MSFT/GOOGL/META reclassified from PRESS_RELEASE→SUCCESS. One line change, 133 tests passing.

---

### Cluster B — Alternative primary sources (free, legal)

**[Source #3]: IR Page Direct Fetch**
_Concept:_ Every public company has an investor relations page. Many post earnings transcripts or prepared remarks directly there within 48 hours — often cleaner HTML than the EDGAR exhibit.
_Novelty:_ IR pages are public domain, no ToS risk. Companies that file PDFs with SEC often post HTML on their own site.

**[Source #3a]: IR Platform Template Detector**
_Concept:_ Most large-cap companies use one of ~5 IR platform vendors (Q4 Inc, Notified, Business Wire etc.). HTML structure is templated by vendor. Write one parser per vendor template — 5 parsers covers ~80% of S&P 500.
_Novelty:_ Scales without per-company scrapers.

**[Source #3b]: Earnings Webcast Transcript Auto-Post**
_Concept:_ Many companies post a "Prepared Remarks" PDF on their IR page within 48 hours of the call — separate from the SEC filing, often more complete.
_Novelty:_ Company-distributed content, no copyright ambiguity.

**[Source #3c]: SEC Company Search as IR Locator**
_Concept:_ EDGAR's company search API returns the registered company website URL. Use as the starting point for IR page discovery — legally sourced, no scraping.

**[Source #3d]: Search API as IR Page Locator**
_Concept:_ Query `"{company name} investor relations earnings transcript"` via Brave Search API or SerpAPI (both have free tiers). Use top result URL. No hardcoding, generalises to any ticker.
_Novelty:_ Search as infrastructure for discovery, not as content source.

**[Source #4a]: yfinance Earnings Data Harvest (already in stack)**
_Concept:_ yfinance exposes `ticker.earnings_dates`, `ticker.news`, `ticker.earnings_history` — structured data including analyst estimates vs actuals, surprise %, and linked news articles. Currently unused beyond financial actuals.
_Novelty:_ Zero new dependencies. Data already accessible.

**[Source #4b]: PR Newswire / Business Wire RSS — RECOMMENDED TIER 2**
_Concept:_ Earnings press releases are distributed via PR Newswire or Business Wire before they hit EDGAR. Both have free RSS feeds. Subscribe once, receive new press releases as structured XML with source name and URL built in.
_Novelty:_ Primary source (company-approved), not journalist interpretation. Source attribution is automatic. Fresher than EDGAR. Clean HTML.
_Limitation:_ Real-time only — no historical backfill. Use EDGAR for historical, RSS for new quarters going forward.

**[Source #4c]: SEC EDGAR Full-Text Search**
_Concept:_ EDGAR's full-text search API (`efts.sec.gov`) allows querying across all filings for specific phrases. Instead of "get document → extract claims", query for claim patterns directly.
_Novelty:_ Inverts the pipeline — claim patterns searched upstream rather than extracted downstream.

---

### Cluster C — Alternative signals (not documents)

**[Signal #1]: 8-K Item 7.01 / 8.01 — Conference Filings**
_Concept:_ Companies file 8-Ks when executives present at investor conferences (item 7.01/8.01, not 2.02 which is earnings). These often contain slide decks and prepared remarks. Same EDGAR pipeline, different form item filter.
_Novelty:_ Doubles claim surface area with zero new infrastructure.

**[Signal #2]: SEC Form 4 as Insider Sentiment Signal**
_Concept:_ CEO stock purchases (Form 4, mandatory, machine-readable on EDGAR) are behavioral forward-guidance signals. Cross-reference with extracted claims to validate management confidence.
_Novelty:_ Reading behavior as a claim, not text.

**[Signal #3]: Earnings Webcast Audio → Whisper Transcription**
_Concept:_ Companies livestream earnings calls and post replays publicly on IR pages. Whisper (open-source, runs locally) transcribes the audio — full Q&A included.
_Novelty:_ Solves the no-transcript problem completely for any company. Legal — public broadcast, fair use for analysis, no redistribution.
_Cost:_ GPU helpful but not required; latency is the trade-off.

**[Signal #4]: Regulatory Filings Beyond SEC**
_Concept:_ FDA approval letters, FCC filings, FTC merger reviews, EU competition filings — all public, all containing forward-looking language specific to their domain.
_Novelty:_ Completely untapped by retail tools. Cross-referencing earnings claims against regulatory filings reveals contradictions.

**[Signal #5]: Claim Absence Detection**
_Concept:_ The gap between what management volunteers and what analysts drag out of them is itself a signal. Flag topics NOT mentioned in a press release (no margin guidance, no segment breakdown) as negative signals alongside positive extracted claims.
_Novelty:_ Absence of a claim is treated as meaningful data, not a null result.

**[Signal #6]: NewsAPI + CEO Quote Extraction**
_Concept:_ When a CEO makes a public statement anywhere (CNBC, conference, earnings call), it gets covered by 3–4 outlets within hours. Extract the CEO quote from the news article via LLM. Source attribution comes from the API (`source.name` + `url`).
_Novelty:_ News coverage as a proxy transcript. Legal, structured, aggregated. Secondary source — two steps from original.
_Assessment:_ Less reliable than primary sources for a claims tool. Better as supplementary (CEO statements outside earnings) than primary.

**[Signal #7]: Earnings Call Timing as Signal**
_Concept:_ When a company schedules its earnings call matters — Friday after-hours, postponements, unusually short calls. Pure metadata from EDGAR timestamps + calendar data.
_Novelty:_ Zero NLP. Behavioral signal usable as a confidence modifier on extracted claims.

---

## Key Findings from Session

1. **The keyword scorer was the wrong abstraction from the start.** It conflates document type detection with content quality assessment using 7 hardcoded strings. The HTML-stripping hotfix was the immediate win; the longer-term fix is exhibit label detection from the EDGAR filing index.

2. **AMZN's gap was a technical fault, not a data gap.** The document existed, was HTML, and contained all relevant keywords — they just appeared past the 8000-char raw HTML preview window. One-line fix resolved it.

3. **Business Wire / PR Newswire RSS is the strongest Tier 2 source.** Primary source, free, self-attributing, cleaner than EDGAR exhibits. Best for new quarters going forward; EDGAR remains the backfill source.

4. **NewsAPI is a Tier 3 supplementary source, not a replacement.** Useful for CEO statements made outside earnings (conferences, interviews) but is a secondary source two steps from the original — credibility risk for a claims tool.

5. **Whisper transcription of public webcasts is the nuclear option** — solves every transcript gap legally, but adds operational complexity (audio download, transcription latency). Revisit if press release quality proves insufficient for Epic 4 claim extraction.

6. **Epic 4 should be aware of `parse_status`** when calibrating claim confidence. A claim from a `SUCCESS` transcript carries more weight than one from a `PRESS_RELEASE` — Q&A pressure from analysts is absent in press releases.

---

## Recommended Prioritisation (to revisit in Phase 2)

| Priority | Action | Effort |
|---|---|---|
| Done ✅ | HTML-strip hotfix | Shipped |
| Next | Exhibit label classifier (replace keyword scorer) | 1 story |
| Next | Start Epic 4 on current data | Epic |
| Later | Business Wire/PR Newswire RSS for new quarters | 1 story |
| Later | 8-K item 7.01/8.01 conference filings | 1 story |
| Evaluate | Whisper transcription | Based on Epic 4 yield |
| Defer | NewsAPI, Form 4, regulatory filings | Post-Epic 4 |

---

## Deferred to Next Session (Phases 2–4)

- **Phase 2 (Six Thinking Hats):** Pressure-test the recommended prioritisation above — facts, risks, benefits, creativity, emotion, process lenses
- **Phase 3 (Assumption Reversal):** Challenge assumptions baked into the current pipeline design
- **Phase 4 (Decision Tree):** Map each direction to build cost, Epic 4 impact, legal risk, sequencing → output as concrete stories
