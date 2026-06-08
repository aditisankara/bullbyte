import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ScoreCardComponent } from './score-card.component';
import { CeoScoreDto } from '../../core/api/company.models';
import { environment } from '../../../environments/environment';

const RESOLVED: CeoScoreDto = {
  ticker: 'TSLA',
  score: 0.6,
  deliveredCount: 3,
  missedCount: 2,
  totalResolved: 5,
  pendingCount: 4,
  insufficientDataCount: 1,
  context: '3 of 5 resolved promises delivered — 4 pending — 1 insufficient data',
};

const NO_RESOLVED: CeoScoreDto = {
  ticker: 'TSLA',
  score: null,
  deliveredCount: 0,
  missedCount: 0,
  totalResolved: 0,
  pendingCount: 4,
  insufficientDataCount: 0,
  context: 'No resolved claims yet',
};

describe('ScoreCardComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScoreCardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(ticker = 'TSLA') {
    const fixture = TestBed.createComponent(ScoreCardComponent);
    fixture.componentRef.setInput('ticker', ticker);
    fixture.detectChanges();
    return fixture;
  }

  function flushScore(dto: CeoScoreDto, ticker = 'TSLA') {
    http
      .expectOne(`${environment.apiBaseUrl}/companies/${ticker}/score`)
      .flush(dto);
  }

  it('fetches the score and renders the card, mapping 0–1 onto the 0–10 ring (AC1)', () => {
    const fixture = render();
    flushScore(RESOLVED);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-ceo-score-card')).not.toBeNull();
    expect(el.querySelector('.score__num')?.textContent?.trim()).toBe('6.0');
  });

  it('shows delivered/missed/pending counts and the API context, no Revised (AC1, FR23)', () => {
    const fixture = render();
    flushScore(RESOLVED);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.score__context')?.textContent).toContain(
      '3 of 5 resolved promises delivered',
    );
    const stats = Array.from(el.querySelectorAll('.score__stat-value')).map((n) =>
      n.textContent?.trim(),
    );
    // delivered, missed, pending, insufficient — Revised is suppressed.
    expect(stats).toEqual(['3', '2', '4', '1']);
    expect(
      Array.from(el.querySelectorAll('.score__stat-label')).map((n) =>
        n.textContent?.trim(),
      ),
    ).not.toContain('Revised');
  });

  it('exposes the score value through a semantic heading (AC3)', () => {
    const fixture = render();
    flushScore(RESOLVED);
    fixture.detectChanges();

    const heading = (fixture.nativeElement as HTMLElement).querySelector(
      'h2.score__ring-num',
    );
    expect(heading).not.toBeNull();
    expect(heading?.getAttribute('aria-label')).toBe(
      'CEO Delivery Score 6.0 out of 10',
    );
  });

  it('suppresses the trend indicator — 5.6 ships no prior-window datum', () => {
    const fixture = render();
    flushScore(RESOLVED);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.score__trend'),
    ).toBeNull();
  });

  it('renders the no-resolved empty state with the pending count, not a zero (AC2)', () => {
    const fixture = render();
    flushScore(NO_RESOLVED);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-ceo-score-card')).toBeNull();
    expect(el.textContent).toContain('No resolved claims yet');
    expect(el.textContent).not.toContain('0.0');
    expect(el.textContent).toContain('4 claims are still pending');
  });

  it('refetches when the bound ticker changes', () => {
    const fixture = render();
    flushScore(NO_RESOLVED);
    fixture.detectChanges();

    fixture.componentRef.setInput('ticker', 'NVDA');
    fixture.detectChanges();
    flushScore({ ...RESOLVED, ticker: 'NVDA' }, 'NVDA');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-ceo-score-card'),
    ).not.toBeNull();
  });

  it('shows an inline unavailable note on error, not the full-page error state', () => {
    const fixture = render();
    http
      .expectOne(`${environment.apiBaseUrl}/companies/TSLA/score`)
      .flush({ code: 'INTERNAL' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('unavailable');
    expect(el.querySelector('app-error-state')).toBeNull();
    expect(el.querySelector('app-ceo-score-card')).toBeNull();
  });
});
