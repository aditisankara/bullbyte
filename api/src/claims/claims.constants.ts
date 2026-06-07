/**
 * Verdict confidence below this is flagged `lowConfidence: true` (FR40).
 * Must stay in lockstep with the frontend threshold in
 * frontend/src/app/shared/confidence-indicator (LOW_CONFIDENCE_THRESHOLD).
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Fixed page size for the claims timeline (AC1). */
export const CLAIMS_PAGE_SIZE = 20;

/** Claims are served from the most recent N distinct quarters (FR31). */
export const CLAIMS_QUARTER_WINDOW = 8;
