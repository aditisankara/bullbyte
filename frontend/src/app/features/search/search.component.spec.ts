import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { SearchComponent } from './search.component';
import { httpErrorInterceptor } from '../../core/interceptors/http-error.interceptor';
import { environment } from '../../../environments/environment';

describe('SearchComponent', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchComponent],
      providers: [
        provideHttpClient(withInterceptors([httpErrorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  function render() {
    const fixture = TestBed.createComponent(SearchComponent);
    fixture.detectChanges();
    return fixture;
  }

  function submit(fixture: ReturnType<typeof render>, ticker: string) {
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input.search__input') as HTMLInputElement;
    input.value = ticker;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('form.search') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    fixture.detectChanges();
  }

  it('renders one h1 and a prominent search input (AC1, AC5)', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.querySelector('h1')?.textContent).toContain('BullByte');
    expect(el.querySelector('form[role="search"] input')).not.toBeNull();
  });

  it('focuses the search input automatically (AC1)', async () => {
    const fixture = render();
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input.search__input',
    );
    expect(document.activeElement).toBe(input);
  });

  it('POSTs /analyze then navigates to /company/:ticker on success (AC2)', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = render();
    submit(fixture, 'tsla');

    const req = http.expectOne(
      `${environment.apiBaseUrl}/companies/TSLA/analyze`,
    );
    expect(req.request.method).toBe('POST');
    req.flush({ jobId: 'job-1', status: 'QUEUED' }, { status: 202, statusText: 'Accepted' });
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/company', 'TSLA']);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.search__status--ok'),
    ).not.toBeNull();
  });

  it('renders ticker-not-found on a 404 with no raw API text (AC3)', () => {
    const fixture = render();
    submit(fixture, 'XYZ');

    http
      .expectOne(`${environment.apiBaseUrl}/companies/XYZ/analyze`)
      .flush(
        { statusCode: 404, error: 'NOT_FOUND', code: 'TICKER_NOT_FOUND' },
        { status: 404, statusText: 'Not Found' },
      );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-error-state')).not.toBeNull();
    expect(el.textContent).toContain('No filings found');
    expect(el.textContent).not.toContain('TICKER_NOT_FOUND');
    expect(el.textContent).not.toContain('404');
  });

  it('renders edgar-unavailable on a server error (AC3)', () => {
    const fixture = render();
    submit(fixture, 'TSLA');

    http
      .expectOne(`${environment.apiBaseUrl}/companies/TSLA/analyze`)
      .flush('boom', { status: 503, statusText: 'Service Unavailable' });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'EDGAR is unavailable',
    );
  });
});
