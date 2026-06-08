import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { CompanyApiService } from '../../core/api/company-api.service';
import { CeoScoreDto, LoadState } from '../../core/api/company.models';
import { CeoScoreCardComponent } from '../../shared/ceo-score-card/ceo-score-card.component';
import { CeoScore } from '../../shared/score/ceo-score';

/**
 * ScoreCardComponent — the smart CEO Delivery Score panel (6.4). Fetches
 * `GET /companies/:ticker/score` (5.6) and renders the presentational
 * CeoScoreCard (2.6), adapting the 0–1 API score onto the card's 0–10 ring.
 *
 * The 5.6 endpoint ships no prior-window comparison and no CEO name, so the
 * trend indicator and the name attribution are suppressed; the API's own
 * `context` sentence is passed through as the sample-size context (FR23).
 *
 * `score: null` — a known ticker with no resolved verdicts — is a first-class
 * empty state ("No resolved claims yet" plus the pending count), never a zero
 * score and never an error (AC2).
 */
@Component({
  selector: 'app-score-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CeoScoreCardComponent],
  template: `
    @switch (state()) {
      @case ('loading') {
        <p class="score-card__status" role="status">Loading the delivery score…</p>
      }
      @case ('error') {
        <section class="score-card__panel" role="alert">
          <h2 class="score-card__title">CEO Delivery Score</h2>
          <p class="score-card__note">The delivery score is unavailable right now.</p>
        </section>
      }
      @case ('success') {
        @if (model(); as m) {
          <app-ceo-score-card
            [score]="m"
            [contextOverride]="contextOverride()"
            [showTrend]="false"
            [showRevised]="false"
          />
        } @else {
          <!-- AC2: known ticker, no resolved verdicts — not a zero, not an error. -->
          <section class="score-card__panel" aria-labelledby="score-empty-heading">
            <h2 id="score-empty-heading" class="score-card__title">CEO Delivery Score</h2>
            <p class="score-card__empty">No resolved claims yet</p>
            <p class="score-card__note">{{ pendingNote() }}</p>
          </section>
        }
      }
    }
  `,
  styles: `
    .score-card__status,
    .score-card__note {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--ink-3);
    }
    .score-card__title {
      margin: 0 0 var(--space-2);
      font-size: var(--text-lg);
    }
    .score-card__empty {
      margin: 0 0 var(--space-2);
      font-family: var(--font-serif);
      font-size: var(--text-xl);
      color: var(--ink);
    }
  `,
})
export class ScoreCardComponent {
  readonly ticker = input.required<string>();

  private readonly api = inject(CompanyApiService);

  /** 4-state loading union (never a boolean isLoading). */
  protected readonly state = signal<LoadState>('idle');
  private readonly dto = signal<CeoScoreDto | null>(null);

  /** The API's authoritative sample-size sentence (FR23). */
  protected readonly contextOverride = computed(() => this.dto()?.context ?? '');

  /**
   * Adapter: 5.6 `CeoScoreDto` → the 2.6 presentational `CeoScore`. Returns
   * null when the API score is null so the template routes to the AC2 empty
   * state rather than rendering a 0.
   */
  protected readonly model = computed<CeoScore | null>(() => {
    const d = this.dto();
    if (!d || d.score === null) return null;
    return {
      score: d.score * 10, // 0–1 API scale → the card's 0–10 ring
      ceo: '', // attribution deferred by 5.6; the page <h1> carries the company
      quarters: 0, // unused — contextOverride supplies the sample-size sentence
      counts: {
        delivered: d.deliveredCount,
        missed: d.missedCount,
        pending: d.pendingCount,
        revised: 0, // REVISED excluded by 5.6 (showRevised=false hides the row)
        insufficient: d.insufficientDataCount || undefined,
      },
      trend: 'flat', // no prior-window datum from 5.6 (showTrend=false hides it)
    };
  });

  /** AC2 — tell the user how many claims are pending so they know to return. */
  protected readonly pendingNote = computed(() => {
    const pending = this.dto()?.pendingCount ?? 0;
    if (pending === 0) {
      return 'Check back once the first promises resolve.';
    }
    return `${pending} ${pending === 1 ? 'claim is' : 'claims are'} still pending — check back once they resolve.`;
  });

  constructor() {
    // Refetch whenever the bound ticker changes (incl. first render).
    effect(() => {
      this.ticker();
      untracked(() => this.load());
    });
  }

  protected load(): void {
    this.state.set('loading');
    this.api.getScore(this.ticker()).subscribe({
      next: (dto) => {
        this.dto.set(dto);
        this.state.set('success');
      },
      error: () => {
        this.state.set('error');
      },
    });
  }
}
