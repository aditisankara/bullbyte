import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CeoScore, resolvedCount } from '../score/ceo-score';

interface StatRow {
  token: string;
  label: string;
  value: number;
}

/**
 * CeoScoreCard — the CEO Delivery Score (FR22–FR24, UX-DR4): the score ring,
 * a sample-size context label (the score is never shown as a bare fraction —
 * FR23), the pending-claims count, a verdict breakdown, and a visual trend
 * indicator versus the prior window.
 */
@Component({
  selector: 'app-ceo-score-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (score(); as s) {
      <section class="score">
        <div
          class="score__ring"
          role="img"
          [attr.aria-label]="'CEO delivery score ' + s.score.toFixed(1) + ' out of 10'"
        >
          <svg [attr.viewBox]="'0 0 ' + size + ' ' + size" class="score__ring-svg">
            <circle [attr.cx]="size / 2" [attr.cy]="size / 2" [attr.r]="radius" class="score__track" />
            <circle
              [attr.cx]="size / 2"
              [attr.cy]="size / 2"
              [attr.r]="radius"
              class="score__arc"
              [attr.stroke-dasharray]="circumference"
              [attr.stroke-dashoffset]="dashOffset()"
            />
          </svg>
          <div class="score__ring-num">
            <span class="score__num">{{ s.score.toFixed(1) }}</span>
            <span class="score__denom mono">/ 10</span>
          </div>
        </div>

        <div class="score__meta">
          <h2 class="score__title">CEO Delivery Score</h2>
          <p class="score__context">
            <strong>{{ s.ceo }}</strong
            >@if (s.company) { · {{ s.company }} } · {{ sampleContext() }}
          </p>

          <div class="score__trend" [attr.data-trend]="s.trend">
            <svg class="score__trend-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              @switch (s.trend) {
                @case ('up') { <path d="M5 16 L12 9 L19 16" /> }
                @case ('down') { <path d="M5 8 L12 15 L19 8" /> }
                @case ('flat') { <path d="M5 12 H19" /> }
              }
            </svg>
            <span class="score__trend-label">{{ trendText() }}</span>
            @if (s.trendLabel) {
              <span class="score__trend-detail mono">{{ s.trendLabel }}</span>
            }
          </div>

          <ul class="score__stats">
            @for (stat of stats(); track stat.token) {
              <li class="score__stat">
                <span class="score__stat-value mono" [style.color]="'var(--verdict-' + stat.token + ')'">{{ stat.value }}</span>
                <span class="score__stat-label">{{ stat.label }}</span>
              </li>
            }
          </ul>
        </div>
      </section>
    }
  `,
  styles: `
    .score {
      display: flex;
      gap: var(--space-8);
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .score__ring {
      position: relative;
      width: 140px;
      height: 140px;
      flex-shrink: 0;
    }
    .score__ring-svg {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }
    .score__track {
      fill: none;
      stroke: var(--rule);
      stroke-width: 10;
    }
    .score__arc {
      fill: none;
      stroke: var(--gold);
      stroke-width: 10;
      transition: stroke-dashoffset 600ms var(--ease-out);
    }
    @media (prefers-reduced-motion: reduce) {
      .score__arc { transition: none; }
    }
    .score__ring-num {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .score__num {
      font-family: var(--font-serif);
      font-size: 44px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: var(--tracking-tight);
      color: var(--ink);
      font-variant-numeric: tabular-nums;
    }
    .score__denom {
      font-size: var(--text-xs);
      color: var(--ink-3);
      margin-top: 2px;
    }
    .score__meta {
      flex: 1;
      min-width: 0;
    }
    .score__title {
      margin: 0 0 var(--space-2);
      font-size: var(--text-lg);
    }
    .score__context {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--ink-2);
    }
    .score__context strong {
      color: var(--ink);
    }
    .score__trend {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      margin-top: var(--space-3);
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .score__trend[data-trend='up'] { color: var(--verdict-delivered); }
    .score__trend[data-trend='down'] { color: var(--verdict-missed); }
    .score__trend[data-trend='flat'] { color: var(--ink-3); }
    .score__trend-icon {
      width: 18px;
      height: 18px;
    }
    .score__trend-detail {
      font-size: var(--text-xs);
      font-weight: 400;
      color: var(--ink-3);
    }
    .score__stats {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-6);
      margin: var(--space-5) 0 0;
      padding: 0;
      list-style: none;
    }
    .score__stat {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .score__stat-value {
      font-size: var(--text-lg);
      font-weight: 600;
      color: var(--ink);
      font-variant-numeric: tabular-nums;
    }
    .score__stat-label {
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: var(--tracking-wide);
      color: var(--ink-3);
    }
    @media (max-width: 767px) {
      .score {
        gap: var(--space-5);
      }
    }
  `,
})
export class CeoScoreCardComponent {
  readonly score = input.required<CeoScore | null>();

  protected readonly size = 140;
  protected readonly radius = this.size / 2 - 10;
  protected readonly circumference = 2 * Math.PI * this.radius;

  protected readonly dashOffset = computed(() => {
    const s = this.score();
    const clamped = s ? Math.min(10, Math.max(0, s.score)) : 0;
    return this.circumference * (1 - clamped / 10);
  });

  /** FR23 — score is never a bare fraction; always carries sample-size context. */
  protected readonly sampleContext = computed(() => {
    const s = this.score();
    if (!s) return '';
    const resolved = resolvedCount(s.counts);
    const window = `last ${s.quarters} ${s.quarters === 1 ? 'quarter' : 'quarters'}`;
    if (resolved === 0) {
      return `no resolved promises yet · ${window}`;
    }
    return `${s.counts.delivered} of ${resolved} resolved promises · ${window}`;
  });

  protected readonly trendText = computed(() => {
    switch (this.score()?.trend) {
      case 'up':
        return 'Improving';
      case 'down':
        return 'Declining';
      default:
        return 'Steady';
    }
  });

  protected readonly stats = computed<StatRow[]>(() => {
    const s = this.score();
    if (!s) return [];
    const rows: StatRow[] = [
      { token: 'delivered', label: 'Delivered', value: s.counts.delivered },
      { token: 'missed', label: 'Missed', value: s.counts.missed },
      { token: 'pending', label: 'Pending', value: s.counts.pending },
      { token: 'revised', label: 'Revised', value: s.counts.revised },
    ];
    if (s.counts.insufficient != null) {
      rows.push({ token: 'insufficient', label: 'Insufficient', value: s.counts.insufficient });
    }
    return rows;
  });
}
