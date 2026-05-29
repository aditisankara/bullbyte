import { TestBed } from '@angular/core/testing';
import {
  PromiseTimelineComponent,
  DEFAULT_TIMELINE_DIRECTION,
  TimelineDirection,
} from './promise-timeline.component';
import { QuarterColumn } from '../claim/claim';

const COLUMNS: QuarterColumn[] = [
  { quarter: 'Q2 2023', verdicts: ['DELIVERED', 'DELIVERED'] },
  { quarter: 'Q3 2023', verdicts: [] }, // empty quarter
  { quarter: 'Q4 2023', verdicts: ['DELIVERED', 'MISSED'] },
  { quarter: 'Q1 2024', verdicts: ['PENDING', 'INSUFFICIENT_DATA'] },
];

describe('PromiseTimelineComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PromiseTimelineComponent],
    }).compileComponents();
  });

  function render(opts: {
    columns?: QuarterColumn[];
    selectedIndex?: number | null;
    direction?: TimelineDirection;
  } = {}) {
    const fixture = TestBed.createComponent(PromiseTimelineComponent);
    fixture.componentRef.setInput('columns', opts.columns ?? COLUMNS);
    if (opts.selectedIndex !== undefined) {
      fixture.componentRef.setInput('selectedIndex', opts.selectedIndex);
    }
    if (opts.direction !== undefined) {
      fixture.componentRef.setInput('direction', opts.direction);
    }
    fixture.detectChanges();
    return fixture;
  }

  function quarterLabels(el: HTMLElement): string[] {
    return Array.from(el.querySelectorAll('.timeline__label')).map((n) => n.textContent!.trim());
  }

  it('defaults to oldest-first and renders quarters in source order', () => {
    expect(DEFAULT_TIMELINE_DIRECTION).toBe('oldest-first');
    const el = render().nativeElement as HTMLElement;
    expect(quarterLabels(el)).toEqual(['Q2 2023', 'Q3 2023', 'Q4 2023', 'Q1 2024']);
  });

  it('reverses display order when newest-first', () => {
    const el = render({ direction: 'newest-first' }).nativeElement as HTMLElement;
    expect(quarterLabels(el)).toEqual(['Q1 2024', 'Q4 2023', 'Q3 2023', 'Q2 2023']);
  });

  it('represents an empty quarter explicitly (no claims)', () => {
    const el = render().nativeElement as HTMLElement;
    const bars = Array.from(el.querySelectorAll('.timeline__bar'));
    const emptyBar = bars.find((b) => b.getAttribute('aria-label')?.includes('Q3 2023'));
    expect(emptyBar?.getAttribute('aria-label')).toBe('Q3 2023: no claims');
    expect(emptyBar?.querySelector('.timeline__empty')).not.toBeNull();
    expect(emptyBar?.querySelectorAll('.timeline__seg').length).toBe(0);
  });

  it('renders a verdict segment per claim in non-empty quarters', () => {
    const el = render().nativeElement as HTMLElement;
    const bar = Array.from(el.querySelectorAll('.timeline__bar')).find((b) =>
      b.getAttribute('aria-label')?.startsWith('Q4 2023'),
    );
    expect(bar?.querySelectorAll('.timeline__seg').length).toBe(2);
    expect(bar?.getAttribute('aria-label')).toBe('Q4 2023: 2 claims');
  });

  it('lists all five verdict tones in the legend', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelectorAll('.timeline__legend-item').length).toBe(5);
  });

  it('emits the source index on quarter select, preserving it across direction', () => {
    const fixture = render({ direction: 'newest-first' });
    let emitted: number | null | undefined;
    fixture.componentInstance.selectQuarter.subscribe((i) => (emitted = i));
    // first rendered bar in newest-first is Q1 2024 = source index 3
    const firstBar = (fixture.nativeElement as HTMLElement).querySelector(
      'button.timeline__bar',
    ) as HTMLButtonElement;
    firstBar.click();
    expect(emitted).toBe(3);
  });

  it('clears the filter via the "All quarters" control', () => {
    const fixture = render({ selectedIndex: 2 });
    let emitted: number | null | undefined = 99;
    fixture.componentInstance.selectQuarter.subscribe((i) => (emitted = i));
    const allBtn = (fixture.nativeElement as HTMLElement).querySelector(
      'button.timeline__filter',
    ) as HTMLButtonElement;
    allBtn.click();
    expect(emitted).toBeNull();
  });
});
