import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Confidence below this value is treated as low (FR40, UX-DR5).
 * Low-confidence results are *flagged, not suppressed* — the result is still
 * shown, with a visible warning treatment so the user can weigh it.
 *
 * Decision (Story 2.2): 0.60 — flags genuinely shaky verdicts without
 * over-flagging mid-confidence ones. Single source of truth for the threshold.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * ConfidenceIndicator — visualises a 0–1 confidence score as a labelled meter.
 * Below LOW_CONFIDENCE_THRESHOLD it switches to a distinct "low confidence"
 * treatment (amber fill + flag), but never hides the score.
 */
@Component({
  selector: 'app-confidence-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="conf"
      [class.conf--low]="isLow()"
      role="meter"
      [attr.aria-valuemin]="0"
      [attr.aria-valuemax]="1"
      [attr.aria-valuenow]="clamped()"
      [attr.aria-label]="ariaLabel()"
    >
      <span class="conf__track">
        <span class="conf__fill" [style.width.%]="percent()"></span>
      </span>
      <span class="conf__value mono">{{ clamped().toFixed(2) }}</span>
      @if (isLow()) {
        <span class="conf__flag">
          <svg
            class="conf__flag-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 21V4h13l-2.5 4 2.5 4H4" />
          </svg>
          Low confidence
        </span>
      }
    </div>
  `,
  styles: `
    .conf {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      color: var(--ink-3);
    }
    .conf__track {
      position: relative;
      display: inline-block;
      width: 64px;
      height: 6px;
      border-radius: var(--radius-full);
      background: var(--ink-tint-10);
      overflow: hidden;
    }
    .conf__fill {
      display: block;
      height: 100%;
      border-radius: var(--radius-full);
      background: var(--ink-3);
      transition: width var(--dur-state) var(--ease-out);
    }
    .conf__value {
      font-feature-settings: 'zero' on;
      font-variant-numeric: tabular-nums;
      color: var(--ink-2);
    }
    /* Low-confidence: flagged, not suppressed (FR40) */
    .conf--low .conf__fill {
      background: var(--verdict-pending);
    }
    .conf--low .conf__value {
      color: var(--verdict-pending-ink);
    }
    .conf__flag {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      font-weight: 600;
      color: var(--verdict-pending-ink);
      letter-spacing: var(--tracking-wide);
    }
    .conf__flag-icon {
      width: 13px;
      height: 13px;
      flex-shrink: 0;
    }
  `,
})
export class ConfidenceIndicatorComponent {
  /** Confidence score in the range 0–1. */
  readonly score = input.required<number>();

  protected readonly threshold = LOW_CONFIDENCE_THRESHOLD;
  protected readonly clamped = computed(() => Math.min(1, Math.max(0, this.score())));
  protected readonly percent = computed(() => Math.round(this.clamped() * 100));
  protected readonly isLow = computed(() => this.clamped() < this.threshold);
  protected readonly ariaLabel = computed(() =>
    this.isLow()
      ? `Confidence ${this.clamped().toFixed(2)} — below the ${this.threshold} threshold, flagged`
      : `Confidence ${this.clamped().toFixed(2)}`,
  );
}
