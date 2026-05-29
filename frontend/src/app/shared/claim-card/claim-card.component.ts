import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ClaimSummary } from '../claim/claim';
import { VerdictBadgeComponent } from '../verdict-badge/verdict-badge.component';
import { ConfidenceIndicatorComponent } from '../confidence-indicator/confidence-indicator.component';

/**
 * ClaimCard — one verified claim: verdict badge, metric summary, quarter label,
 * the quote, speaker attribution, and a confidence indicator.
 *
 * Accessibility: the whole card is activatable, but the focusable control is a
 * real <button> (the metric) using the stretched-link pattern — so the card is
 * keyboard-reachable and Enter/Space-operable (UX-DR7) while the confidence
 * meter and verdict badge keep their own semantics outside the button.
 *
 * Verdicts are distinguished by the badge's icon + label (and the delta), never
 * by colour alone (NFR22).
 */
@Component({
  selector: 'app-claim-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VerdictBadgeComponent, ConfidenceIndicatorComponent],
  template: `
    <article class="card" [class.card--selected]="selected()">
      <div class="card__head">
        <span class="card__quarter mono">{{ claim().quarter }}</span>
        <app-verdict-badge [verdict]="claim().verdict" size="sm" />
      </div>

      <h3 class="card__metric">
        <button
          type="button"
          class="card__action"
          [attr.aria-pressed]="selected()"
          (click)="claimSelect.emit(claim().id)"
        >
          {{ claim().metric }}
        </button>
      </h3>

      <p class="card__quote">“{{ claim().quote }}”</p>

      <div class="card__foot">
        <span class="card__speaker">{{ claim().speaker }}</span>
        @if (claim().delta) {
          <span class="card__delta mono" [attr.data-dir]="deltaDirection()">{{ claim().delta }}</span>
        }
        <app-confidence-indicator class="card__confidence" [score]="claim().confidence" />
      </div>
    </article>
  `,
  styles: `
    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-5);
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: var(--radius-md);
      transition: background var(--dur-hover) var(--ease-out), border-color var(--dur-hover) var(--ease-out);
    }
    .card:hover {
      background: var(--ink-tint-5);
    }
    /* Focus lands on the inner button; surface it on the whole card. */
    .card:focus-within {
      border-color: var(--ink);
      outline: 2px solid var(--gold);
      outline-offset: 2px;
    }
    .card--selected {
      background: var(--ink-tint-5);
      border-color: var(--ink);
    }
    .card__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
    }
    .card__quarter {
      font-size: var(--text-xs);
      color: var(--ink-3);
    }
    .card__metric {
      margin: 0;
      font-family: var(--font-sans);
      font-size: var(--text-md);
      font-weight: 600;
      letter-spacing: var(--tracking-normal);
      line-height: var(--lh-snug);
    }
    .card__action {
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      color: var(--ink);
      text-align: left;
      cursor: pointer;
    }
    /* Stretched link — the button's hit area covers the whole card. */
    .card__action::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: var(--radius-md);
    }
    .card__action:focus-visible {
      outline: none;
    }
    .card__quote {
      margin: 0;
      font-family: var(--font-serif);
      font-size: var(--text-base);
      line-height: var(--lh-snug);
      color: var(--ink-2);
      text-wrap: pretty;
    }
    .card__foot {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
      margin-top: var(--space-1);
    }
    .card__speaker {
      font-size: var(--text-xs);
      color: var(--ink-3);
    }
    .card__delta {
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--ink-3);
    }
    .card__delta[data-dir='up'] {
      color: var(--verdict-delivered);
    }
    .card__delta[data-dir='down'] {
      color: var(--verdict-missed);
    }
    .card__confidence {
      /* confidence sits above the stretched link so its meter stays readable */
      position: relative;
      margin-left: auto;
    }
    @media (max-width: 767px) {
      .card {
        padding: var(--space-4);
      }
      .card__confidence {
        margin-left: 0;
      }
    }
  `,
})
export class ClaimCardComponent {
  readonly claim = input.required<ClaimSummary>();
  readonly selected = input(false);

  /** Emits the claim id when the card is activated. */
  readonly claimSelect = output<string>();

  protected readonly deltaDirection = computed<'up' | 'down' | 'flat'>(() => {
    const delta = this.claim().delta ?? '';
    if (delta.startsWith('+')) return 'up';
    if (delta.startsWith('−') || delta.startsWith('-')) return 'down';
    return 'flat';
  });
}
