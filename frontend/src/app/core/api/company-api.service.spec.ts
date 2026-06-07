import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { CompanyApiService } from './company-api.service';
import { AnalyzeResponse, CompanySummary } from './company.models';
import { environment } from '../../../environments/environment';

describe('CompanyApiService', () => {
  let service: CompanyApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CompanyApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('POSTs to /companies/:ticker/analyze and returns the typed response', () => {
    let response: AnalyzeResponse | undefined;
    service.analyze('TSLA').subscribe((r) => (response = r));

    const req = http.expectOne(
      `${environment.apiBaseUrl}/companies/TSLA/analyze`,
    );
    expect(req.request.method).toBe('POST');
    req.flush({ jobId: 'job-1', status: 'QUEUED' });

    expect(response).toEqual({ jobId: 'job-1', status: 'QUEUED' });
  });

  it('GETs /companies/:ticker and returns the company summary', () => {
    const summary: CompanySummary = {
      id: 'c-1',
      ticker: 'TSLA',
      name: 'Tesla, Inc.',
      lastAnalysedAt: '2026-06-01T00:00:00.000Z',
      jobStatus: 'COMPLETED',
    };
    let response: CompanySummary | undefined;
    service.getSummary('TSLA').subscribe((r) => (response = r));

    const req = http.expectOne(`${environment.apiBaseUrl}/companies/TSLA`);
    expect(req.request.method).toBe('GET');
    req.flush(summary);

    expect(response).toEqual(summary);
  });
});
