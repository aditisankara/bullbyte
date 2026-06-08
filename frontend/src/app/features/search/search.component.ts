import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CompanyApiService } from '../../core/api/company-api.service';
import { ApiError } from '../../core/interceptors/http-error.interceptor';
import {
  SearchInputComponent,
  SearchState,
} from '../../shared/search-input/search-input.component';
import { ErrorStateKind } from '../../shared/error-state/error-state.component';

/**
 * Search page — the `/` entry point (6.1). A hero with the ticker search;
 * submit triggers `POST /companies/:ticker/analyze`, then navigates to
 * `/company/:ticker`. State follows the 4-state union (AC2); a 400/404 renders
 * ticker-not-found, anything else edgar-unavailable (AC3, UX-DR6).
 */
@Component({
  selector: 'app-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchInputComponent],
  template: `
    <section class="hero">
      <header class="hero__intro">
        <h1 class="hero__title">BullByte</h1>
        <p class="hero__tagline">
          Did the CEO deliver? Executive promises, verified against what the
          company actually filed.
        </p>
      </header>
      <app-search-input
        autofocus
        [state]="state()"
        [errorKind]="errorKind()"
        (tickerSearch)="onSearch($event)"
      />
    </section>
  `,
  styles: `
    .hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-4);
      max-width: var(--max-w);
      margin: 0 auto;
      padding: clamp(48px, 14vh, 140px) var(--gutter) var(--space-7);
      text-align: center;
    }
    .hero__intro {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-4);
    }
    .hero__title {
      margin: 0;
      font-family: var(--font-serif);
      font-size: var(--text-3xl);
      line-height: 1.1;
      color: var(--ink);
    }
    .hero__tagline {
      margin: 0;
      max-width: 44ch;
      font-size: var(--text-base);
      color: var(--ink-2);
    }
    app-search-input {
      display: contents;
    }
  `,
})
export class SearchComponent {
  private readonly api = inject(CompanyApiService);
  private readonly router = inject(Router);

  /** The 4-state loading union (AC2) — never a boolean. */
  protected readonly state = signal<SearchState>('idle');
  protected readonly errorKind = signal<ErrorStateKind>('ticker-not-found');

  protected onSearch(ticker: string): void {
    this.state.set('loading');
    this.api.analyze(ticker).subscribe({
      next: () => {
        this.state.set('success');
        void this.router.navigate(['/company', ticker]);
      },
      error: (err: ApiError) => {
        // 404: unknown ticker; 400: malformed ticker — same user remedy.
        this.errorKind.set(
          err.status === 404 || err.status === 400
            ? 'ticker-not-found'
            : 'edgar-unavailable',
        );
        this.state.set('error');
      },
    });
  }
}
