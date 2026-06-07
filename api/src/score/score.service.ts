import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.module';
import type { DrizzleDB } from '../db/drizzle.module';
import { claims, companies, verdicts } from '../db/schema';
import { CeoScoreDto, VerdictType } from './dto/ceo-score.dto';

@Injectable()
export class ScoreService {
	constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

	/**
	 * AC1/AC4: CEO Delivery Score for a ticker, or a TICKER_NOT_FOUND 404.
	 *
	 * Counts are per claim, not per verdict row: a claim's effective verdict is
	 * its latest verdicts row (corrections are newer, so latest = effective —
	 * same rule as 5.5), and claims with no verdict row yet count as pending.
	 * This deliberately diverges from 4.6's raw GROUP BY row counts, which
	 * would double-count corrected claims and miss verdict-less claims (AC4).
	 */
	async getScore(ticker: string): Promise<CeoScoreDto> {
		const [company] = await this.db
			.select({ id: companies.id })
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

		const claimRows = await this.db
			.select({ id: claims.id })
			.from(claims)
			.where(eq(claims.companyId, company.id));

		// Newest first, corrections winning created_at ties — the first row
		// seen per claim below is therefore its effective verdict.
		const verdictRows = await this.db
			.select({
				claimId: verdicts.claimId,
				verdictType: verdicts.verdictType,
			})
			.from(verdicts)
			.innerJoin(claims, eq(verdicts.claimId, claims.id))
			.where(eq(claims.companyId, company.id))
			.orderBy(desc(verdicts.createdAt), desc(verdicts.isCorrection));

		const effective = new Map<string, VerdictType>();
		for (const row of verdictRows) {
			if (!effective.has(row.claimId)) {
				effective.set(row.claimId, row.verdictType);
			}
		}

		let deliveredCount = 0;
		let missedCount = 0;
		let insufficientDataCount = 0;
		let pendingCount = 0;
		for (const claim of claimRows) {
			switch (effective.get(claim.id)) {
				case 'DELIVERED':
					deliveredCount++;
					break;
				case 'MISSED':
					missedCount++;
					break;
				case 'INSUFFICIENT_DATA':
					insufficientDataCount++;
					break;
				case 'REVISED':
					break; // Phase 2 — silently excluded (parity with 4.6)
				default:
					pendingCount++; // PENDING verdict, or no verdict row yet (AC4)
			}
		}

		const totalResolved = deliveredCount + missedCount;
		const score =
			totalResolved === 0 ? null : deliveredCount / totalResolved;
		const context =
			totalResolved === 0
				? 'No resolved claims yet'
				: `${deliveredCount} of ${totalResolved} resolved promises delivered` +
					(pendingCount ? ` — ${pendingCount} pending` : '') +
					(insufficientDataCount
						? ` — ${insufficientDataCount} insufficient data`
						: '');

		return {
			ticker,
			score,
			deliveredCount,
			missedCount,
			totalResolved,
			pendingCount,
			insufficientDataCount,
			context,
		};
	}
}
