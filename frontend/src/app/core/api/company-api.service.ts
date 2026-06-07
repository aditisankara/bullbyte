import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AnalyzeResponse, CompanySummary } from './company.models';

/**
 * Typed client for the company endpoints (5.1 + 5.4). Raw error bodies never
 * reach callers — the httpErrorInterceptor maps failures to `ApiError`.
 */
@Injectable({ providedIn: 'root' })
export class CompanyApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/companies`;

  /** Trigger (or cache-hit) an analysis for a ticker (FR28). */
  analyze(ticker: string): Observable<AnalyzeResponse> {
    return this.http.post<AnalyzeResponse>(
      `${this.base}/${encodeURIComponent(ticker)}/analyze`,
      null,
    );
  }

  /** Top-level company summary for the dashboard (FR29). */
  getSummary(ticker: string): Observable<CompanySummary> {
    return this.http.get<CompanySummary>(
      `${this.base}/${encodeURIComponent(ticker)}`,
    );
  }
}
