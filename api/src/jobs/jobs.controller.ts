import { Controller, HttpStatus, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { JobsService } from './jobs.service';
import { AnalyzeResponseDto } from './dto/analyze-response.dto';
import { TickerValidationPipe } from './ticker-validation.pipe';

@Controller('companies/:ticker')
export class JobsController {
	constructor(private readonly jobsService: JobsService) {}

	/**
	 * POST /api/v1/companies/:ticker/analyze
	 * 202 ACCEPTED for a newly queued job, 200 OK for a cache hit (AC1, AC3).
	 * No auth / no PII (FR30, NFR15).
	 */
	@Post('analyze')
	async analyze(
		@Param('ticker', TickerValidationPipe) ticker: string,
		@Res({ passthrough: true }) res: Response
	): Promise<AnalyzeResponseDto> {
		const result = await this.jobsService.requestAnalysis(ticker);
		res.status(
			result.status === 'COMPLETED' ? HttpStatus.OK : HttpStatus.ACCEPTED
		);
		return result;
	}
}
