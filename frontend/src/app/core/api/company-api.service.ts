import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AnalyzeResponse, CeoScoreDto, CompanySummary } from './company.models';
import { ClaimDetailApi, ClaimListResponse } from './claim.models';

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

  /** Claims timeline for a ticker — up to 8 quarters (FR31, Story 5.5). Paginated by the API. */
  getClaims(ticker: string, page = 1): Observable<ClaimListResponse> {
    return this.http.get<ClaimListResponse>(
      `${this.base}/${encodeURIComponent(ticker)}/claims`,
      { params: { page } },
    );
  }

  /** CEO Delivery Score with sample-size context (FR22–FR24, 5.6). */
  getScore(ticker: string): Observable<CeoScoreDto> {
    return this.http.get<CeoScoreDto>(
      `${this.base}/${encodeURIComponent(ticker)}/score`,
    );
  }

  /** Full detail for one claim incl. the reasoning trace (FR36–FR39, Story 5.5).
   *  Note: served at `/claims/:id`, not under `/companies`. */
  getClaimDetail(claimId: string): Observable<ClaimDetailApi> {
    return this.http.get<ClaimDetailApi>(
      `${environment.apiBaseUrl}/claims/${encodeURIComponent(claimId)}`,
    );
  }
}
