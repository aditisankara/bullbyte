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
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { CompanyApiService } from '../../core/api/company-api.service';
import { CompanySummary, LoadState } from '../../core/api/company.models';
import { ClaimListItem } from '../../core/api/claim.models';
import { ApiError } from '../../core/interceptors/http-error.interceptor';
import { CompanyPageLayoutComponent } from '../../shared/company-page-layout/company-page-layout.component';
import {
  ErrorStateComponent,
  ErrorStateKind,
} from '../../shared/error-state/error-state.component';
import { PromiseTimelineComponent } from '../../shared/promise-timeline/promise-timeline.component';
import { ClaimCardComponent } from '../../shared/claim-card/claim-card.component';
import { AnalysisProgressComponent } from './analysis-progress.component';
import {
  buildTimeline,
  normaliseQuarterKey,
  toClaimSummaries,
} from './claim-mapping';

/**
 * Company page — `/company/:ticker` (6.1). Fetches the company summary on
 * load (and on in-app ticker changes), so a direct/bookmarked URL renders the
 * same content with no prior search (AC4, FR29).
 *
 * On completed analysis it fills the timeline and claims slots of the
 * CompanyPageLayout (6.3): the promise timeline + the claim-card list, driven
 * by one `GET /companies/:ticker/claims`. The quarter filter is reflected in
 * the URL (`?quarter=Q3-2024`) so the filtered view is shareable. The score
 * and detail slots stay as placeholders until 6.4 / 6.5 wire them.
 */
@Component({
  selector: 'app-company',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    CompanyPageLayoutComponent,
    ErrorStateComponent,
    PromiseTimelineComponent,
    ClaimCardComponent,
    AnalysisProgressComponent,
  ],
  template: `
    @switch (state()) {
      @case ('loading') {
        <p class="page-status" role="status">Loading {{ normalisedTicker() }}…</p>
      }
      @case ('error') {
        <div class="page-status">
          <app-error-state
            [kind]="errorKind()"
            [context]="normalisedTicker()"
            (retry)="load()"
          />
        </div>
      }
      @case ('success') {
        @if (company(); as c) {
          <header class="company-header">
            <h1 class="company-header__name">
              {{ c.name }}
              <span class="company-header__ticker mono">{{ c.ticker }}</span>
            </h1>
            <p class="company-header__meta">
              @if (c.lastAnalysedAt; as analysedAt) {
                Last analysed {{ analysedAt | date: 'mediumDate' }}
              } @else if (c.jobStatus === 'QUEUED' || c.jobStatus === 'RUNNING') {
                Analysis in progress…
              } @else {
                Not analysed yet
              }
            </p>
          </header>
        }

        @if (liveJobId(); as jobId) {
          <!-- 6.2: live analysis run — the SSE feed replaces the placeholder
               grid; (completed) refetches the summary so the dashboard
               re-renders without a manual refresh (AC3). -->
          <section class="live-run" aria-labelledby="live-run-heading">
            <h2 id="live-run-heading" class="live-run__heading">
              Analysing {{ normalisedTicker() }}…
            </h2>
            <app-analysis-progress
              [jobId]="jobId"
              [ticker]="normalisedTicker()"
              (completed)="load()"
            />
          </section>
        } @else {
          <app-company-page-layout>
            <section score>
              <h2 class="pending__heading">CEO delivery score</h2>
              <p class="pending__body">The score appears once analysis completes.</p>
            </section>

            <!-- 6.3: promise timeline — full-width, oldest-first; selecting a
                 quarter filters the claim list and writes ?quarter= to the URL. -->
            <app-promise-timeline
              timeline
              [columns]="timeline().columns"
              [selectedIndex]="selectedIndex()"
              (selectQuarter)="onSelectQuarter($event)"
            />

            <!-- 6.3: claim list — chronological cards, filtered to the selected
                 quarter; activating a card records the selection for 6.5. -->
            <section claims aria-labelledby="claims-heading">
              <h2 id="claims-heading" class="claims__heading">Claims</h2>
              @switch (claimsState()) {
                @case ('loading') {
                  <p class="claims__status" role="status">Loading claims…</p>
                }
                @case ('error') {
                  <app-error-state
                    kind="edgar-unavailable"
                    [context]="normalisedTicker()"
                    (retry)="loadClaims()"
                  />
                }
                @case ('success') {
                  @if (visibleClaims().length === 0) {
                    <p class="claims__status">No claims yet.</p>
                  } @else {
                    <ul class="claims__list">
                      @for (c of visibleClaims(); track c.id) {
                        <li>
                          <app-claim-card
                            [claim]="c"
                            [selected]="c.id === selectedClaimId()"
                            (claimSelect)="onSelectClaim($event)"
                          />
                        </li>
                      }
                    </ul>
                  }
                }
              }
            </section>

            <section detail>
              <h2 class="pending__heading">Claim detail</h2>
              <p class="pending__body">Select a claim to see its reasoning trace.</p>
            </section>
          </app-company-page-layout>
        }
      }
    }
  `,
  styles: `
    .page-status {
      max-width: var(--max-w);
      margin: 0 auto;
      padding: var(--space-7) var(--gutter);
      color: var(--ink-3);
      font-size: var(--text-sm);
    }
    .company-header {
      max-width: var(--max-w);
      margin: 0 auto;
      padding: var(--space-6) var(--gutter) var(--space-5);
    }
    .company-header__name {
      margin: 0;
      font-family: var(--font-serif);
      font-size: var(--text-2xl);
      line-height: 1.15;
      color: var(--ink);
    }
    .company-header__ticker {
      margin-left: var(--space-2);
      font-size: var(--text-base);
      font-weight: 600;
      color: var(--ink-3);
      text-transform: uppercase;
      vertical-align: middle;
    }
    .company-header__meta {
      margin: var(--space-2) 0 0;
      font-size: var(--text-xs);
      color: var(--ink-3);
    }
    .live-run {
      max-width: var(--max-w);
      margin: 0 auto;
      padding: 0 var(--gutter) var(--space-7);
    }
    .live-run__heading {
      margin: 0 0 var(--space-3);
      font-size: var(--text-md);
      color: var(--ink);
    }
    .claims__heading {
      margin: 0 0 var(--space-4);
      font-size: var(--text-md);
      color: var(--ink);
    }
    .claims__status {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--ink-3);
    }
    .claims__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .pending__heading {
      margin: 0 0 var(--space-2);
      font-size: var(--text-md);
      color: var(--ink);
    }
    .pending__body {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--ink-3);
    }
  `,
})
export class CompanyComponent {
  /** Route param, bound via withComponentInputBinding (app.config.ts). */
  readonly ticker = input.required<string>();
  /** `?quarter=` query param, bound the same way — the timeline filter (AC3). */
  readonly quarter = input<string>();

