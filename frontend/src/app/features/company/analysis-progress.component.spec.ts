import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { AnalysisProgressComponent } from './analysis-progress.component';
import {
  FakeEventSource,
  progressEvent,
  provideFakeEventSource,
} from '../../core/api/testing/fake-event-source';
import { httpErrorInterceptor } from '../../core/interceptors/http-error.interceptor';
import { environment } from '../../../environments/environment';

describe('AnalysisProgressComponent', () => {
  let http: HttpTestingController;
  let sources: FakeEventSource[];

  beforeEach(async () => {
    sources = [];
    await TestBed.configureTestingModule({
      imports: [AnalysisProgressComponent],
      providers: [
        provideHttpClient(withInterceptors([httpErrorInterceptor])),
        provideHttpClientTesting(),
        provideFakeEventSource(sources),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(jobId = 'job-1', ticker = 'TSLA') {
    const fixture = TestBed.createComponent(AnalysisProgressComponent);
    fixture.componentRef.setInput('jobId', jobId);
    fixture.componentRef.setInput('ticker', ticker);
    fixture.detectChanges();
    return fixture;
  }

  it('connects to the job stream and never renders blank before the first event (AC1, AC2)', () => {
    const fixture = render();

    expect(sources.length).toBe(1);
    expect(sources[0].url).toBe(`${environment.apiBaseUrl}/jobs/job-1/progress`);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Starting analysis…');
  });

  it('appends one step row per received event, in order (AC2)', () => {
    const fixture = render();

    sources[0].emit(
      progressEvent('analysis-started', { message: 'Queued for analysis' }),
    );
    sources[0].emit(
      progressEvent('transcript-fetched', { message: 'Fetched the Q1 transcript' }),
    );
    fixture.detectChanges();

    const messages = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.step__message'),
    ).map((node) => node.textContent?.trim());
    // Two completed steps + the trailing in-progress row (UX-DR1).
    expect(messages).toEqual([
      'Queued for analysis',
      'Fetched the Q1 transcript',
      'Working…',
    ]);
  });

  it('emits completed on analysis-complete, and the stream is closed (AC3)', () => {
    const fixture = render();
    let completed = 0;
    fixture.componentInstance.completed.subscribe(() => completed++);

    sources[0].emit(
      progressEvent('analysis-complete', { message: 'Analysis complete' }),
    );
    fixture.detectChanges();

    expect(completed).toBe(1);
    expect(sources[0].closed).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-error-state'),
    ).toBeNull();
  });

  it('renders the failure error state on analysis-failed (AC4, UX-DR6)', () => {
    const fixture = render();

    sources[0].emit(progressEvent('analysis-failed', { message: 'Analysis failed' }));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-error-state')).not.toBeNull();
    expect(el.textContent).toContain('Analysis failed');
    expect(el.textContent).toContain('Re-run analysis');
  });

  it('retry POSTs a fresh analyze and reconnects to the new job (AC4)', () => {
    const fixture = render();
    sources[0].emit(progressEvent('analysis-failed'));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('.error__retry')?.click();
    http
      .expectOne(`${environment.apiBaseUrl}/companies/TSLA/analyze`)
      .flush({ jobId: 'job-2', status: 'QUEUED' });
    fixture.detectChanges();

    expect(sources.length).toBe(2);
    expect(sources[1].url).toBe(`${environment.apiBaseUrl}/jobs/job-2/progress`);
    // Feed reset for the new run: error gone, pending row back.
    expect(el.querySelector('app-error-state')).toBeNull();
    expect(el.textContent).toContain('Starting analysis…');
  });

  it('emits completed directly when the retry analyze is a cache hit (AC4→AC3)', () => {
    const fixture = render();
    let completed = 0;
    fixture.componentInstance.completed.subscribe(() => completed++);
    sources[0].emit(progressEvent('analysis-failed'));
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.error__retry')
      ?.click();
    http
      .expectOne(`${environment.apiBaseUrl}/companies/TSLA/analyze`)
      .flush({ jobId: null, status: 'COMPLETED', cached: true });
    fixture.detectChanges();

    expect(completed).toBe(1);
    expect(sources.length).toBe(1); // no new stream opened
  });

  it('closes the EventSource when the component is destroyed (AC5)', () => {
    const fixture = render();
    expect(sources[0].closed).toBe(false);

    fixture.destroy();

    expect(sources[0].closed).toBe(true);
  });
});
