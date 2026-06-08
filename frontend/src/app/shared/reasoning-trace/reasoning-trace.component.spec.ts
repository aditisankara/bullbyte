import { TestBed } from '@angular/core/testing';
import { ReasoningTraceComponent } from './reasoning-trace.component';
import { TraceStep } from '../claim/claim';

const STEPS: TraceStep[] = [
  { tool: 'fetch_filing', args: 'form="8-K"', result: 'ok' },
  {
    tool: 'extract_metric',
    args: 'metric="MAU"',
    result: '602M',
    citation: { label: '10-K 2024', url: 'https://www.sec.gov/edgar/spot-10k-2024' },
  },
];

describe('ReasoningTraceComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReasoningTraceComponent],
    }).compileComponents();
  });

  function render(steps: TraceStep[] = STEPS) {
    const fixture = TestBed.createComponent(ReasoningTraceComponent);
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();
    return fixture;
  }

  it('is collapsed by default and reports the step count', () => {
    const el = render().nativeElement as HTMLElement;
    const toggle = el.querySelector('.trace__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.trace__steps')).toBeNull();
    expect(el.querySelector('.trace__count')?.textContent).toContain('2 tool calls');
  });

  it('expands on user action and collapses again', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    const toggle = el.querySelector('.trace__toggle') as HTMLButtonElement;

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelectorAll('.trace__step').length).toBe(2);

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.trace__steps')).toBeNull();
  });

  it('renders ordered steps with tool, args, and result', () => {
    const fixture = render();
    (fixture.nativeElement.querySelector('.trace__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const first = el.querySelector('.trace__step');
    expect(first?.querySelector('.trace__index')?.textContent?.trim()).toBe('01');
    expect(first?.querySelector('.trace__tool')?.textContent).toContain('fetch_filing');
    expect(first?.querySelector('.trace__result')?.textContent).toContain('ok');
  });

  it('renders a per-step external EDGAR citation link where present', () => {
    const fixture = render();
    (fixture.nativeElement.querySelector('.trace__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const links = el.querySelectorAll('a.trace__cite');
    expect(links.length).toBe(1); // only the step with a citation
    const link = links[0] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('sec.gov');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.textContent).toContain('10-K 2024');
  });

  it('marks the failure step distinctly (6.6, AC4)', () => {
    const fixture = render([
      { tool: 'Temporal alignment', args: 'ticker=TSLA', result: 'Aligned' },
      { tool: 'Unit conflict', args: '', result: 'Unit conflict: …', failure: true },
    ]);
    (fixture.nativeElement.querySelector('.trace__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const steps = el.querySelectorAll('.trace__step');
    expect(steps[0].classList.contains('trace__step--failure')).toBe(false);
    expect(steps[1].classList.contains('trace__step--failure')).toBe(true);
    expect(steps[1].querySelector('.trace__failure-tag')?.textContent).toContain('trace ended here');
    // the failure reason is still shown as the step result (AC4)
    expect(steps[1].querySelector('.trace__result')?.textContent).toContain('Unit conflict');
  });
});
