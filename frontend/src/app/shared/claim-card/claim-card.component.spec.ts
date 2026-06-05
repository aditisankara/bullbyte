import { TestBed } from '@angular/core/testing';
import { ClaimCardComponent } from './claim-card.component';
import { ClaimSummary } from '../claim/claim';

const CLAIM: ClaimSummary = {
  id: 'spot-q124-mau',
  quarter: 'Q1 2024',
  metric: 'MAU guidance',
  quote: 'We expect monthly active users to reach 620 million by the end of fiscal year 2024.',
  speaker: 'Daniel Ek · CEO',
  verdict: 'MISSED',
  delta: '−18M (−2.9%)',
  confidence: 0.94,
};

describe('ClaimCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClaimCardComponent],
    }).compileComponents();
  });

  function render(claim: ClaimSummary = CLAIM, selected = false) {
    const fixture = TestBed.createComponent(ClaimCardComponent);
    fixture.componentRef.setInput('claim', claim);
    fixture.componentRef.setInput('selected', selected);
    fixture.detectChanges();
    return fixture;
  }

  it('shows quarter, metric, quote, and speaker attribution', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('.card__quarter')?.textContent).toContain('Q1 2024');
    expect(el.querySelector('.card__metric')?.textContent).toContain('MAU guidance');
    expect(el.querySelector('.card__quote')?.textContent).toContain('620 million');
    expect(el.querySelector('.card__speaker')?.textContent).toContain('Daniel Ek · CEO');
  });

  it('renders the verdict via badge (icon + label, not colour alone)', () => {
    const el = render().nativeElement as HTMLElement;
    const badge = el.querySelector('app-verdict-badge .badge');
    expect(badge?.querySelector('svg')).not.toBeNull();
    expect(badge?.querySelector('.badge__label')?.textContent?.trim()).toBe('Missed');
  });

  it('renders the confidence indicator', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('app-confidence-indicator [role="meter"]')).not.toBeNull();
  });

  it('is keyboard-focusable and activates via a real button', () => {
    const fixture = render();
    let emitted: string | undefined;
    fixture.componentInstance.claimSelect.subscribe((id) => (emitted = id));
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button.card__action',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    // a native button is in the tab order and Enter/Space activate click
    button.click();
    expect(emitted).toBe('spot-q124-mau');
  });

  it('reflects the selected state via aria-pressed', () => {
    const el = render(CLAIM, true).nativeElement as HTMLElement;
    expect(el.querySelector('button.card__action')?.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.card')?.classList.contains('card--selected')).toBe(true);
  });

  it('marks delta direction for non-colour styling hooks', () => {
    expect(
      (render({ ...CLAIM, delta: '+240bps' }).nativeElement as HTMLElement)
        .querySelector('.card__delta')
        ?.getAttribute('data-dir'),
    ).toBe('up');
    expect(
      (render({ ...CLAIM, delta: '−18M' }).nativeElement as HTMLElement)
        .querySelector('.card__delta')
        ?.getAttribute('data-dir'),
    ).toBe('down');
  });

  it('omits the delta when absent', () => {
    const el = render({ ...CLAIM, delta: undefined }).nativeElement as HTMLElement;
    expect(el.querySelector('.card__delta')).toBeNull();
  });
});
