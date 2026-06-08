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
import { CompanyApiService } from '../../core/api/company-api.service';
import { CompanySummary, LoadState } from '../../core/api/company.models';
import { ApiError } from '../../core/interceptors/http-error.interceptor';
import { CompanyPageLayoutComponent } from '../../shared/company-page-layout/company-page-layout.component';
import {
  ErrorStateComponent,
  ErrorStateKind,
} from '../../shared/error-state/error-state.component';
import { AnalysisProgressComponent } from './analysis-progress.component';
import { ScoreCardComponent } from './score-card.component';

/**
 * Company page — `/company/:ticker` (6.1). Fetches the company summary on
 * load (and on in-app ticker changes), so a direct/bookmarked URL renders the
 * same content with no prior search (AC4, FR29).
 *
 * Renders the company header (the page's single <h1>) and the responsive
 * CompanyPageLayout shell. The four slots show labelled pending placeholders
 * until 6.2–6.6 wire the live score, timeline, claims, and detail panels.
 */
@Component({
  selector: 'app-company',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    CompanyPageLayoutComponent,
    ErrorStateComponent,
    AnalysisProgressComponent,
    ScoreCardComponent,
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
              <!-- 6.4: the CEO Delivery Score card fetches the score itself. -->
              <app-score-card [ticker]="normalisedTicker()" />
            </section>
            <section timeline>
              <h2 class="pending__heading">Promise timeline</h2>
              <p class="pending__body">Extracted promises will be plotted here.</p>
            </section>
            <section claims>
              <h2 class="pending__heading">Claims</h2>
              <p class="pending__body">Verified claims will be listed here.</p>
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

  private readonly api = inject(CompanyApiService);

  /** The 4-state loading union (AC2's rule applies app-wide). */
  protected readonly state = signal<LoadState>('idle');
  protected readonly errorKind = signal<ErrorStateKind>('ticker-not-found');
  protected readonly company = signal<CompanySummary | null>(null);

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
      },
      error: (err: ApiError) => {
        this.errorKind.set(
          err.status === 404 ? 'ticker-not-found' : 'edgar-unavailable',
        );
        this.state.set('error');
      },
    });
  }
}
