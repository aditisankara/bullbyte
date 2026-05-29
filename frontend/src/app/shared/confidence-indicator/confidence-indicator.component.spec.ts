import { TestBed } from '@angular/core/testing';
import {
  ConfidenceIndicatorComponent,
  LOW_CONFIDENCE_THRESHOLD,
} from './confidence-indicator.component';

describe('ConfidenceIndicatorComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfidenceIndicatorComponent],
    }).compileComponents();
  });

  function render(score: number) {
    const fixture = TestBed.createComponent(ConfidenceIndicatorComponent);
    fixture.componentRef.setInput('score', score);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('defines the low-confidence threshold as a constant', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.6);
  });

  it('displays the score numerically and as meter width', () => {
    const el = render(0.82);
    expect(el.querySelector('.conf__value')?.textContent?.trim()).toBe('0.82');
    const fill = el.querySelector('.conf__fill') as HTMLElement;
    expect(fill.style.width).toBe('82%');
    const meter = el.querySelector('[role="meter"]');
    expect(meter?.getAttribute('aria-valuenow')).toBe('0.82');
  });

  it('does not flag a score at or above the threshold', () => {
    const el = render(LOW_CONFIDENCE_THRESHOLD);
    expect(el.querySelector('.conf')?.classList.contains('conf--low')).toBe(false);
    expect(el.querySelector('.conf__flag')).toBeNull();
  });

  it('flags but does not suppress a low score', () => {
    const el = render(0.42);
    expect(el.querySelector('.conf')?.classList.contains('conf--low')).toBe(true);
    expect(el.querySelector('.conf__flag')?.textContent).toContain('Low confidence');
    // still shown, not suppressed
    expect(el.querySelector('.conf__value')?.textContent?.trim()).toBe('0.42');
  });

  it('clamps out-of-range scores', () => {
    expect(render(1.5).querySelector('.conf__value')?.textContent?.trim()).toBe('1.00');
    expect(render(-0.2).querySelector('.conf__value')?.textContent?.trim()).toBe('0.00');
  });
});
