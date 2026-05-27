import { Controller, Get, Param } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompanySummaryDto } from './dto/company-summary.dto';
// TODO(5.4 Task 3): relocate TickerValidationPipe to common/ to drop the jobs dependency.
import { TickerValidationPipe } from '../jobs/ticker-validation.pipe';

@Controller('companies')
export class CompaniesController {
	constructor(private readonly companiesService: CompaniesService) {}

	/**
	 * GET /api/v1/companies/:ticker — company summary (AC1) or 404 (AC2).
	 * No auth / no PII (FR30, NFR15).
	 */
	@Get(':ticker')
	getCompany(
		@Param('ticker', TickerValidationPipe) ticker: string
	): Promise<CompanySummaryDto> {
		return this.companiesService.getSummary(ticker);
	}
}
