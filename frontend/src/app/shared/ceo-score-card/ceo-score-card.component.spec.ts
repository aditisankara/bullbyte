import { TestBed } from '@angular/core/testing';
import { CeoScoreCardComponent } from './ceo-score-card.component';
import { CeoScore } from '../score/ceo-score';

const SCORE: CeoScore = {
  score: 8.4,
  ceo: 'Daniel Ek',
  company: 'Spotify',
  quarters: 8,
  counts: { delivered: 8, missed: 3, pending: 2, revised: 1 },
  trend: 'up',
  trendLabel: '+0.6 vs. prior 8 quarters',
};

describe('CeoScoreCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CeoScoreCardComponent],
    }).compileComponents();
  });

  function render(
    score: CeoScore | null = SCORE,
    inputs: Record<string, unknown> = {},
  ) {
    const fixture = TestBed.createComponent(CeoScoreCardComponent);
    fixture.componentRef.setInput('score', score);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('shows the score value inside an accessible heading (AC3)', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('.score__num')?.textContent?.trim()).toBe('8.4');
    const heading = el.querySelector('h2.score__ring-num');
    expect(heading).not.toBeNull();
    expect(heading?.getAttribute('aria-label')).toBe(
      'CEO Delivery Score 8.4 out of 10',
    );
  });

  it('always shows sample-size context, never a bare fraction (FR23)', () => {
    const el = render().nativeElement as HTMLElement;
    const context = el.querySelector('.score__context')?.textContent ?? '';
    expect(context).toContain('8 of 11 resolved promises');
    expect(context).toContain('last 8 quarters');
  });

  it('handles a zero-resolved sample without showing "0 of 0"', () => {
    const el = render({
      ...SCORE,
      counts: { delivered: 0, missed: 0, pending: 4, revised: 0 },
    }).nativeElement as HTMLElement;
    const context = el.querySelector('.score__context')?.textContent ?? '';
    expect(context).toContain('no resolved promises yet');
    expect(context).not.toContain('0 of 0');
  });

  it('renders the pending-claims count among the stats', () => {
    const el = render().nativeElement as HTMLElement;
    const labels = Array.from(el.querySelectorAll('.score__stat-label')).map((n) =>
      n.textContent?.trim(),
    );
    expect(labels).toContain('Pending');
  });

  it('renders the trend indicator with direction and label', () => {
    const el = render().nativeElement as HTMLElement;
    const trend = el.querySelector('.score__trend');
    expect(trend?.getAttribute('data-trend')).toBe('up');
    expect(trend?.querySelector('.score__trend-label')?.textContent?.trim()).toBe('Improving');
    expect(trend?.querySelector('.score__trend-detail')?.textContent).toContain('+0.6');
  });

  it('maps trend down/flat to their labels', () => {
    expect(
      (render({ ...SCORE, trend: 'down' }).nativeElement as HTMLElement).querySelector(
        '.score__trend-label',
      )?.textContent?.trim(),
    ).toBe('Declining');
    expect(
      (render({ ...SCORE, trend: 'flat' }).nativeElement as HTMLElement).querySelector(
        '.score__trend-label',
      )?.textContent?.trim(),
    ).toBe('Steady');
  });

  it('draws the ring arc proportional to the score', () => {
    const el = render().nativeElement as HTMLElement;
    const arc = el.querySelector('.score__arc') as SVGCircleElement;
    const circumference = Number(arc.getAttribute('stroke-dasharray'));
    const offset = Number(arc.getAttribute('stroke-dashoffset'));
    // 8.4/10 filled → offset is 16% of the circumference
    expect(offset / circumference).toBeCloseTo(0.16, 2);
  });

  // Opt-in inputs added for 6.4 — defaults preserve the behaviour above.

  it('renders an authoritative context override verbatim (6.4)', () => {
    const el = render(SCORE, {
      contextOverride: '3 of 5 resolved promises delivered — 4 pending',
    }).nativeElement as HTMLElement;
    const context = el.querySelector('.score__context');
    expect(context?.textContent).toContain(
      '3 of 5 resolved promises delivered — 4 pending',
    );
    // The self-computed "last N quarters" sentence is not used.
    expect(context?.textContent).not.toContain('last 8 quarters');
    expect(context?.getAttribute('aria-label')).toBe(
      '3 of 5 resolved promises delivered — 4 pending',
    );
  });

  it('omits the CEO attribution when no name is supplied (6.4)', () => {
    const el = render({ ...SCORE, ceo: '', company: undefined })
      .nativeElement as HTMLElement;
    expect(el.querySelector('.score__context strong')).toBeNull();
  });

  it('suppresses the trend indicator when showTrend is false (6.4)', () => {
    const el = render(SCORE, { showTrend: false }).nativeElement as HTMLElement;
    expect(el.querySelector('.score__trend')).toBeNull();
  });

  it('drops the Revised stat when showRevised is false (6.4)', () => {
    const el = render(SCORE, { showRevised: false }).nativeElement as HTMLElement;
    const labels = Array.from(el.querySelectorAll('.score__stat-label')).map((n) =>
      n.textContent?.trim(),
    );
    expect(labels).not.toContain('Revised');
    expect(labels).toContain('Pending');
  });
});
