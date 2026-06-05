import { TestBed } from '@angular/core/testing';
import { ErrorStateComponent, ErrorStateKind } from './error-state.component';

const KINDS: ErrorStateKind[] = [
  'ticker-not-found',
  'edgar-unavailable',
  'analysis-timeout',
  'low-confidence',
];

describe('ErrorStateComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ErrorStateComponent],
    }).compileComponents();
  });

  function render(kind: ErrorStateKind, inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(ErrorStateComponent);
    fixture.componentRef.setInput('kind', kind);
    for (const [k, v] of Object.entries(inputs)) {
      fixture.componentRef.setInput(k, v);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('covers all four states with icon, heading, and body', () => {
    for (const kind of KINDS) {
      const el = render(kind).nativeElement as HTMLElement;
      expect(el.querySelector('svg.error__icon')?.children.length ?? 0).toBeGreaterThan(0);
      expect(el.querySelector('.error__heading')?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      expect(el.querySelector('.error__body')?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('weaves the ticker context into the not-found copy', () => {
    const el = render('ticker-not-found', { context: 'XYZ' }).nativeElement as HTMLElement;
    expect(el.querySelector('.error__body')?.textContent).toContain('XYZ');
  });

  it('offers retry on recoverable states and emits on click', () => {
    for (const kind of ['ticker-not-found', 'edgar-unavailable', 'analysis-timeout'] as ErrorStateKind[]) {
      const fixture = render(kind);
      let emitted = false;
      fixture.componentInstance.retry.subscribe(() => (emitted = true));
      const button = (fixture.nativeElement as HTMLElement).querySelector(
        'button.error__retry',
      ) as HTMLButtonElement;
      expect(button).not.toBeNull();
      button.click();
      expect(emitted).toBe(true);
    }
  });

  it('does not offer retry on low-confidence (flagged, not a failure)', () => {
    const fixture = render('low-confidence');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('button.error__retry')).toBeNull();
    // announced politely, not as an alert
    expect(el.querySelector('.error')?.getAttribute('role')).toBe('status');
  });

  it('marks failure states with role=alert', () => {
    const el = render('edgar-unavailable').nativeElement as HTMLElement;
    expect(el.querySelector('.error')?.getAttribute('role')).toBe('alert');
  });

  it('respects copy overrides', () => {
    const el = render('analysis-timeout', {
      heading: 'Custom heading',
      body: 'Custom body',
    }).nativeElement as HTMLElement;
    expect(el.querySelector('.error__heading')?.textContent?.trim()).toBe('Custom heading');
    expect(el.querySelector('.error__body')?.textContent?.trim()).toBe('Custom body');
  });
});
