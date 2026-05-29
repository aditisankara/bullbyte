import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ErrorStateComponent } from '../error-state/error-state.component';

/** The four states of the search loading union (AC1). */
export type SearchState = 'idle' | 'loading' | 'success' | 'error';

/**
 * SearchInput — the primary entry point. A ticker search field with a submit
 * action and the four-state union: idle, loading, success (parent redirects),
 * and error (ticker not found, via the shared ErrorState).
 *
 * Keyboard operable: native input + button, submit on Enter, with the global
 * gold AA focus indicator (UX-DR7, NFR21).
 */
@Component({
  selector: 'app-search-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorStateComponent],
  template: `
    <form class="search" (submit)="onSubmit($event)" role="search">
      <div class="search__field" [class.search__field--mono]="value().length > 0">
        <svg
          class="search__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3-3" />
        </svg>
        <input
          #ticker
          class="search__input"
          type="text"
          name="ticker"
          autocomplete="off"
          spellcheck="false"
          [attr.aria-label]="'Search a ticker'"
          [attr.aria-busy]="state() === 'loading'"
          [disabled]="state() === 'loading'"
          placeholder="Search a ticker — SPOT, NVDA, TSLA…"
          [value]="value()"
          (input)="value.set($any($event.target).value)"
        />
        <button
          class="search__submit"
          type="submit"
          [disabled]="state() === 'loading' || value().trim().length === 0"
        >
          @if (state() === 'loading') {
            <span class="search__spinner" aria-hidden="true"></span>
            <span class="visually-hidden">Analysing…</span>
          } @else {
            Search
          }
        </button>
      </div>

      @if (state() === 'loading') {
        <p class="search__status" role="status">
          Analysing {{ submittedTicker() }}…
        </p>
      }
      @if (state() === 'success') {
        <p class="search__status search__status--ok" role="status">
          Found {{ submittedTicker() }} — opening…
        </p>
      }
    </form>

    @if (state() === 'error') {
      <app-error-state
        kind="ticker-not-found"
        [context]="submittedTicker()"
        (retry)="onRetry()"
      />
    }
  `,
  styles: `
    .search {
      width: 100%;
      max-width: 480px;
    }
    .search__field {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      background: var(--paper-2);
      border: 1px solid var(--rule);
      border-radius: var(--radius-sm);
      padding-left: 36px;
      transition:
        border-color var(--dur-hover) var(--ease-out),
        background var(--dur-hover) var(--ease-out);
    }
    .search__field:focus-within {
      border-color: var(--ink);
      background: var(--paper);
    }
    .search__icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: var(--ink-3);
    }
    .search__input {
      flex: 1;
      min-width: 0;
      padding: 10px 0;
      border: 0;
      background: transparent;
      outline: none;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--ink);
    }
    .search__field--mono .search__input {
      font-family: var(--font-mono);
      font-weight: 600;
      text-transform: uppercase;
    }
    .search__input::placeholder {
      color: var(--ink-3);
      text-transform: none;
      font-family: var(--font-sans);
      font-weight: 400;
    }
    .search__input:disabled {
      opacity: 0.6;
    }
    .search__submit {
      flex-shrink: 0;
      margin: 4px;
      padding: 6px 14px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: var(--ink);
      color: var(--paper);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      line-height: 1.2;
      cursor: pointer;
      transition: background var(--dur-hover) var(--ease-out);
    }
    .search__submit:hover:not(:disabled) {
      background: #000000;
    }
    .search__submit:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .search__status {
      margin: var(--space-2) 0 0;
      font-size: var(--text-xs);
      color: var(--ink-3);
    }
    .search__status--ok {
      color: var(--verdict-delivered-ink);
    }
    .search__spinner {
      display: inline-block;
      width: 13px;
      height: 13px;
      border: 2px solid var(--ink-tint-20);
      border-top-color: var(--paper);
      border-radius: var(--radius-full);
      animation: spin 0.7s linear infinite;
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
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .search__spinner { animation-duration: 2s; }
    }
  `,
})
export class SearchInputComponent {
  /** Current loading-union state, driven by the parent (6.1). */
  readonly state = input<SearchState>('idle');

  /** Emitted on submit with the normalised (trimmed, uppercased) ticker. */
  readonly tickerSearch = output<string>();

  protected readonly value = signal('');
  /** The ticker that was last submitted — used in loading/error/success copy. */
  protected readonly submittedTicker = signal('');

  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('ticker');

  protected onSubmit(event: Event): void {
    event.preventDefault();
    const ticker = this.value().trim().toUpperCase();
    if (!ticker) {
      return;
    }
    this.submittedTicker.set(ticker);
    this.tickerSearch.emit(ticker);
  }

  protected onRetry(): void {
    this.inputRef()?.nativeElement.focus();
  }
}
