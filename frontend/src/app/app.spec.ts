import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the disclaimer footer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const footer = (fixture.nativeElement as HTMLElement).querySelector('footer');
    expect(footer?.textContent).toContain(
      'Not financial advice. Data sourced from public SEC filings via EDGAR.',
    );
  });

  it('should contain a router-outlet', () => {
    const fixture = TestBed.createComponent(App);
    const routerOutlet = (fixture.nativeElement as HTMLElement).querySelector('router-outlet');
    expect(routerOutlet).not.toBeNull();
  });

  it('exposes a keyboard skip-link targeting the main landmark (NFR21, UX-DR7)', () => {
    const el = TestBed.createComponent(App).nativeElement as HTMLElement;
    const skip = el.querySelector('a.skip-link') as HTMLAnchorElement | null;
    const main = el.querySelector('main');
    expect(skip).not.toBeNull();
    expect(main).not.toBeNull();
    expect(skip?.getAttribute('href')).toBe('#main-content');
    expect(main?.getAttribute('id')).toBe('main-content');
    // skip-link precedes main so it is the first thing a keyboard user reaches.
    if (skip && main) {
      const pos = skip.compareDocumentPosition(main);
      expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('renders the main and footer landmarks (NFR20)', () => {
    const el = TestBed.createComponent(App).nativeElement as HTMLElement;
    expect(el.querySelector('main')).not.toBeNull();
    expect(el.querySelector('footer')).not.toBeNull();
  });
});
