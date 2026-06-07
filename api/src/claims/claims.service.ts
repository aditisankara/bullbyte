import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SQL, and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.module';
import type { DrizzleDB } from '../db/drizzle.module';
import {
	claims,
	companies,
	reasoningTraces,
	transcripts,
	verdicts,
} from '../db/schema';
import type { Claim, Verdict } from '../db/schema';
import {
	CLAIMS_PAGE_SIZE,
	CLAIMS_QUARTER_WINDOW,
	LOW_CONFIDENCE_THRESHOLD,
} from './claims.constants';
import { ClaimVerdictDto } from './dto/claim-verdict.dto';
import { ClaimListItemDto, ClaimListResponseDto } from './dto/claim-list.dto';
import { ClaimDetailDto } from './dto/claim-detail.dto';

/**
 * Orders "Qn-YYYY" quarters newest-first: year (numeric) desc, then quarter
 * label desc ('Q4' > 'Q1' sorts correctly as text).
 */
const QUARTER_DESC: SQL = sql`split_part(${claims.quarter}, '-', 2)::int DESC, split_part(${claims.quarter}, '-', 1) DESC`;

@Injectable()
export class ClaimsService {
	constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

	/**
	 * AC1/AC4: paginated claims timeline for a ticker, restricted to the
	 * 8 most recent distinct quarters (FR31). Zero claims → empty 200.
	 */
	async listByTicker(
		ticker: string,
		page: number
	): Promise<ClaimListResponseDto> {
		const safePage = Math.max(1, Math.floor(page) || 1);

		const [company] = await this.db
			.select({ id: companies.id })
			.from(companies)
			.where(eq(companies.ticker, ticker))
			.limit(1);

		if (!company) {
			throw new NotFoundException({
				code: 'TICKER_NOT_FOUND',
				details: { ticker },
			});
		}

		// The 8-quarter window. GROUP BY (not DISTINCT) so Postgres allows
		// ordering by an expression over the grouped column.
		const quarterRows = await this.db
			.select({ quarter: claims.quarter })
			.from(claims)
			.where(eq(claims.companyId, company.id))
			.groupBy(claims.quarter)
			.orderBy(QUARTER_DESC)
			.limit(CLAIMS_QUARTER_WINDOW);
		const quarters = quarterRows.map((r) => r.quarter);

		if (quarters.length === 0) {
			return {
				data: [],
				meta: { total: 0, page: safePage, pageSize: CLAIMS_PAGE_SIZE },
			};
		}

		const windowFilter = and(
			eq(claims.companyId, company.id),
			inArray(claims.quarter, quarters)
		);

		const [{ total }] = await this.db
			.select({ total: count() })
			.from(claims)
			.where(windowFilter);

		const pageRows = await this.db
			.select()
			.from(claims)
			.where(windowFilter)
			.orderBy(QUARTER_DESC, desc(claims.createdAt))
			.limit(CLAIMS_PAGE_SIZE)
			.offset((safePage - 1) * CLAIMS_PAGE_SIZE);

		const latestVerdicts = await this.latestVerdictsFor(
			pageRows.map((c) => c.id)
		);

		return {
			data: pageRows.map((c) =>
				this.toListItem(c, latestVerdicts.get(c.id) ?? null)
			),
			meta: { total, page: safePage, pageSize: CLAIMS_PAGE_SIZE },
		};
	}

