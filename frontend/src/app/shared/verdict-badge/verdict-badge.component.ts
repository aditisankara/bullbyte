import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Verdict, VERDICT_META } from '../verdict/verdict';

/**
 * VerdictBadge — renders one of the five verdict states as a pill with a
 * background token, ink token, glyph icon, and text label. Colour and label
 * always appear together; the label is never omitted (UX-DR2).
 *
 * Ported from the design system's `VerdictPill` (Primitives.jsx), extended
 * with the INSUFFICIENT_DATA state added in Story 2.1/2.2.
 */
@Component({
  selector: 'app-verdict-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="badge"
      [class.badge--sm]="size() === 'sm'"
      [style.background]="'var(--verdict-' + meta().token + '-bg)'"
      [style.color]="'var(--verdict-' + meta().token + '-ink)'"
    >
      <svg
        class="badge__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        @switch (meta().token) {
          @case ('delivered') {
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12.5 L11 15.5 L16.5 9.5" />
          }
          @case ('missed') {
            <circle cx="12" cy="12" r="9" />
            <line x1="7" y1="17" x2="17" y2="7" />
          }
          @case ('pending') {
            <circle cx="12" cy="12" r="9" fill="none" />
            <path d="M12 3 A9 9 0 0 1 12 21 Z" fill="currentColor" />
          }
          @case ('insufficient') {
            <circle cx="12" cy="12" r="9" />
            <line x1="8" y1="12" x2="16" y2="12" />
          }
          @case ('revised') {
            <path d="M5 9 Q12 4 19 9" />
            <polyline points="16,7 19,9 17,12" />
            <path d="M19 15 Q12 20 5 15" />
            <polyline points="8,17 5,15 7,12" />
          }
        }
      </svg>
      <span class="badge__label">{{ meta().label }}</span>
    </span>
  `,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
      padding: 4px 10px 4px 8px;
      border-radius: var(--radius-sm);
      white-space: nowrap;
    }
    .badge--sm {
      font-size: 11px;
      padding: 2px 7px 2px 6px;
    }
    .badge__icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }
    .badge--sm .badge__icon {
      width: 12px;
      height: 12px;
    }
  `,
})
export class VerdictBadgeComponent {
  readonly verdict = input.required<Verdict>();
  readonly size = input<'sm' | 'md'>('md');

  protected readonly meta = computed(() => VERDICT_META[this.verdict()]);
}
