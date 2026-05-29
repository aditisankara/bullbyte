// Frontend mirror of the SSE progress contract.
//
// KEEP IN SYNC with api/src/jobs/dto/progress-event.dto.ts — this is the shared
// contract with FastAPI for the 5.3 webhook relay (SP3). Do not diverge the
// event names or payload shape without joint sign-off on the API side.

/** Canonical SSE event names (kebab-case), in pipeline order. */
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

/** Canonical progress payload streamed to the client. */
export interface ProgressEvent {
  event: SseEventName;
  jobId: string;
  stepIndex: number;
  totalSteps: number;
  message: string;
  timestamp: string; // ISO8601
}

/** Visual treatment for a step row in the progress feed (UX-DR1). */
export type StepStatus = 'in-progress' | 'completed' | 'failed';

/** True once a terminal event has arrived and the stream has closed. */
export function isTerminal(event: SseEventName): boolean {
  return TERMINAL_EVENTS.includes(event);
}

/**
 * Status of a *received* event row. Every received event represents a finished
 * step (it arrives when the step completes), so it's `completed` — except
 * `analysis-failed`, which is `failed`. The `in-progress` status is reserved
 * for the synthetic trailing row shown while the run continues.
 */
export function statusForEvent(event: SseEventName): Exclude<StepStatus, 'in-progress'> {
  return event === 'analysis-failed' ? 'failed' : 'completed';
}
