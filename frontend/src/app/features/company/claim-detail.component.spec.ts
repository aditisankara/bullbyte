import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ClaimDetailComponent } from './claim-detail.component';
import { ClaimDetailApi } from '../../core/api/claim.models';
import { environment } from '../../../environments/environment';

const DETAIL: ClaimDetailApi = {
  id: 'cl-1',
  quarter: 'Q1-2024',
  rawQuote: 'We expect MAU to reach 620M.',
  speaker: 'Daniel Ek',
  metric: 'MAU guidance',
  targetValue: '620M',
  targetUnit: 'users',
  extractionConfidence: 0.82,
  verdict: {
    id: 'v-1',
    verdictType: 'MISSED',
    delta: '−18M (−2.9%)',
    confidenceScore: 0.55,
    isCorrection: false,
    createdAt: '2026-06-01T00:00:00.000Z',
  },
  edgarSourceUrl: 'https://www.sec.gov/edgar/x',
  lowConfidence: true,
  reasoningTrace: [],
};

describe('ClaimDetailComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClaimDetailComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(claimId: string | null) {
    const fixture = TestBed.createComponent(ClaimDetailComponent);
    fixture.componentRef.setInput('claimId', claimId);
    fixture.detectChanges();
    return fixture;
  }

  function flush(detail: ClaimDetailApi = DETAIL, id = 'cl-1') {
    http.expectOne(`${environment.apiBaseUrl}/claims/${id}`).flush(detail);
  }

  it('shows the empty state and makes no request when nothing is selected', () => {
    const el = render(null).nativeElement as HTMLElement;
    expect(el.querySelector('.panel--empty')).not.toBeNull();
    http.expectNone(`${environment.apiBaseUrl}/claims/cl-1`);
  });

  it('fetches and renders the detail for a selected claim (AC1)', () => {
    const fixture = render('cl-1');
    flush();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-claim-detail-panel article.panel')).not.toBeNull();
    expect(el.querySelector('.panel__quote')?.textContent).toContain('620M');
    expect(el.querySelector('.panel__attribution')?.textContent).toContain('Daniel Ek');
    expect(el.querySelector('.panel__delta')?.textContent).toContain('−18M');
    // 5.5 returns no "actual" value → the comparison block is hidden.
    expect(el.querySelector('.panel__compare')).toBeNull();
  });

  it('renders the EDGAR source link with a generic label (no type from 5.5)', () => {
    const fixture = render('cl-1');
    flush();
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector(
      '.panel__source a.panel__filing',
    ) as HTMLAnchorElement;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.textContent).toContain('EDGAR filing');
    expect(link.textContent).toContain('Q1 2024');
  });

  it('flags a low-confidence verdict without hiding it (AC3)', () => {
    const fixture = render('cl-1');
    flush();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.panel__low-note')).not.toBeNull();
    expect(el.querySelector('app-verdict-badge')).not.toBeNull();
  });

  it('shows an inline error if the detail cannot be loaded', () => {
    const fixture = render('cl-x');
    http
      .expectOne(`${environment.apiBaseUrl}/claims/cl-x`)
      .flush({ code: 'CLAIM_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('could not be loaded');
    expect(el.querySelector('app-claim-detail-panel article.panel')).toBeNull();
  });

  it('emits closed from the close control (AC5)', () => {
    const fixture = render('cl-1');
    flush();
    fixture.detectChanges();

    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    (fixture.nativeElement.querySelector('.claim-detail__close') as HTMLButtonElement).click();
    expect(closed).toBe(true);
  });

  it('emits closed on the Escape key while open (AC5)', () => {
    const fixture = render('cl-1');
    flush();
    fixture.detectChanges();

    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toBe(true);
  });

  it('ignores Escape when nothing is open', () => {
    const fixture = render(null);
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toBe(false);
  });
});
