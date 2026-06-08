import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { CompanyComponent } from './company.component';
import { httpErrorInterceptor } from '../../core/interceptors/http-error.interceptor';
import { CompanySummary } from '../../core/api/company.models';
import { ClaimListItem, ClaimListResponse } from '../../core/api/claim.models';
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

function claim(overrides: Partial<ClaimListItem> = {}): ClaimListItem {
  return {
    id: 'cl-1',
    quarter: 'Q3-2024',
    rawQuote: 'We expect MAU to reach 620M.',
    speaker: 'Daniel Ek',
    metric: 'MAU guidance',
    targetValue: '620M',
    targetUnit: 'users',
    extractionConfidence: 0.82,
    verdict: {
      id: 'v-1',
      verdictType: 'DELIVERED',
      delta: '+5M (+1.0%)',
      confidenceScore: 0.9,
      isCorrection: false,
      createdAt: '2026-06-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

function claimsPayload(data: ClaimListItem[] = []): ClaimListResponse {
  return { data, meta: { total: data.length, page: 1, pageSize: 20 } };
}
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
        provideRouter([]),
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

  /** Flush the claims request a completed-summary render fires (6.3). */
  function flushClaims(data: ClaimListItem[] = [], ticker = 'TSLA') {
    http
      .expectOne(`${environment.apiBaseUrl}/companies/${ticker}/claims`)
      .flush(claimsPayload(data));
  }

  it('fetches the summary on load with no prior search (AC4)', () => {
    const fixture = render();
    const req = http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`);
    expect(req.request.method).toBe('GET');
    req.flush(SUMMARY);
    fixture.detectChanges();
    flushClaims();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Tesla, Inc.');
    expect(el.querySelector('h1')?.textContent).toContain('TSLA');
  });

  it('normalises a lowercase route ticker before calling the API (AC4)', () => {
    render('tsla');
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    flushClaims();
  });

  it('renders one h1 and the four layout section headings (AC5)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();
    flushClaims();
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
    flushClaims();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-analysis-progress')).toBeNull();
    expect(el.querySelector('app-company-page-layout')).not.toBeNull();
  });

  it('refetches when the bound ticker changes (URL is the source of truth)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();
    flushClaims();

    fixture.componentRef.setInput('ticker', 'NVDA');
    fixture.detectChanges();
    http
      .expectOne(`${environment.apiBaseUrl}/companies/NVDA`)
      .flush({ ...SUMMARY, id: 'c-2', ticker: 'NVDA', name: 'NVIDIA Corp.' });
    fixture.detectChanges();
    flushClaims([], 'NVDA');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent,
    ).toContain('NVIDIA');
  });

  // ── 6.3: promise timeline + claims ────────────────────────────────────────

  it('fetches claims and renders the timeline + claim cards chronologically (AC1)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();
    flushClaims([
      claim({ id: 'q4', quarter: 'Q4-2024' }),
      claim({ id: 'q1', quarter: 'Q1-2024' }),
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-promise-timeline')).not.toBeNull();
    const cards = Array.from(el.querySelectorAll('app-claim-card'));
    expect(cards.length).toBe(2);
    // oldest-first: Q1 2024 before Q4 2024
    expect(cards[0].textContent).toContain('Q1 2024');
    expect(cards[1].textContent).toContain('Q4 2024');
  });

  it('shows "No claims yet" when the timeline is empty, not an error (AC1, 5.5 AC4)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();
    flushClaims([]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No claims yet');
    expect(el.querySelector('app-claim-card')).toBeNull();
    expect(el.querySelector('[claims] app-error-state')).toBeNull();
  });

  it('renders an inline error if the claims fetch fails, keeping the header (AC1)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();
    http
      .expectOne(`${environment.apiBaseUrl}/companies/TSLA/claims`)
      .flush(
        { statusCode: 503, error: 'UNAVAILABLE', code: 'EDGAR_UNAVAILABLE' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Tesla, Inc.');
    expect(el.querySelector('app-company-page-layout app-error-state')).not.toBeNull();
  });

  it('does not fetch claims while a run is live (6.2 / 6.3 boundary)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(RUNNING_SUMMARY);
    fixture.detectChanges();

    // No claims request is issued; afterEach http.verify() would fail otherwise.
    http.expectNone(`${environment.apiBaseUrl}/companies/TSLA/claims`);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-claim-card'),
    ).toBeNull();
  });

  it('filters to the selected quarter and writes ?quarter= to the URL (AC3)', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();
    flushClaims([
      claim({ id: 'q1', quarter: 'Q1-2024' }),
      claim({ id: 'q2', quarter: 'Q2-2024' }),
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // Click the Q2-2024 bar (oldest-first → second column) — emits source index 1.
    const bars = el.querySelectorAll('app-promise-timeline .timeline__bar');
    (bars[1] as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/company', 'TSLA'], {
      queryParams: { quarter: 'Q2-2024' },
      queryParamsHandling: 'merge',
    });

    // A deep load with ?quarter= restores the filtered view (input round-trip).
    fixture.componentRef.setInput('quarter', 'Q2-2024');
    fixture.detectChanges();
    const cards = Array.from(el.querySelectorAll('app-claim-card'));
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Q2 2024');
  });

  it('marks the activated claim card as selected (AC4 selection contract)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();
    flushClaims([
      claim({ id: 'cl-1', quarter: 'Q1-2024' }),
      claim({ id: 'cl-2', quarter: 'Q1-2024', metric: 'ARPU guidance' }),
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('app-claim-card .card__action');
    (buttons[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    const selected = el.querySelectorAll('app-claim-card .card--selected');
    expect(selected.length).toBe(1);
  });
});
