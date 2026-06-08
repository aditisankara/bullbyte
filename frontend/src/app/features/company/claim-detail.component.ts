import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { CompanyApiService } from '../../core/api/company-api.service';
import { LoadState } from '../../core/api/company.models';
import { ClaimDetail } from '../../shared/claim/claim';
import { ClaimDetailPanelComponent } from '../../shared/claim-detail-panel/claim-detail-panel.component';
import { toClaimDetail } from './claim-mapping';

/**
 * ClaimDetailComponent — the smart claim-detail panel (6.5). Fetches
 * `GET /claims/:claimId` (5.5) and renders the presentational ClaimDetailPanel
 * (2.5), adapting the DTO via `toClaimDetail`.
 *
 * Selection is URL-driven: the company page binds the `?claim=` param to
 * `claimId`, so the open panel is deep-linkable and shareable (AC4). A null
 * `claimId` shows the panel's empty state — no request.
 *
 * The 5.5 endpoint carries no "actual" value, so `showComparison` is off; the
 * header delta carries the quantitative outcome (FR37). The reasoning trace is
 * embedded collapsed — its per-step citation deepening is Story 6.6.
 *
 * Escape (or the close control) emits `closed`; the company page clears the
 * selection and restores focus to the originating card (AC5, NFR21).
 */
@Component({
  selector: 'app-claim-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClaimDetailPanelComponent],
  template: `
    @if (claimId()) {
      @if (state() === 'error') {
        <div class="claim-detail">
          <div class="claim-detail__bar">
            <button type="button" class="claim-detail__close" (click)="close()">Close</button>
          </div>
          <p class="claim-detail__status" role="alert">
            This claim could not be loaded.
          </p>
        </div>
      } @else if (detail(); as d) {
        <div class="claim-detail">
          <div class="claim-detail__bar">
            <button type="button" class="claim-detail__close" (click)="close()">Close</button>
          </div>
          <app-claim-detail-panel
            [claim]="d"
            [shareUrl]="shareUrl()"
            [showComparison]="false"
          />
        </div>
      } @else {
        <p class="claim-detail__status" role="status">Loading claim…</p>
      }
    } @else {
      <app-claim-detail-panel [claim]="null" />
    }
  `,
  styles: `
    .claim-detail__bar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: var(--space-2);
    }
    .claim-detail__close {
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--rule-strong);
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--ink-2);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      cursor: pointer;
    }
    .claim-detail__close:hover {
      background: var(--ink-tint-5);
    }
    .claim-detail__status {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--ink-3);
    }
  `,
})
export class ClaimDetailComponent {
  /** Selected claim id (the `?claim=` param), or null when nothing is open. */
  readonly claimId = input<string | null>(null);
  /** Absolute deep link for the open claim (FR41), copied on Share. */
  readonly shareUrl = input<string>();

  /** Emitted when the panel is closed (Escape or the close control). */
  readonly closed = output<void>();

  private readonly api = inject(CompanyApiService);

  protected readonly state = signal<LoadState>('idle');
  /** Last loaded detail — kept across selection changes so a refetch never
   *  flashes the empty state (NFR4). */
  protected readonly detail = signal<ClaimDetail | null>(null);

  constructor() {
    effect(() => {
      const id = this.claimId();
      untracked(() => {
        if (!id) {
          this.state.set('idle');
          return;
        }
        this.load(id);
      });
    });
  }

  private load(id: string): void {
    this.state.set('loading');
    this.api.getClaimDetail(id).subscribe({
      next: (dto) => {
        this.detail.set(toClaimDetail(dto));
        this.state.set('success');
      },
      error: () => this.state.set('error'),
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.claimId()) {
      this.close();
    }
  }

  protected close(): void {
    this.closed.emit();
  }
}
