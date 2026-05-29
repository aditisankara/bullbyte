import {
  SSE_EVENTS,
  TERMINAL_EVENTS,
  isTerminal,
  statusForEvent,
} from './progress-event';

describe('progress-event contract', () => {
  it('defines the six canonical SSE event names', () => {
    expect(SSE_EVENTS).toEqual([
      'analysis-started',
      'transcript-fetched',
      'claims-extracted',
      'claim-verified',
      'analysis-complete',
      'analysis-failed',
    ]);
  });

  it('treats only complete/failed as terminal', () => {
    expect(TERMINAL_EVENTS).toEqual(['analysis-complete', 'analysis-failed']);
    expect(isTerminal('analysis-complete')).toBe(true);
    expect(isTerminal('analysis-failed')).toBe(true);
    expect(isTerminal('claim-verified')).toBe(false);
  });

  it('maps received events to completed, except failure', () => {
    expect(statusForEvent('analysis-started')).toBe('completed');
    expect(statusForEvent('claims-extracted')).toBe('completed');
    expect(statusForEvent('analysis-complete')).toBe('completed');
    expect(statusForEvent('analysis-failed')).toBe('failed');
  });
});
