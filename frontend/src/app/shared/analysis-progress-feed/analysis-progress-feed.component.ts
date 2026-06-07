import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  ProgressEvent,
  StepStatus,
  isTerminal,
  statusForEvent,
} from '../analysis/progress-event';

interface StepRow {
  key: string;
  status: StepStatus;
  message: string;
  timestamp: string;
}

/**
 * AnalysisProgressFeed — BullByte's live transparency feed for an analysis run.
 *
 * Renders one row per received SSE ProgressEvent (append-only — no skeleton
 * replaces the feed, NFR5). Each finished step shows a completed glyph; a
 * failed terminal event shows an error glyph; while the run continues a
 * trailing "in-progress" row carries the active indicator (UX-DR1).
 *
 * This is the *live run* feed — not the per-claim reasoning trace (Story 2.5).
 */
@Component({
  selector: 'app-analysis-progress-feed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="feed" role="log" aria-live="polite" aria-relevant="additions" aria-label="Analysis progress">
      @for (row of rows(); track row.key) {
        <li class="step" [attr.data-status]="row.status">
          <span class="step__status" [attr.data-status]="row.status">
            @switch (row.status) {
              @case ('completed') {
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12.5 L11 15.5 L16.5 9.5" />
                </svg>
              }
              @case ('failed') {
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <line x1="7" y1="17" x2="17" y2="7" />
                </svg>
              }
              @case ('in-progress') {
                <span class="step__dot" aria-hidden="true"></span>
              }
            }
            <span class="visually-hidden">{{ row.status }}:</span>
          </span>
          <span class="step__message mono">{{ row.message }}</span>
        </li>
      }
    </ol>
  `,
  styles: `
    .feed {
      list-style: none;
      margin: 0;
      padding: 0;
      max-width: 640px;
    }
    .step {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-3) 0;
      border-top: 1px solid var(--rule);
    }
    .step:first-child {
      border-top: 0;
    }
    .step__status {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      margin-top: 1px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .step__status svg {
      width: 18px;
      height: 18px;
    }
    .step__status[data-status='completed'] {
      color: var(--verdict-delivered);
    }
    .step__status[data-status='failed'] {
      color: var(--verdict-missed);
    }
    .step__dot {
      width: 9px;
      height: 9px;
      border-radius: var(--radius-full);
      background: var(--gold);
      box-shadow: 0 0 0 0 var(--gold-tint);
      animation: pulse 1.4s var(--ease-in-out) infinite;
    }
    .step__message {
      font-size: var(--text-sm);
      line-height: var(--lh-snug);
      color: var(--ink-2);
    }
    .step[data-status='failed'] .step__message {
      color: var(--verdict-missed-ink);
    }
    .step[data-status='in-progress'] .step__message {
      color: var(--ink);
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 var(--gold-tint); }
      70% { box-shadow: 0 0 0 6px transparent; }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    @media (prefers-reduced-motion: reduce) {
      .step__dot { animation: none; }
    }
  `,
})
export class AnalysisProgressFeedComponent {
  /** Events received so far, in arrival order. Append-only from the parent. */
  readonly events = input<ProgressEvent[]>([]);
  /**
   * Optional label for the active step currently running
   * (e.g. "Verifying claim 3 of 12…"). Shown only while the run is live.
   */
  readonly activeLabel = input<string>();
  /**
   * Opt-in (6.2): label for an in-progress row shown *before* the first event
   * arrives, so a freshly opened stream is never blank (AC2). Default off —
   * with no events and no `pending`, the feed renders zero rows as before.
   */
  readonly pending = input<string>();

  /** True while a non-terminal run is in flight. */
  protected readonly running = computed(() => {
    const list = this.events();
    return list.length > 0 && !isTerminal(list[list.length - 1].event);
  });

  protected readonly rows = computed<StepRow[]>(() => {
    const list = this.events();
    const rows: StepRow[] = list.map((e, i) => ({
      key: `${e.event}-${e.stepIndex}-${i}`,
      status: statusForEvent(e.event),
      message: e.message,
      timestamp: e.timestamp,
    }));

    const pendingLabel = this.pending();
    if (list.length === 0 && pendingLabel) {
      rows.push({
        key: 'pending',
        status: 'in-progress',
        message: pendingLabel,
        timestamp: '',
      });
    }

    if (this.running()) {
      const last = list[list.length - 1];
      rows.push({
        key: `active-${last.stepIndex}`,
        status: 'in-progress',
        message: this.activeLabel() ?? 'Working…',
        timestamp: last.timestamp,
      });
    }
    return rows;
  });
}
