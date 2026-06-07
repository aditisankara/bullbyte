import { TestBed } from '@angular/core/testing';
import { ProgressStreamService } from './progress-stream.service';
import {
  FakeEventSource,
  progressEvent,
  provideFakeEventSource,
} from './testing/fake-event-source';
import { ProgressEvent } from '../../shared/analysis/progress-event';
import { environment } from '../../../environments/environment';

describe('ProgressStreamService', () => {
  let service: ProgressStreamService;
  let sources: FakeEventSource[];

  beforeEach(() => {
    sources = [];
    TestBed.configureTestingModule({
      providers: [provideFakeEventSource(sources)],
    });
    service = TestBed.inject(ProgressStreamService);
  });

  it('opens the 5.2 SSE URL for the job and emits typed events in order (AC1)', () => {
    const received: ProgressEvent[] = [];
    service.connect('job-1').subscribe((e) => received.push(e));

    expect(sources.length).toBe(1);
    expect(sources[0].url).toBe(`${environment.apiBaseUrl}/jobs/job-1/progress`);

    sources[0].emit(progressEvent('analysis-started', { stepIndex: 0 }));
    sources[0].emit(progressEvent('transcript-fetched', { stepIndex: 1 }));

    expect(received.map((e) => e.event)).toEqual([
      'analysis-started',
      'transcript-fetched',
    ]);
    expect(received[1].message).toBe('step: transcript-fetched');
    expect(sources[0].closed).toBe(false);
  });

  it('delivers the terminal event, then closes the EventSource and completes (AC3)', () => {
    const received: ProgressEvent[] = [];
    let completed = false;
    service.connect('job-1').subscribe({
      next: (e) => received.push(e),
      complete: () => (completed = true),
    });

    sources[0].emit(progressEvent('claims-extracted'));
    sources[0].emit(progressEvent('analysis-complete', { stepIndex: 5 }));

    expect(received.map((e) => e.event)).toEqual([
      'claims-extracted',
      'analysis-complete',
    ]);
    expect(sources[0].closed).toBe(true);
    expect(completed).toBe(true);
  });

  it('treats analysis-failed as terminal too (AC4 shape)', () => {
    let completed = false;
    service.connect('job-1').subscribe({ complete: () => (completed = true) });

    sources[0].emit(progressEvent('analysis-failed'));

    expect(sources[0].closed).toBe(true);
    expect(completed).toBe(true);
  });

  it('closes the EventSource on unsubscribe (AC5)', () => {
    const subscription = service.connect('job-1').subscribe();
    expect(sources[0].closed).toBe(false);

    subscription.unsubscribe();

    expect(sources[0].closed).toBe(true);
  });
});
