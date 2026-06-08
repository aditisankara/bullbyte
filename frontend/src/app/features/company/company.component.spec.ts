import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { CompanyComponent } from './company.component';
import { httpErrorInterceptor } from '../../core/interceptors/http-error.interceptor';
import { CompanySummary } from '../../core/api/company.models';
import {
  FakeEventSource,
  progressEvent,
  provideFakeEventSource,
} from '../../core/api/testing/fake-event-source';
import { environment } from '../../../environments/environment';

const SUMMARY: CompanySummary = {
  id: 'c-1',
  ticker: 'TSLA',
  name: 'Tesla, Inc.',
  lastAnalysedAt: '2026-06-01T00:00:00.000Z',
  jobStatus: 'COMPLETED',
  latestJobId: 'job-1',
};

/** Summary mid-analysis — the live feed should render instead of the layout. */
const RUNNING_SUMMARY: CompanySummary = {
  ...SUMMARY,
  lastAnalysedAt: null,
  jobStatus: 'RUNNING',
  latestJobId: 'job-9',
};

/** The score slot's 6.4 card fetches the score whenever the dashboard renders. */
const NO_SCORE = {
  ticker: 'TSLA',
  score: null,
  deliveredCount: 0,
  missedCount: 0,
  totalResolved: 0,
  pendingCount: 0,
  insufficientDataCount: 0,
  context: 'No resolved claims yet',
};

describe('CompanyComponent', () => {
  let http: HttpTestingController;
  let sources: FakeEventSource[];

  beforeEach(async () => {
    sources = [];
    await TestBed.configureTestingModule({
      imports: [CompanyComponent],
      providers: [
        provideHttpClient(withInterceptors([httpErrorInterceptor])),
        provideHttpClientTesting(),
        provideFakeEventSource(sources),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(ticker = 'TSLA') {
    const fixture = TestBed.createComponent(CompanyComponent);
    fixture.componentRef.setInput('ticker', ticker);
    fixture.detectChanges();
    return fixture;
  }

  /** Satisfy the score card's GET /score that fires whenever the dashboard renders. */
  function flushScore(ticker = 'TSLA') {
    http
      .expectOne(`${environment.apiBaseUrl}/companies/${ticker}/score`)
      .flush({ ...NO_SCORE, ticker });
  }

  it('fetches the summary on load with no prior search (AC4)', () => {
    const fixture = render();
    const req = http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`);
    expect(req.request.method).toBe('GET');
    req.flush(SUMMARY);
    fixture.detectChanges();
    flushScore();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Tesla, Inc.');
    expect(el.querySelector('h1')?.textContent).toContain('TSLA');
  });

  it('normalises a lowercase route ticker before calling the API (AC4)', () => {
    render('tsla');
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
  });

  it('renders one h1 and the four layout sections (AC5)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();
    flushScore();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.querySelector('app-company-page-layout')).not.toBeNull();
    // The score slot now hosts the live 6.4 card (its own h2); the other three
    // slots keep their pending placeholders until 6.3/6.5/6.6 wire them.
    const headings = Array.from(el.querySelectorAll('h2')).map(
      (h) => h.textContent?.trim(),
    );
    expect(headings).toEqual([
      'CEO Delivery Score',
      'Promise timeline',
      'Claims',
      'Claim detail',
    ]);
  });

  it('renders ticker-not-found on a 404 (AC3 shape, UX-DR6)', () => {
    const fixture = render('XYZ');
    http
      .expectOne(`${environment.apiBaseUrl}/companies/XYZ`)
      .flush(
        { statusCode: 404, error: 'NOT_FOUND', code: 'TICKER_NOT_FOUND' },
        { status: 404, statusText: 'Not Found' },
      );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-error-state')).not.toBeNull();
    expect(el.textContent).toContain('No filings found');
    expect(el.textContent).not.toContain('TICKER_NOT_FOUND');
  });

  it('renders the live progress feed instead of the layout while a run is live (6.2 AC1)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(RUNNING_SUMMARY);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-analysis-progress')).not.toBeNull();
    expect(el.querySelector('app-company-page-layout')).toBeNull();
    expect(sources.length).toBe(1);
    expect(sources[0].url).toBe(`${environment.apiBaseUrl}/jobs/job-9/progress`);
  });

  it('refetches the summary when the live run completes, then renders the dashboard (6.2 AC3)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(RUNNING_SUMMARY);
    fixture.detectChanges();

    sources[0].emit(progressEvent('analysis-complete', { jobId: 'job-9' }));
    fixture.detectChanges();

    // (completed) → load() refetches without a manual page refresh.
    http
      .expectOne(`${environment.apiBaseUrl}/companies/TSLA`)
      .flush({ ...SUMMARY, latestJobId: 'job-9' });
    fixture.detectChanges();
    flushScore();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-analysis-progress')).toBeNull();
    expect(el.querySelector('app-company-page-layout')).not.toBeNull();
  });

  it('refetches when the bound ticker changes (URL is the source of truth)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();
    flushScore('TSLA');
    fixture.detectChanges();

    fixture.componentRef.setInput('ticker', 'NVDA');
    fixture.detectChanges();
    http
      .expectOne(`${environment.apiBaseUrl}/companies/NVDA`)
      .flush({ ...SUMMARY, id: 'c-2', ticker: 'NVDA', name: 'NVIDIA Corp.' });
    fixture.detectChanges();
    flushScore('NVDA');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent,
    ).toContain('NVIDIA');
  });
});