	/**
	 * AC2/AC3: full claim detail — effective verdict, ordered reasoning trace,
	 * EDGAR source URL, and the low-confidence flag. PostgreSQL only.
	 */
	async getDetail(claimId: string): Promise<ClaimDetailDto> {
		const [row] = await this.db
			.select({ claim: claims, ticker: companies.ticker })
			.from(claims)
			.innerJoin(companies, eq(claims.companyId, companies.id))
			.where(eq(claims.id, claimId))
			.limit(1);

		if (!row) {
			throw new NotFoundException({
				code: 'CLAIM_NOT_FOUND',
				details: { claimId },
			});
		}

		const verdictRows = await this.db
			.select()
			.from(verdicts)
			.where(eq(verdicts.claimId, claimId))
			.orderBy(desc(verdicts.createdAt));
		const latest = this.effectiveVerdict(verdictRows);

		// Trace rows belong to the latest verdicts row — shown even while the
		// verdict is pending, so the steps taken so far stay visible (FR36).
		const traceRows = latest
			? await this.db
					.select()
					.from(reasoningTraces)
					.where(eq(reasoningTraces.verdictId, latest.id))
					.orderBy(
						asc(reasoningTraces.stepIndex),
						asc(reasoningTraces.createdAt)
					)
			: [];

		const [transcript] = await this.db
			.select({ filingUrl: transcripts.filingUrl })
			.from(transcripts)
			.where(
				and(
					eq(transcripts.ticker, row.ticker),
					eq(transcripts.quarter, row.claim.quarter)
				)
			)
			.limit(1);

		const verdict = this.toVerdictDto(latest ?? null);

		return {
			...this.toListItem(row.claim, latest ?? null),
			edgarSourceUrl: transcript?.filingUrl ?? null,
			lowConfidence:
				verdict !== null &&
				verdict.confidenceScore !== null &&
				verdict.confidenceScore < LOW_CONFIDENCE_THRESHOLD,
			reasoningTrace: traceRows.map((t) => ({
				stepIndex: t.stepIndex,
				toolCall: t.toolCall,
				resultSummary: t.resultSummary,
				edgarFilingRef: t.edgarFilingRef,
			})),
		};
	}

	/** Effective verdicts row per claim (see effectiveVerdict). */
	private async latestVerdictsFor(
		claimIds: string[]
	): Promise<Map<string, Verdict>> {
		const latest = new Map<string, Verdict>();
		if (claimIds.length === 0) {
			return latest;
		}
		const rows = await this.db
			.select()
			.from(verdicts)
			.where(inArray(verdicts.claimId, claimIds))
			.orderBy(desc(verdicts.createdAt));
		const byClaim = new Map<string, Verdict[]>();
		for (const v of rows) {
			const group = byClaim.get(v.claimId);
			if (group) {
				group.push(v);
			} else {
				byClaim.set(v.claimId, [v]);
			}
		}
		for (const [claimId, group] of byClaim) {
			const effective = this.effectiveVerdict(group);
			if (effective) {
				latest.set(claimId, effective);
			}
		}
		return latest;
	}

	/**
	 * The effective verdict: the newest row that no correction supersedes.
	 * Superseded-by-correction is checked explicitly (not inferred from
	 * created_at) because verdicts written in quick succession — or in one
	 * transaction, where Postgres now() is identical — can tie on timestamp.
	 * Rows must arrive ordered newest-first.
	 */
	private effectiveVerdict(rows: Verdict[]): Verdict | null {
		const superseded = new Set(
			rows.map((v) => v.correctsVerdictId).filter(Boolean)
		);
		return rows.find((v) => !superseded.has(v.id)) ?? null;
	}

	private toListItem(
		claim: Claim,
		verdict: Verdict | null
	): ClaimListItemDto {
		return {
			id: claim.id,
			quarter: claim.quarter,
			rawQuote: claim.rawQuote,
			speaker: claim.speaker,
			metric: claim.metric,
			targetValue: claim.targetValue,
			targetUnit: claim.targetUnit,
			extractionConfidence: Number(claim.extractionConfidence),
			verdict: this.toVerdictDto(verdict),
		};
	}

	/** PENDING (or no verdicts row) is exposed as null (AC1). */
	private toVerdictDto(verdict: Verdict | null): ClaimVerdictDto | null {
		if (!verdict || verdict.verdictType === 'PENDING') {
			return null;
		}
		return {
			id: verdict.id,
			verdictType: verdict.verdictType,
			delta: verdict.delta,
			confidenceScore:
				verdict.confidenceScore === null
					? null
					: Number(verdict.confidenceScore),
			isCorrection: verdict.isCorrection,
			createdAt: verdict.createdAt.toISOString(),
		};
	}
}
