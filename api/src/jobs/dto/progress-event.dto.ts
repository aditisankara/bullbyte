/**
 * Canonical SSE event names (kebab-case). This set is the shared contract with
 * FastAPI for the 5.3 webhook relay (SP3) — do not change without joint sign-off.
 */
export const SSE_EVENTS = [
	'analysis-started',
	'transcript-fetched',
	'claims-extracted',
	'claim-verified',
	'analysis-complete',
	'analysis-failed',
] as const;

export type SseEventName = (typeof SSE_EVENTS)[number];

/** Events after which the SSE stream is closed. */
export const TERMINAL_EVENTS: readonly SseEventName[] = [
	'analysis-complete',
	'analysis-failed',
];

/** Canonical progress payload streamed to the client (and received from FastAPI). */
export interface ProgressEvent {
	event: SseEventName;
	jobId: string;
	stepIndex: number;
	totalSteps: number;
	message: string;
	timestamp: string; // ISO8601
}
