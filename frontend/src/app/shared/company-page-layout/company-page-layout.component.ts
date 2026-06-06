import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * CompanyPageLayout — the responsive blueprint for the company page (AC2–AC4,
 * NFR23, UX-DR8). Four projected slots, composed by Epic 6:
 *   [score]    — CeoScoreCard
 *   [timeline] — PromiseTimeline
 *   [claims]   — the claim list (ClaimCards)
 *   [detail]   — ClaimDetailPanel
 *
 * Breakpoints (see shared/layout/breakpoints.ts):
 *   - mobile  (≥320):       single column; sections separated by hairline + space.
 *   - tablet  (768–1279):   single column, score → timeline → claims → detail
 *                           (detail renders inline below the claim list).
 *   - desktop (≥1280):      score and timeline full-width; below them a two-column
 *                           row — claims (1.1fr) + a sticky detail rail (1fr) — so
 *                           score, timeline, and detail are visible together.
 *
 * Spacing/gutters use tokens only; no fixed pixel widths, and every flex/grid
 * child sets min-width:0 so there is no horizontal overflow at 320px.
 */
@Component({
  selector: 'app-company-page-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="layout">
      <section class="layout__score"><ng-content select="[score]" /></section>
      <section class="layout__timeline"><ng-content select="[timeline]" /></section>
      <div class="layout__body">
        <section class="layout__claims"><ng-content select="[claims]" /></section>
        <aside class="layout__detail"><ng-content select="[detail]" /></aside>
      </div>
    </div>
  `,
  styles: `
    .layout {
      display: flex;
      flex-direction: column;
      gap: var(--space-7);
      max-width: var(--max-w);
      margin: 0 auto;
      padding: 0 var(--gutter);
    }
    .layout__score,
    .layout__timeline,
    .layout__claims,
    .layout__detail {
      min-width: 0;
    }
    .layout__score,
    .layout__timeline {
      padding-bottom: var(--space-7);
      border-bottom: 1px solid var(--rule);
    }
    .layout__body {
      display: flex;
      flex-direction: column;
      gap: var(--space-7);
    }
    /* Desktop: score + timeline full width above; claims + sticky detail rail. */
    @media (min-width: 1280px) {
      .layout__body {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
        gap: var(--gutter);
        align-items: start;
      }
      .layout__detail {
        position: sticky;
        top: calc(var(--nav-h) + var(--space-4));
      }
    }
  `,
})
export class CompanyPageLayoutComponent {}
