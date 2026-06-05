import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LOW_CONFIDENCE_THRESHOLD } from '../confidence-indicator/confidence-indicator.component';

export type ErrorStateKind =
  | 'ticker-not-found'
  | 'edgar-unavailable'
  | 'analysis-timeout'
  | 'low-confidence';

interface ErrorStateMeta {
  heading: string;
  /** Body copy; receives the optional context string (e.g. a ticker). */
  body: (context?: string) => string;
  retryable: boolean;
  retryLabel: string;
}

const ERROR_STATE_META: Record<ErrorStateKind, ErrorStateMeta> = {
  'ticker-not-found': {
    heading: 'No filings found',
    body: (ctx) =>
      ctx
        ? `EDGAR returned no filings for ${ctx}. Check the symbol and try a different ticker.`
        : 'EDGAR returned no filings for that ticker. Check the symbol and try a different ticker.',
    retryable: true,
    retryLabel: 'Try another ticker',
  },
  'edgar-unavailable': {
    heading: 'EDGAR is unavailable',
    body: () =>
      "BullByte couldn't reach the SEC EDGAR service. This is usually temporary — try again in a moment.",
    retryable: true,
    retryLabel: 'Retry',
  },
  'analysis-timeout': {
    heading: 'Analysis timed out',
    body: () =>
      'The analysis took longer than expected and was stopped. You can run it again.',
    retryable: true,
    retryLabel: 'Re-run analysis',
  },
  'low-confidence': {
    heading: 'Low-confidence result',
    body: () =>
      `BullByte's confidence in this analysis is below the ${LOW_CONFIDENCE_THRESHOLD} threshold. The result is shown but flagged — read it with caution.`,
    retryable: false,
    retryLabel: '',
  },
};

/**
 * ErrorState — the four canonical empty/error states (UX-DR6, NFR6), each with
 * an icon, heading, body, and a retry action where one applies. Low-confidence
 * is a flag (not a failure), so it shows no retry and announces politely.
 */
@Component({
  selector: 'app-error-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="error" [attr.role]="kind() === 'low-confidence' ? 'status' : 'alert'">
      <svg
        class="error__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        @switch (kind()) {
          @case ('ticker-not-found') {
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3-3" />
          }
          @case ('edgar-unavailable') {
            <path d="M12 3 2 20h20Z" />
            <path d="M12 10v4" />
            <path d="M12 18h.01" />
          }
          @case ('analysis-timeout') {
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4l3 2" />
          }
          @case ('low-confidence') {
            <path d="M4 21V4h13l-2.5 4 2.5 4H4" />
          }
        }
      </svg>
      <h3 class="error__heading">{{ resolvedHeading() }}</h3>
      <p class="error__body">{{ resolvedBody() }}</p>
      @if (meta().retryable) {
        <button type="button" class="error__retry" (click)="retry.emit()">
          {{ meta().retryLabel }}
        </button>
      }
    </div>
  `,
  styles: `
    .error {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: var(--space-3);
      max-width: 420px;
      margin: 0 auto;
      padding: var(--space-9) var(--gutter);
      color: var(--ink-2);
    }
    .error__icon {
      width: 40px;
      height: 40px;
      color: var(--ink-4);
    }
    .error__heading {
      margin: 0;
      font-size: var(--text-lg);
    }
    .error__body {
      margin: 0;
      color: var(--ink-3);
      line-height: var(--lh-relaxed);
    }
    .error__retry {
      margin-top: var(--space-2);
      font-family: var(--font-sans);
      font-size: 15px;
      font-weight: 500;
      line-height: 1.2;
      padding: 12px 22px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: var(--ink);
      color: var(--paper);
      cursor: pointer;
      transition: background var(--dur-hover) var(--ease-out);
    }
    .error__retry:hover {
      background: #000000;
    }
  `,
})
export class ErrorStateComponent {
  readonly kind = input.required<ErrorStateKind>();
  /** Optional context woven into the body copy (e.g. the searched ticker). */
  readonly context = input<string>();
  /** Optional overrides for bespoke copy. */
  readonly heading = input<string>();
  readonly body = input<string>();

  /** Emitted when the user activates the retry action. */
  readonly retry = output<void>();

  protected readonly meta = computed(() => ERROR_STATE_META[this.kind()]);
  protected readonly resolvedHeading = computed(() => this.heading() ?? this.meta().heading);
  protected readonly resolvedBody = computed(
    () => this.body() ?? this.meta().body(this.context()),
  );
}
