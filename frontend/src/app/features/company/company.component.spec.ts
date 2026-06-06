import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { CompanyComponent } from './company.component';
import { httpErrorInterceptor } from '../../core/interceptors/http-error.interceptor';
import { CompanySummary } from '../../core/api/company.models';
import { environment } from '../../../environments/environment';

const SUMMARY: CompanySummary = {
  id: 'c-1',
  ticker: 'TSLA',
  name: 'Tesla, Inc.',
  lastAnalysedAt: '2026-06-01T00:00:00.000Z',
  jobStatus: 'COMPLETED',
};

describe('CompanyComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompanyComponent],
      providers: [
        provideHttpClient(withInterceptors([httpErrorInterceptor])),
        provideHttpClientTesting(),
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

  it('fetches the summary on load with no prior search (AC4)', () => {
    const fixture = render();
    const req = http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`);
    expect(req.request.method).toBe('GET');
    req.flush(SUMMARY);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Tesla, Inc.');
    expect(el.querySelector('h1')?.textContent).toContain('TSLA');
  });

  it('normalises a lowercase route ticker before calling the API (AC4)', () => {
    render('tsla');
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
  });

  it('renders one h1 and the four pending layout sections (AC5)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.querySelector('app-company-page-layout')).not.toBeNull();
    const headings = Array.from(el.querySelectorAll('h2')).map(
      (h) => h.textContent?.trim(),
    );
    expect(headings).toEqual([
      'CEO delivery score',
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

  it('refetches when the bound ticker changes (URL is the source of truth)', () => {
    const fixture = render();
    http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`).flush(SUMMARY);
    fixture.detectChanges();

    fixture.componentRef.setInput('ticker', 'NVDA');
    fixture.detectChanges();
    http
      .expectOne(`${environment.apiBaseUrl}/companies/NVDA`)
      .flush({ ...SUMMARY, id: 'c-2', ticker: 'NVDA', name: 'NVIDIA Corp.' });
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent,
    ).toContain('NVIDIA');
  });
});
