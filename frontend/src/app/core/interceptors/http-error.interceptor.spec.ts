import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { httpErrorInterceptor, ApiError } from './http-error.interceptor';

describe('httpErrorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([httpErrorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should catch a 404 and return a sanitized ApiError', async () => {
    const promise = firstValueFrom(http.get<never>('/api/test')).catch((err) => err as ApiError);
    httpMock.expectOne('/api/test').flush('Not Found', { status: 404, statusText: 'Not Found' });
    const err = await promise;
    expect(err.status).toBe(404);
    expect(err.message).toBe('The request could not be completed.');
  });

  it('should catch a 500 and return a sanitized ApiError', async () => {
    const promise = firstValueFrom(http.get<never>('/api/test')).catch((err) => err as ApiError);
    httpMock
      .expectOne('/api/test')
      .flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
    const err = await promise;
    expect(err.status).toBe(500);
    expect(err.message).toBe('A server error occurred. Please try again later.');
  });

  it('should catch a status 0 (network error) and return a connection error message', async () => {
    const promise = firstValueFrom(http.get<never>('/api/test')).catch((err) => err as ApiError);
    httpMock.expectOne('/api/test').flush('', { status: 0, statusText: 'Unknown Error' });
    const err = await promise;
    expect(err.status).toBe(0);
    expect(err.message).toBe('Unable to reach the server. Please check your connection.');
  });

  it('should not expose raw error details to the caller', async () => {
    const promise = firstValueFrom(http.get<never>('/api/test')).catch((err) => err as ApiError);
    httpMock.expectOne('/api/test').flush(
      { error: 'Internal Server Error', stack: 'Error at line 1' },
      { status: 500, statusText: 'Internal Server Error' },
    );
    const err = await promise;
    expect(err.message).not.toContain('Internal Server Error');
    expect(err.message).not.toContain('stack');
  });
});