  private readonly api = inject(CompanyApiService);
  private readonly router = inject(Router);

  /** The 4-state loading union (AC2's rule applies app-wide). */
  protected readonly state = signal<LoadState>('idle');
  protected readonly errorKind = signal<ErrorStateKind>('ticker-not-found');
  protected readonly company = signal<CompanySummary | null>(null);

  /** Claims region has its own load state so a claims failure never tears
   *  down the page header (6.3). */
  protected readonly claimsState = signal<LoadState>('idle');
  private readonly claims = signal<ClaimListItem[]>([]);

  /** Currently selected claim — the selection contract 6.5's detail panel consumes. */
  protected readonly selectedClaimId = signal<string | null>(null);

  /**
   * 6.2: jobId of a run that is currently live — non-null only while the
   * latest job is QUEUED/RUNNING, which swaps the placeholder grid for the
   * SSE progress feed (AC1).
   */
  protected readonly liveJobId = computed(() => {
    const c = this.company();
    return c && (c.jobStatus === 'QUEUED' || c.jobStatus === 'RUNNING')
      ? c.latestJobId
      : null;
  });

  /** 8-quarter, oldest-first timeline columns + their canonical keys (6.3). */
  protected readonly timeline = computed(() => buildTimeline(this.claims()));

  /** The active quarter filter as a canonical key, or null for "all quarters". */
  private readonly selectedQuarter = computed(() =>
    normaliseQuarterKey(this.quarter()),
  );

  /** The selected quarter as a timeline source index (null if none/unknown). */
  protected readonly selectedIndex = computed(() => {
    const key = this.selectedQuarter();
    if (key === null) return null;
    const i = this.timeline().keys.indexOf(key);
    return i === -1 ? null : i;
  });

  /** Claim cards for the active filter — all claims, or just the selected quarter. */
  protected readonly visibleClaims = computed(() => {
    const key = this.selectedQuarter();
    const items =
      key === null ? this.claims() : this.claims().filter((c) => c.quarter === key);
    return toClaimSummaries(items);
  });

  protected normalisedTicker(): string {
    return this.ticker().trim().toUpperCase();
  }

  constructor() {
    // Refetch whenever the bound :ticker changes (incl. first render), so the
    // URL is the single source of truth — stable and bookmarkable (AC4).
    effect(() => {
      this.ticker();
      untracked(() => this.load());
    });
  }

  protected load(): void {
    this.state.set('loading');
    this.api.getSummary(this.normalisedTicker()).subscribe({
      next: (summary) => {
        this.company.set(summary);
        this.state.set('success');
        // Only the dashboard branch shows claims — a live run renders the feed.
        if (!this.isLive(summary)) {
          this.loadClaims();
        }
      },
      error: (err: ApiError) => {
        this.errorKind.set(
          err.status === 404 ? 'ticker-not-found' : 'edgar-unavailable',
        );
        this.state.set('error');
      },
    });
  }

  protected loadClaims(): void {
    this.claimsState.set('loading');
    this.api.getClaims(this.normalisedTicker()).subscribe({
      next: (res) => {
        this.claims.set(res.data);
        this.claimsState.set('success');
      },
      error: () => this.claimsState.set('error'),
    });
  }

  /**
   * Timeline quarter selection → reflect it in the URL (AC3) by navigating to
   * the same company page with the merged `?quarter=` param (null clears it).
   * `withComponentInputBinding` round-trips the change back into `quarter()`,
   * keeping the URL the single source of truth for the filter.
   */
  protected onSelectQuarter(index: number | null): void {
    const key = index === null ? null : (this.timeline().keys[index] ?? null);
    void this.router.navigate(['/company', this.normalisedTicker()], {
      queryParams: { quarter: key },
      queryParamsHandling: 'merge',
    });
  }

  /** Card activation → record the selection for 6.5's detail panel (AC4). */
  protected onSelectClaim(id: string): void {
    this.selectedClaimId.set(id);
  }

  private isLive(summary: CompanySummary): boolean {
    return (
      (summary.jobStatus === 'QUEUED' || summary.jobStatus === 'RUNNING') &&
      summary.latestJobId !== null
    );
  }
}
