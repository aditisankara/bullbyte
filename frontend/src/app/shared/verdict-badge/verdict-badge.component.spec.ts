import { TestBed } from '@angular/core/testing';
import { VerdictBadgeComponent } from './verdict-badge.component';
import { VERDICTS, VERDICT_META, Verdict } from '../verdict/verdict';

describe('VerdictBadgeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VerdictBadgeComponent],
    }).compileComponents();
  });

  function render(verdict: Verdict) {
    const fixture = TestBed.createComponent(VerdictBadgeComponent);
    fixture.componentRef.setInput('verdict', verdict);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders all five verdict states with label and icon', () => {
    expect(VERDICTS.length).toBe(5);
    for (const verdict of VERDICTS) {
      const el = render(verdict);
      const label = el.querySelector('.badge__label');
      const icon = el.querySelector('svg.badge__icon');

      // Label text is always present (never colour alone, UX-DR2)
      expect(label?.textContent?.trim()).toBe(VERDICT_META[verdict].label);
      // Icon glyph rendered
      expect(icon).not.toBeNull();
      expect(icon?.children.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('includes INSUFFICIENT_DATA as the fifth state', () => {
    const el = render('INSUFFICIENT_DATA');
    expect(el.querySelector('.badge__label')?.textContent?.trim()).toBe('Insufficient data');
  });

  it('binds the verdict colour tokens', () => {
    const badge = render('MISSED').querySelector('.badge') as HTMLElement;
    expect(badge.style.background).toContain('--verdict-missed-bg');
    expect(badge.style.color).toContain('--verdict-missed-ink');
  });

  it('applies the small-size modifier', () => {
    const fixture = TestBed.createComponent(VerdictBadgeComponent);
    fixture.componentRef.setInput('verdict', 'DELIVERED');
    fixture.componentRef.setInput('size', 'sm');
    fixture.detectChanges();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('.badge');
    expect(badge?.classList.contains('badge--sm')).toBe(true);
  });
});
