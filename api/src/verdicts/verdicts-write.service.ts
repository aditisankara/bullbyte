import {
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.module';
import type { DrizzleDB } from '../db/drizzle.module';
import { claims, verdicts } from '../db/schema';
import type { Verdict } from '../db/schema';

export interface VerdictWriteInput {
	claimId: string;
	verdictType: Verdict['verdictType'];
	delta?: string | null;
	confidenceScore?: string | null; // numeric(4,3) — Drizzle represents as string
	/**
	 * Optimistic-concurrency guard for corrections: when set, the write only
	 * succeeds if this is still the claim's latest verdict id; otherwise a 409
	 * STALE_VERDICT_CORRECTION is thrown. Also rejects (by construction) any
	 * attempt to correct a verdict belonging to a different claim — the
	 * expected id can never match the latest verdict of the wrong claim.
	 */
	expectedCorrectsVerdictId?: string;
}

@Injectable()
export class VerdictsWriteService {
	constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

	/**
	 * The only sanctioned verdict write path at the API layer (FR45, NFR7).
	 *
	 * Insert-only: an existing verdicts row is never UPDATEd or DELETEd — its
	 * created_at and verdict_type are immutable (AC2). If the claim already
	 * has a verdict, the new row is automatically written as a correction:
	 * is_correction: true with corrects_verdict_id pointing at the verdict it
	 * supersedes (correcting a correction chains to the latest, preserving
	 * full lineage back to the original).
	 *
	 * Concurrency (NFR11/AC3): the claims row is locked FOR UPDATE for the
	 * duration of the transaction, serialising concurrent writers per claim —
	 * of two concurrent first-writes, exactly one inserts the non-correction
	 * row and the other lands as a correction of it. Duplicate non-correction
	 * records cannot be created.
	 */
	async write(input: VerdictWriteInput): Promise<Verdict> {
		return this.db.transaction(async (tx) => {
			const [claim] = await tx
				.select({ id: claims.id })
				.from(claims)
				.where(eq(claims.id, input.claimId))
				.for('update');

			if (!claim) {
				// AllExceptionsFilter maps code/details into the canonical error shape.
				throw new NotFoundException({
					code: 'CLAIM_NOT_FOUND',
					details: { claimId: input.claimId },
				});
			}

			// Effective verdict = latest row; corrections win created_at ties
			// (same rule as the 5.5/5.6 read paths).
			const [latest] = await tx
				.select({ id: verdicts.id })
				.from(verdicts)
				.where(eq(verdicts.claimId, input.claimId))
				.orderBy(desc(verdicts.createdAt), desc(verdicts.isCorrection))
				.limit(1);

			if (
				input.expectedCorrectsVerdictId !== undefined &&
				input.expectedCorrectsVerdictId !== latest?.id
			) {
				throw new ConflictException({
					code: 'STALE_VERDICT_CORRECTION',
					details: {
						claimId: input.claimId,
						expectedCorrectsVerdictId:
							input.expectedCorrectsVerdictId,
						latestVerdictId: latest?.id ?? null,
					},
				});
			}

			const [inserted] = await tx
				.insert(verdicts)
				.values({
					claimId: input.claimId,
					verdictType: input.verdictType,
					delta: input.delta ?? null,
					confidenceScore: input.confidenceScore ?? null,
					isCorrection: latest !== undefined,
					correctsVerdictId: latest?.id ?? null,
				})
				.returning();

			return inserted;
		});
	}
}
