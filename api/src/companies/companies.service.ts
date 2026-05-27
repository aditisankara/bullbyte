import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.module';
import type { DrizzleDB } from '../db/drizzle.module';
import { analysisJobs, companies } from '../db/schema';
import { CompanySummaryDto } from './dto/company-summary.dto';

@Injectable()
export class CompaniesService {
	constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

	/** AC1/AC2: company summary by ticker, or a TICKER_NOT_FOUND 404. */
	async getSummary(ticker: string): Promise<CompanySummaryDto> {
		const [company] = await this.db
			.select()
			.from(companies)
			.where(eq(companies.ticker, ticker))
			.limit(1);

		if (!company) {
			// AllExceptionsFilter maps code/details into the canonical error shape.
			throw new NotFoundException({
				code: 'TICKER_NOT_FOUND',
				details: { ticker },
			});
		}

		const [latestJob] = await this.db
			.select({ status: analysisJobs.status })
			.from(analysisJobs)
			.where(eq(analysisJobs.companyId, company.id))
			.orderBy(desc(analysisJobs.createdAt))
			.limit(1);

		return {
			id: company.id,
			ticker: company.ticker,
			name: company.name,
			lastAnalysedAt: company.lastAnalysedAt
				? company.lastAnalysedAt.toISOString()
				: null,
			jobStatus: latestJob?.status ?? null,
		};
	}
}
