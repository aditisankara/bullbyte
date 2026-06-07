import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { CompanyApiService } from '../../core/api/company-api.service';
import { ProgressStreamService } from '../../core/api/progress-stream.service';
import { ProgressEvent } from '../../shared/analysis/progress-event';
import { AnalysisProgressFeedComponent } from '../../shared/analysis-progress-feed/analysis-progress-feed.component';
import { ErrorStateComponent } from '../../shared/error-state/error-state.component';

/**
 * AnalysisProgress — the smart live-run feed (6.2). Opens the 5.2 SSE stream
 * for a job and drives the presentational 2.3 feed with the received events.
 *
 * - `analysis-complete` → emits `completed` so the parent refetches the
 *   company summary and re-renders the dashboard (AC3).
 * - `analysis-failed` → renders the canonical failure error state (UX-DR6);
 *   its retry POSTs a fresh `/analyze` and reconnects to the new job (AC4).
 * - The stream subscription lives in an `effect` with cleanup, so component
 *   destroy ⇒ unsubscribe ⇒ `EventSource.close()` — no dangling connections
 *   (AC5; the close-on-unsubscribe contract is ProgressStreamService's).
 */
@Component({
  selector: 'app-analysis-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnalysisProgressFeedComponent, ErrorStateComponent],
  template: `
    <app-analysis-progress-feed
      [events]="events()"
      pending="Starting analysis…"
    />
    @if (failed()) {
      <app-error-state
        kind="analysis-timeout"
        [heading]="errorHeading()"
        [body]="errorBody()"
        (retry)="retry()"
      />
    }
  `,
})
export class AnalysisProgressComponent {
  /** Job to stream — from `latestJobId` on the company summary. */
  readonly jobId = input.required<string>();
  /** Ticker for the retry `POST /companies/:ticker/analyze` (AC4). */
  readonly ticker = input.required<string>();

  /** The run finished successfully — parent refetches the summary (AC3). */
  readonly completed = output<void>();

  private readonly stream = inject(ProgressStreamService);
  private readonly api = inject(CompanyApiService);

  /** Append-only list of received SSE events, in arrival order (AC2). */
  protected readonly events = signal<ProgressEvent[]>([]);
  protected readonly failed = signal(false);

  /** Set when the retry POST itself fails — switches the error copy. */
  private readonly retryUnavailable = signal(false);

  /** A retry may return the *same* jobId; bumping this forces a reconnect. */
  private readonly attempt = signal(0);
  /** Overrides the input once a retry queues a fresh job. */
  private readonly retryJobId = signal<string | null>(null);
  private readonly activeJobId = computed(() => this.retryJobId() ?? this.jobId());

  protected readonly errorHeading = computed(() =>
    this.retryUnavailable() ? 'Retry failed' : 'Analysis failed',
  );
  protected readonly errorBody = computed(() =>
    this.retryUnavailable()
      ? "BullByte couldn't start a new analysis. This is usually temporary — try again in a moment."
      : "BullByte couldn't finish analysing this ticker. You can run it again.",
  );

  constructor() {
    // (Re)connect whenever the active job changes or a retry is attempted.
    // The cleanup runs on re-run *and* on destroy — AC5 is structural.
    effect((onCleanup) => {
      const jobId = this.activeJobId();
      this.attempt();
      untracked(() => {
        this.events.set([]);
        this.failed.set(false);
      });

      const subscription = this.stream.connect(jobId).subscribe((event) => {
        this.events.update((list) => [...list, event]);
        if (event.event === 'analysis-complete') {
          this.completed.emit();
        } else if (event.event === 'analysis-failed') {
          this.failed.set(true);
        }
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  /** AC4: retry POSTs a fresh analyze and reconnects to the returned job. */
  protected retry(): void {
    this.retryUnavailable.set(false);
    this.api.analyze(this.ticker()).subscribe({
      next: (response) => {
        if (response.status === 'QUEUED') {
          this.retryJobId.set(response.jobId);
          this.attempt.update((n) => n + 1);
        } else {
          // Cache hit (jobId null, COMPLETED) — nothing to stream.
          this.completed.emit();
        }
      },
      error: () => this.retryUnavailable.set(true),
    });
  }
}
