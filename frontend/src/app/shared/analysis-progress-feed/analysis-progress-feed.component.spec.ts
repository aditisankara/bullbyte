import { TestBed } from '@angular/core/testing';
import { AnalysisProgressFeedComponent } from './analysis-progress-feed.component';
import { ProgressEvent, SseEventName } from '../analysis/progress-event';

function ev(event: SseEventName, stepIndex: number, message: string): ProgressEvent {
  return {
    event,
    jobId: 'job-1',
    stepIndex,
    totalSteps: 12,
    message,
    timestamp: `2026-05-29T10:0${stepIndex}:00Z`,
  };
}

describe('AnalysisProgressFeedComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisProgressFeedComponent],
    }).compileComponents();
  });

  function render(events: ProgressEvent[], activeLabel?: string) {
    const fixture = TestBed.createComponent(AnalysisProgressFeedComponent);
    fixture.componentRef.setInput('events', events);
    if (activeLabel !== undefined) {
      fixture.componentRef.setInput('activeLabel', activeLabel);
    }
    fixture.detectChanges();
    return fixture;
  }

  function rowText(el: HTMLElement): string[] {
    return Array.from(el.querySelectorAll('.step__message')).map((n) => n.textContent!.trim());
  }

  it('renders an append-only log region (aria-live additions)', () => {
    const el = render([]).nativeElement as HTMLElement;
    const log = el.querySelector('ol.feed');
    expect(log?.getAttribute('role')).toBe('log');
    expect(log?.getAttribute('aria-live')).toBe('polite');
    expect(log?.getAttribute('aria-relevant')).toBe('additions');
  });

  it('renders a completed row per received step plus an in-progress trailer while running', () => {
    const el = render([
      ev('analysis-started', 0, 'Locating earnings call transcripts…'),
      ev('claims-extracted', 1, 'Extracted 14 claims…'),
    ], 'Verifying claim 1 of 14…').nativeElement as HTMLElement;

    const messages = rowText(el);
    expect(messages).toEqual([
      'Locating earnings call transcripts…',
      'Extracted 14 claims…',
      'Verifying claim 1 of 14…',
    ]);
    const statuses = Array.from(el.querySelectorAll('.step')).map((n) => n.getAttribute('data-status'));
    expect(statuses).toEqual(['completed', 'completed', 'in-progress']);
    expect(el.querySelector('.step__dot')).not.toBeNull();
  });

  it('appends rather than replacing existing rows when an event arrives', () => {
    const events = [ev('analysis-started', 0, 'Locating earnings call transcripts…')];
    const fixture = render(events);
    expect(rowText(fixture.nativeElement)).toContain('Locating earnings call transcripts…');

    // a new event arrives — original message is still present (appended, not replaced)
    fixture.componentRef.setInput('events', [
      ...events,
      ev('transcript-fetched', 1, 'Fetched the Q1 2024 transcript…'),
    ]);
    fixture.detectChanges();
    const messages = rowText(fixture.nativeElement);
    expect(messages).toContain('Locating earnings call transcripts…');
    expect(messages).toContain('Fetched the Q1 2024 transcript…');
  });

  it('shows no in-progress trailer once the run completes', () => {
    const el = render([
      ev('analysis-started', 0, 'Started…'),
      ev('analysis-complete', 11, 'Analysis complete — 14 claims verified.'),
    ]).nativeElement as HTMLElement;
    expect(el.querySelector('.step__dot')).toBeNull();
    expect(el.querySelectorAll('.step').length).toBe(2);
  });

  it('renders no rows with no events by default, but shows the opt-in pending row (6.2 AC2)', () => {
    // default off — 2.3 behaviour unchanged
    expect((render([]).nativeElement as HTMLElement).querySelectorAll('.step').length).toBe(0);

    const fixture = TestBed.createComponent(AnalysisProgressFeedComponent);
    fixture.componentRef.setInput('events', []);
    fixture.componentRef.setInput('pending', 'Starting analysis…');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const rows = el.querySelectorAll('.step');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-status')).toBe('in-progress');
    expect(rowText(el)).toEqual(['Starting analysis…']);

    // first real event arrives — the pending row gives way to the live rows
    fixture.componentRef.setInput('events', [ev('analysis-started', 0, 'Started…')]);
    fixture.detectChanges();
    expect(rowText(el)).toEqual(['Started…', 'Working…']);
  });

  it('renders the failed terminal step with the error treatment', () => {
    const el = render([
      ev('analysis-started', 0, 'Started…'),
      ev('analysis-failed', 3, 'EDGAR was unavailable. Analysis stopped.'),
    ]).nativeElement as HTMLElement;
    const last = el.querySelectorAll('.step')[1];
    expect(last.getAttribute('data-status')).toBe('failed');
    expect(el.querySelector('.step__dot')).toBeNull(); // terminal — no active trailer
  });
});
