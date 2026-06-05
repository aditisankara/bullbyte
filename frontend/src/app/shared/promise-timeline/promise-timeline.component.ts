import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { QuarterColumn } from '../claim/claim';
import { Verdict, VERDICT_META, VERDICTS } from '../verdict/verdict';

export type TimelineDirection = 'oldest-first' | 'newest-first';

/**
 * Canonical timeline direction (Story 2.4 decision, FR31/FR33): oldest-first —
 * earliest quarter on the left, reading left-to-right as a chronological
 * timeline (matches the design kit). Override via the `direction` input.
 */
export const DEFAULT_TIMELINE_DIRECTION: TimelineDirection = 'oldest-first';

interface RenderColumn {
  /** Index into the source `columns` input (stable across direction flips). */
  index: number;
  quarter: string;
  segments: { verdict: Verdict; token: string }[];
  empty: boolean;
}

/**
 * PromiseTimeline — a company's promise history across up to 8 quarters. Each
 * quarter is a stacked bar of verdict segments and doubles as a filter/nav
 * control; quarters with no claims render an explicit empty baseline. Direction
 * is explicit (default oldest-first) and selectable.
 */
@Component({
  selector: 'app-promise-timeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="timeline" aria-labelledby="timeline-heading">
      <header class="timeline__header">
        <h2 id="timeline-heading" class="timeline__title">Promise timeline</h2>
        <ul class="timeline__legend">
          @for (tone of legend; track tone.token) {
            <li class="timeline__legend-item">
              <span class="timeline__swatch" [style.background]="'var(--verdict-' + tone.token + ')'"></span>
              {{ tone.label }}
            </li>
          }
        </ul>
      </header>

      <div class="timeline__controls">
        <button
          type="button"
          class="timeline__filter"
          [class.timeline__filter--active]="selectedIndex() === null"
          (click)="selectQuarter.emit(null)"
        >
          All quarters
        </button>
      </div>

      <ol class="timeline__bars" [attr.data-direction]="direction()">
        @for (col of renderColumns(); track col.quarter) {
          <li class="timeline__col">
            <button
              type="button"
              class="timeline__bar"
              [class.timeline__bar--selected]="selectedIndex() === col.index"
              [attr.aria-pressed]="selectedIndex() === col.index"
              [attr.aria-label]="ariaLabel(col)"
              (click)="selectQuarter.emit(col.index)"
            >
              @if (col.empty) {
                <span class="timeline__empty" aria-hidden="true"></span>
              } @else {
                @for (seg of col.segments; track $index) {
                  <span class="timeline__seg" [style.background]="'var(--verdict-' + seg.token + ')'"></span>
                }
              }
            </button>
            <span class="timeline__label mono" [class.timeline__label--active]="selectedIndex() === col.index">
              {{ col.quarter }}
            </span>
          </li>
        }
      </ol>
    </section>
  `,
  styles: `
    .timeline {
      padding: var(--space-7) 0;
    }
    .timeline__header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: var(--space-3);
      margin-bottom: var(--space-5);
    }
    .timeline__title {
      margin: 0;
      font-size: var(--text-lg);
    }
    .timeline__legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-4);
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--text-xs);
      color: var(--ink-3);
    }
    .timeline__legend-item {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
    }
    .timeline__swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
    .timeline__controls {
      margin-bottom: var(--space-3);
    }
    .timeline__filter {
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      font-weight: 600;
      letter-spacing: var(--tracking-allcaps);
      text-transform: uppercase;
      color: var(--ink-3);
      padding: var(--space-1) var(--space-2);
      border: 1px solid var(--rule-strong);
      border-radius: var(--radius-sm);
      background: transparent;
      cursor: pointer;
      transition: background var(--dur-hover) var(--ease-out), color var(--dur-hover) var(--ease-out);
    }
    .timeline__filter:hover {
      background: var(--ink-tint-5);
    }
    .timeline__filter--active {
      color: var(--ink);
      background: var(--ink-tint-10);
      border-color: var(--ink);
    }
    .timeline__bars {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .timeline__col {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .timeline__bar {
      display: flex;
      flex-direction: column-reverse;
      gap: 3px;
      min-height: 96px;
      padding: var(--space-1);
      justify-content: flex-start;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: transparent;
      cursor: pointer;
      transition: background var(--dur-hover) var(--ease-out);
    }
    .timeline__bar:hover {
      background: var(--ink-tint-5);
    }
    .timeline__bar--selected {
      background: var(--ink-tint-5);
      border-color: var(--ink);
    }
    .timeline__seg {
      height: 16px;
      border-radius: 2px;
    }
    .timeline__empty {
      margin-top: auto;
      height: 2px;
      border-radius: 2px;
      background: var(--rule-strong);
    }
    .timeline__label {
      text-align: center;
      font-size: var(--text-xs);
      color: var(--ink-3);
    }
    .timeline__label--active {
      color: var(--ink);
      font-weight: 600;
    }
    /* Tablet/mobile: keep all 8 quarters legible without horizontal page scroll. */
    @media (max-width: 767px) {
      .timeline__bars {
        gap: 3px;
      }
      .timeline__bar {
        min-height: 72px;
      }
      .timeline__label {
        font-size: 9px;
      }
    }
  `,
})
export class PromiseTimelineComponent {
  /** Up to 8 quarter columns, supplied in oldest-first (chronological) order. */
  readonly columns = input<QuarterColumn[]>([]);
  /** Currently selected quarter index, or null for "all quarters". */
  readonly selectedIndex = input<number | null>(null);
  readonly direction = input<TimelineDirection>(DEFAULT_TIMELINE_DIRECTION);

  /** Emits the selected quarter index, or null when the filter is cleared. */
  readonly selectQuarter = output<number | null>();

  protected readonly legend = VERDICTS.map((v) => VERDICT_META[v]);

  protected readonly renderColumns = computed<RenderColumn[]>(() => {
    const cols = this.columns().map((col, index) => ({
      index,
      quarter: col.quarter,
      empty: col.verdicts.length === 0,
      segments: col.verdicts.map((verdict) => ({ verdict, token: VERDICT_META[verdict].token })),
    }));
    return this.direction() === 'newest-first' ? cols.reverse() : cols;
  });

  protected ariaLabel(col: RenderColumn): string {
    if (col.empty) {
      return `${col.quarter}: no claims`;
    }
    return `${col.quarter}: ${col.segments.length} ${col.segments.length === 1 ? 'claim' : 'claims'}`;
  }
}
