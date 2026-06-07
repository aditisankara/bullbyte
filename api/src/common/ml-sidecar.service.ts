import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Observable, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { AxiosResponse } from 'axios';

const SIDECAR_TIMEOUT_MS = 5000;

@Injectable()
export class MlSidecarService {
	private readonly baseUrl: string;

	constructor(
		private readonly httpService: HttpService,
		private readonly configService: ConfigService
	) {
		this.baseUrl = this.configService.getOrThrow<string>('ML_SIDECAR_URL');
	}

	getHealth(): Observable<
		AxiosResponse<{ status: string; service: string }>
	> {
		return this.httpService
			.get<{ status: string; service: string }>(`${this.baseUrl}/health`)
			.pipe(
				timeout(SIDECAR_TIMEOUT_MS),
				catchError(() =>
					throwError(
						() =>
							new ServiceUnavailableException(
								'ML sidecar unavailable'
							)
					)
				)
			);
	}

	/**
	 * Kicks off a fresh analysis run. The sidecar accepts the request (HTTP 202)
	 * and processes asynchronously, reporting progress via the webhook (story 5.3).
	 * Called only by the BullMQ analysis worker (story 5.1).
	 */
	analyze(
		ticker: string,
		jobId: string
	): Observable<AxiosResponse<{ jobId: string; status: string }>> {
		return this.httpService
			.post<{
				jobId: string;
				status: string;
			}>(`${this.baseUrl}/analyze/${ticker}`, { jobId })
			.pipe(
				timeout(SIDECAR_TIMEOUT_MS),
				catchError(() =>
					throwError(
						() =>
							new ServiceUnavailableException(
								'ML sidecar unavailable'
							)
					)
				)
			);
	}
}
