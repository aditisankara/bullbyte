import { TestBed } from '@angular/core/testing';
import { SearchInputComponent, SearchState } from './search-input.component';

describe('SearchInputComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchInputComponent],
    }).compileComponents();
  });

  function render(state: SearchState = 'idle') {
    const fixture = TestBed.createComponent(SearchInputComponent);
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    return fixture;
  }

  function typeAndSubmit(fixture: ReturnType<typeof render>, raw: string) {
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input.search__input') as HTMLInputElement;
    input.value = raw;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('form.search') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    fixture.detectChanges();
  }

  it('renders an accessible search field and submit control', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('form[role="search"]')).not.toBeNull();
    const input = el.querySelector('input.search__input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Search a ticker');
    expect(input.placeholder).toContain('Search a ticker');
  });

  it('emits the normalised (trimmed, uppercased) ticker on submit', () => {
    const fixture = render();
    let emitted: string | undefined;
    fixture.componentInstance.tickerSearch.subscribe((t) => (emitted = t));
    typeAndSubmit(fixture, '  spot  ');
    expect(emitted).toBe('SPOT');
  });

  it('disables submit when the field is empty and does not emit', () => {
    const fixture = render();
    let emitted = false;
    fixture.componentInstance.tickerSearch.subscribe(() => (emitted = true));
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button.search__submit',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    typeAndSubmit(fixture, '   ');
    expect(emitted).toBe(false);
  });

  it('shows a busy state while loading', () => {
    const fixture = render('loading');
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input.search__input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelector('.search__spinner')).not.toBeNull();
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Analysing');
  });

  it('renders the ticker-not-found error state with the submitted ticker', () => {
    const fixture = render('idle');
    typeAndSubmit(fixture, 'xyz');
    fixture.componentRef.setInput('state', 'error');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-error-state')).not.toBeNull();
    expect(el.querySelector('.error__body')?.textContent).toContain('XYZ');
  });

  it('announces success without an error', () => {
    const el = render('success').nativeElement as HTMLElement;
    expect(el.querySelector('.search__status--ok')).not.toBeNull();
    expect(el.querySelector('app-error-state')).toBeNull();
  });

  it('renders the provided errorKind instead of ticker-not-found (6.1)', () => {
    const fixture = render('error');
    fixture.componentRef.setInput('errorKind', 'edgar-unavailable');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.error__heading')?.textContent).toContain(
      'EDGAR is unavailable',
    );
  });

  it('focuses the input on first render when autofocus is set (6.1 AC1)', async () => {
    const fixture = TestBed.createComponent(SearchInputComponent);
    fixture.componentRef.setInput('autofocus', true);
    fixture.detectChanges();
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input.search__input',
    );
    expect(document.activeElement).toBe(input);
  });
});
