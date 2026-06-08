import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ClaimDetail } from '../claim/claim';
import { VerdictBadgeComponent } from '../verdict-badge/verdict-badge.component';
import {
  ConfidenceIndicatorComponent,
  LOW_CONFIDENCE_THRESHOLD,
} from '../confidence-indicator/confidence-indicator.component';
import { ReasoningTraceComponent } from '../reasoning-trace/reasoning-trace.component';

/**
 * ClaimDetailPanel — BullByte's primary trust surface (FR36–FR41, UX-DR3).
 * Shows the raw quote, speaker attribution, source quarter, verdict badge,
 * quantitative delta, confidence indicator, a direct EDGAR filing link, a share
 * action, and the (collapsed) reasoning trace.
 *
 * Quote uses the serif pull-quote treatment (reconciled with the kit; the
 * earlier "monospace" AC note is superseded — mono is reserved for data/trace).
 */
@Component({
  selector: 'app-claim-detail-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VerdictBadgeComponent, ConfidenceIndicatorComponent, ReasoningTraceComponent],
  template: `
    @if (claim(); as c) {
      <article class="panel">
        <header class="panel__head">
          <div class="panel__verdict">
            <app-verdict-badge [verdict]="c.verdict" />
            @if (c.delta) {
              <span class="panel__delta mono">· {{ c.delta }}</span>
            }
          </div>
          <button type="button" class="panel__share" (click)="onShare(c.id)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5" />
            </svg>
            {{ copied() ? 'Link copied' : 'Share' }}
          </button>
        </header>

        <p class="panel__meta mono">
          {{ c.metric }} · {{ c.quarter }}
        </p>

        <section class="panel__section">
          <h6 class="panel__label">The claim</h6>
          <blockquote class="panel__quote">{{ c.quote }}</blockquote>
          <p class="panel__attribution">— {{ c.speaker }}</p>
          @if (c.filing.url) {
            <p class="panel__source">
              Source:
              <a class="panel__filing" [href]="c.filing.url" target="_blank" rel="noopener noreferrer">
                {{ c.filing.type || 'EDGAR filing' }} · {{ c.filing.quarter }}
                <svg class="panel__ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M21 14v7H3V3h7" />
                </svg>
                <span class="visually-hidden">(opens in a new tab)</span>
              </a>
            </p>
          }
        </section>

        <section class="panel__section">
          <!-- 6.5: the 5.5 API returns no "actual" value, so the smart panel
               sets showComparison=false and the header delta carries the
               outcome; the confidence + low-confidence note always show. -->
          @if (showComparison()) {
            <h6 class="panel__label">What actually happened</h6>
            <div class="panel__compare">
              <span class="panel__col">
                <span class="panel__col-label">Claimed</span>
                <span class="panel__value mono">{{ c.claimed }}</span>
              </span>
              <span class="panel__arrow" aria-hidden="true">→</span>
              <span class="panel__col">
                <span class="panel__col-label">Actual</span>
                <span class="panel__value mono">{{ c.actual }}</span>
              </span>
              <a class="panel__filing panel__filing--actual" [href]="c.actualFiling.url" target="_blank" rel="noopener noreferrer">
                {{ c.actualFiling.type }} · {{ c.actualFiling.quarter }}
                <svg class="panel__ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M21 14v7H3V3h7" />
                </svg>
                <span class="visually-hidden">(opens in a new tab)</span>
              </a>
            </div>
          }
          <div class="panel__confidence">
            <app-confidence-indicator [score]="c.confidence" />
            @if (lowConfidence()) {
              <span class="panel__low-note">Low confidence — review reasoning trace</span>
            }
          </div>
        </section>

        <app-reasoning-trace [steps]="c.trace" />
      </article>
    } @else {
      <div class="panel panel--empty">Select a claim to see the full reasoning trace.</div>
    }
  `,
  styles: `
    .panel {
      border: 1px solid var(--rule);
      border-radius: var(--radius-md);
      background: var(--paper);
      overflow: hidden;
    }
    .panel--empty {
      padding: var(--space-7);
      color: var(--ink-3);
      font-style: italic;
      font-size: var(--text-sm);
    }
    .panel__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      padding: var(--space-5) var(--space-6);
      border-bottom: 1px solid var(--rule);
    }
    .panel__verdict {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .panel__delta {
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--ink-2);
    }
    .panel__share {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--rule-strong);
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--ink-2);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      cursor: pointer;
      transition: background var(--dur-hover) var(--ease-out);
    }
    .panel__share:hover {
      background: var(--ink-tint-5);
    }
    .panel__share svg {
      width: 14px;
      height: 14px;
    }
    .panel__meta {
      margin: 0;
      padding: var(--space-4) var(--space-6) 0;
      font-size: var(--text-xs);
      color: var(--ink-3);
      text-transform: uppercase;
      letter-spacing: var(--tracking-wide);
    }
    .panel__section {
      padding: var(--space-4) var(--space-6) var(--space-5);
      border-bottom: 1px solid var(--rule);
    }
    .panel__label {
      margin: 0 0 var(--space-2);
    }
    .panel__quote {
      margin: 0;
      font-family: var(--font-serif);
      font-size: var(--text-lg);
      line-height: var(--lh-snug);
      color: var(--ink);
      border-left: 2px solid var(--ink);
      padding-left: var(--space-4);
    }
    .panel__attribution {
      margin: var(--space-2) 0 0;
      padding-left: var(--space-4);
      font-size: var(--text-sm);
      color: var(--ink-3);
    }
    .panel__source {
      margin: var(--space-3) 0 0;
      font-size: var(--text-xs);
      color: var(--ink-3);
    }
    .panel__filing {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--ink);
    }
    .panel__ext {
      width: 12px;
      height: 12px;
    }
    .panel__compare {
      display: flex;
      align-items: baseline;
      gap: var(--space-7);
      flex-wrap: wrap;
    }
    .panel__col {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .panel__col-label {
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: var(--tracking-wide);
      color: var(--ink-3);
    }
    .panel__value {
      font-size: var(--text-lg);
      font-weight: 600;
      color: var(--ink);
    }
    .panel__arrow {
      color: var(--ink-4);
    }
    .panel__filing--actual {
      margin-left: auto;
      font-size: var(--text-xs);
    }
    .panel__confidence {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
      margin-top: var(--space-4);
    }
    .panel__low-note {
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--verdict-pending-ink);
    }
    app-reasoning-trace {
      display: block;
      padding: var(--space-4) var(--space-6) var(--space-5);
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
    @media (max-width: 767px) {
      .panel__head,
      .panel__section,
      app-reasoning-trace {
        padding-left: var(--space-4);
        padding-right: var(--space-4);
      }
    }
  `,
})
export class ClaimDetailPanelComponent {
  readonly claim = input<ClaimDetail | null>(null);
  /** Stable deep link for this claim (FR41); copied to the clipboard on Share. */
  readonly shareUrl = input<string>();
  /**
   * Show the claimed→actual comparison block. Off when the data source carries
   * no "actual" value (6.5 / 5.5) — the header delta carries the outcome and the
   * confidence indicator still renders. Default on to preserve 2.5 behaviour.
   */
  readonly showComparison = input<boolean>(true);

  /** Emits the claim id when the user shares it. */
  readonly share = output<string>();

  protected readonly copied = signal(false);
  protected readonly lowConfidence = computed(() => {
    const c = this.claim();
    return c != null && c.confidence < LOW_CONFIDENCE_THRESHOLD;
  });

  protected onShare(id: string): void {
    this.share.emit(id);
    const url = this.shareUrl();
    if (url && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        () => this.copied.set(true),
        () => {
          /* clipboard denied — the share output still fired */
        },
      );
    }
  }
}
