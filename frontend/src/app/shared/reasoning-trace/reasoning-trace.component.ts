import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { TraceStep } from '../claim/claim';

/**
 * ReasoningTrace — the ordered agent tool-call steps behind a verdict (FR39,
 * UX-DR3). Each step shows its index, tool name, args, result summary, and an
 * inline EDGAR citation link where one backs the step.
 *
 * Collapsed by default; expanded on user action via a real toggle button
 * (aria-expanded / aria-controls), so it is keyboard-operable.
 *
 * This is the per-claim, post-hoc trace — not the live run feed (Story 2.3).
 */
@Component({
  selector: 'app-reasoning-trace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="trace">
      <button
        type="button"
        class="trace__toggle"
        [attr.aria-expanded]="expanded()"
        aria-controls="reasoning-trace-steps"
        (click)="toggle()"
      >
        <svg
          class="trace__chevron"
          [class.trace__chevron--open]="expanded()"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span class="trace__title">Agent reasoning trace</span>
        <span class="trace__count mono">{{ stepCount() }} tool {{ stepCount() === 1 ? 'call' : 'calls' }}</span>
      </button>

      @if (expanded()) {
        <ol id="reasoning-trace-steps" class="trace__steps">
          @for (step of steps(); track $index) {
            <li class="trace__step">
              <span class="trace__index mono" aria-hidden="true">{{ pad($index + 1) }}</span>
              <span class="trace__body mono">
                <span class="trace__tool">{{ step.tool }}</span><span class="trace__args">({{ step.args }})</span>
                <span class="trace__result"> → {{ step.result }}</span>
                @if (step.citation) {
                  <a
                    class="trace__cite"
                    [href]="step.citation.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ step.citation.label }}
                    <svg class="trace__cite-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M15 3h6v6" />
                      <path d="M10 14 21 3" />
                      <path d="M21 14v7H3V3h7" />
                    </svg>
                  </a>
                }
              </span>
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: `
    .trace {
      background: var(--paper-2);
      border-radius: var(--radius-sm);
    }
    .trace__toggle {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      padding: var(--space-3) var(--space-4);
      border: 0;
      background: transparent;
      cursor: pointer;
      font-family: var(--font-sans);
      color: var(--ink);
      text-align: left;
    }
    .trace__chevron {
      width: 16px;
      height: 16px;
      color: var(--ink-3);
      flex-shrink: 0;
      transition: transform var(--dur-state) var(--ease-out);
    }
    .trace__chevron--open {
      transform: rotate(90deg);
    }
    @media (prefers-reduced-motion: reduce) {
      .trace__chevron { transition: none; }
    }
    .trace__title {
      font-size: var(--text-sm);
      font-weight: 600;
      letter-spacing: var(--tracking-allcaps);
      text-transform: uppercase;
      color: var(--ink-3);
    }
    .trace__count {
      margin-left: auto;
      font-size: var(--text-xs);
      color: var(--ink-3);
    }
    .trace__steps {
      list-style: none;
      margin: 0;
      padding: 0 var(--space-4) var(--space-4);
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .trace__step {
      display: flex;
      gap: var(--space-3);
      align-items: baseline;
      padding: 2px 0;
    }
    .trace__index {
      flex-shrink: 0;
      width: 22px;
      font-size: var(--text-xs);
      color: var(--ink-4);
    }
    .trace__body {
      font-size: var(--text-xs);
      line-height: var(--lh-snug);
      color: var(--ink-2);
    }
    .trace__tool {
      color: var(--gold-2);
      font-weight: 600;
    }
    .trace__args {
      color: var(--ink-3);
    }
    .trace__result {
      color: var(--verdict-delivered);
    }
    .trace__cite {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      margin-left: var(--space-2);
      color: var(--ink);
      text-decoration-color: var(--rule-strong);
    }
    .trace__cite-icon {
      width: 11px;
      height: 11px;
    }
  `,
})
export class ReasoningTraceComponent {
  readonly steps = input<TraceStep[]>([]);

  /** Collapsed by default (AC2); toggled by user action. */
  protected readonly expanded = signal(false);
  protected readonly stepCount = computed(() => this.steps().length);

  protected toggle(): void {
    this.expanded.update((v) => !v);
  }

  protected pad(n: number): string {
    return String(n).padStart(2, '0');
  }
}
