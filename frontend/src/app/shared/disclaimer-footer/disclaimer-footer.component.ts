import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Canonical disclaimer text. One string, used everywhere (FR44, UX-DR10).
 * Matches the design system source of truth (README "Disclaimer" section).
 */
export const DISCLAIMER_TEXT =
  'Not financial advice. Data sourced from public SEC filings via EDGAR.';

/**
 * DisclaimerFooter — the always-present, always-identical disclaimer rendered
 * in a semantic <footer> at the bottom of every page.
 */
@Component({
  selector: 'app-disclaimer-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="disclaimer">
      <p class="disclaimer__text">{{ text }}</p>
      <span class="disclaimer__build mono">BullByte · v0.1</span>
    </footer>
  `,
  styles: `
    .disclaimer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-3);
      max-width: var(--max-w);
      margin: var(--space-10) auto 0;
      padding: var(--space-5) var(--gutter);
      border-top: 1px solid var(--rule);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      color: var(--ink-3);
    }
    .disclaimer__text {
      margin: 0;
      line-height: var(--lh-normal);
      color: var(--ink-3);
    }
    .disclaimer__build {
      color: var(--ink-4);
    }
  `,
})
export class DisclaimerFooterComponent {
  protected readonly text = DISCLAIMER_TEXT;
}
