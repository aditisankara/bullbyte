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
    expect(footer?.textContent).toContain('Not financial advice. Data sourced from public SEC filings.');
  });

  it('should contain a router-outlet', () => {
    const fixture = TestBed.createComponent(App);
    const routerOutlet = (fixture.nativeElement as HTMLElement).querySelector('router-outlet');
    expect(routerOutlet).not.toBeNull();
  });
});
