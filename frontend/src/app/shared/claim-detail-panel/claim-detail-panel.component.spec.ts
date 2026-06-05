import { TestBed } from '@angular/core/testing';
import { ClaimDetailPanelComponent } from './claim-detail-panel.component';
import { ClaimDetail } from '../claim/claim';

const DETAIL: ClaimDetail = {
  id: 'spot-q124-mau',
  quarter: 'Q1 2024',
  metric: 'MAU guidance',
  quote: 'We expect monthly active users to reach 620 million by the end of fiscal year 2024.',
  speaker: 'Daniel Ek · CEO',
  verdict: 'MISSED',
  delta: '−18M (−2.9%)',
  confidence: 0.94,
  claimed: '620M',
  actual: '602M',
  filing: { type: '8-K', quarter: 'Q1 2024', url: 'https://www.sec.gov/edgar/spot-8k' },
  actualFiling: { type: '10-K', quarter: 'FY 2024', url: 'https://www.sec.gov/edgar/spot-10k' },
  trace: [{ tool: 'fetch_filing', args: 'form="8-K"', result: 'ok' }],
};

describe('ClaimDetailPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClaimDetailPanelComponent],
    }).compileComponents();
  });

  function render(claim: ClaimDetail | null = DETAIL, shareUrl?: string) {
    const fixture = TestBed.createComponent(ClaimDetailPanelComponent);
    fixture.componentRef.setInput('claim', claim);
    if (shareUrl !== undefined) {
      fixture.componentRef.setInput('shareUrl', shareUrl);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('shows an empty state when no claim is selected', () => {
    const el = render(null).nativeElement as HTMLElement;
    expect(el.querySelector('.panel--empty')?.textContent).toContain('Select a claim');
    expect(el.querySelector('article.panel')).toBeNull();
  });

  it('shows quote, speaker attribution, source quarter, verdict, delta, and confidence', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('.panel__quote')?.textContent).toContain('620 million');
    expect(el.querySelector('.panel__attribution')?.textContent).toContain('Daniel Ek · CEO');
    expect(el.querySelector('.panel__meta')?.textContent).toContain('Q1 2024');
    expect(el.querySelector('app-verdict-badge .badge__label')?.textContent?.trim()).toBe('Missed');
    expect(el.querySelector('.panel__delta')?.textContent).toContain('−18M');
    expect(el.querySelector('app-confidence-indicator [role="meter"]')).not.toBeNull();
  });

  it('renders the EDGAR filing link as an external new-tab link with type + quarter', () => {
    const el = render().nativeElement as HTMLElement;
    const link = el.querySelector('a.panel__filing') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('sec.gov');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.textContent).toContain('8-K');
    expect(link.textContent).toContain('Q1 2024');
  });

  it('embeds the collapsed reasoning trace', () => {
    const el = render().nativeElement as HTMLElement;
    const trace = el.querySelector('app-reasoning-trace .trace__toggle');
    expect(trace?.getAttribute('aria-expanded')).toBe('false');
  });

  it('emits share on the share button and shows no low-confidence note for high confidence', () => {
    const fixture = render();
    let shared: string | undefined;
    fixture.componentInstance.share.subscribe((id) => (shared = id));
    (fixture.nativeElement.querySelector('button.panel__share') as HTMLButtonElement).click();
    expect(shared).toBe('spot-q124-mau');
    expect((fixture.nativeElement as HTMLElement).querySelector('.panel__low-note')).toBeNull();
  });

  it('flags a low-confidence verdict with a note (not hidden)', () => {
    const el = render({ ...DETAIL, confidence: 0.42 }).nativeElement as HTMLElement;
    expect(el.querySelector('.panel__low-note')?.textContent).toContain('Low confidence');
    expect(el.querySelector('app-confidence-indicator .conf--low')).not.toBeNull();
    // confidence still shown, not suppressed
    expect(el.querySelector('app-confidence-indicator .conf__value')?.textContent?.trim()).toBe('0.42');
  });
});
