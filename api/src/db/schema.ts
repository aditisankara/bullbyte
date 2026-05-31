import {
	AnyPgColumn,
	check,
	index,
	unique,
	numeric,
	integer,
	boolean,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// #region enums
export const jobStatusEnum = pgEnum('job_status', [
	'QUEUED',
	'RUNNING',
	'COMPLETED',
	'FAILED',
]);

export const verdictTypeEnum = pgEnum('verdict_type', [
	'DELIVERED',
	'MISSED',
	'INSUFFICIENT_DATA',
	'PENDING',
	'REVISED',
]);

// #region tables
export const companies = pgTable('companies', {
	id: uuid('id').primaryKey().defaultRandom(),
	ticker: text('ticker').notNull().unique(),
	name: text('name').notNull(),
	lastAnalysedAt: timestamp('last_analysed_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;

export const analysisJobs = pgTable('analysis_jobs', {
	id: uuid('id').primaryKey().defaultRandom(),
	companyId: uuid('company_id')
		.notNull()
		.references(() => companies.id, { onDelete: 'cascade' }),
	status: jobStatusEnum('status').notNull().default('QUEUED'),
	createdAt: timestamp('created_at', { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type NewAnalysisJob = typeof analysisJobs.$inferInsert;

export const claims = pgTable(
	'claims',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		companyId: uuid('company_id')
			.notNull()
			.references(() => companies.id, { onDelete: 'cascade' }),
		quarter: text('quarter').notNull(), // "Q3-2024" format
		rawQuote: text('raw_quote').notNull(),
		metric: text('metric').notNull(),
		targetValue: text('target_value').notNull(),
		extractionConfidence: numeric('extraction_confidence', {
			precision: 4,
			scale: 3,
		}).notNull(),
		speaker: text('speaker'),
		createdAt: timestamp('created_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		index('idx_claims_company_id').on(t.companyId),
		check(
			'extraction_confidence_range',
			sql`${t.extractionConfidence} >= 0 AND ${t.extractionConfidence} <= 1`
		),
	]
);

export type Claim = typeof claims.$inferSelect;
export type NewClaim = typeof claims.$inferInsert;

export const verdicts = pgTable(
	'verdicts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		claimId: uuid('claim_id')
			.notNull()
			.references(() => claims.id, { onDelete: 'restrict' }),
		verdictType: verdictTypeEnum('verdict_type').notNull(),
		delta: text('delta'),
		confidenceScore: numeric('confidence_score', {
			precision: 4,
			scale: 3,
		}),
		isCorrection: boolean('is_correction').notNull().default(false),
		correctsVerdictId: uuid('corrects_verdict_id').references(
			(): AnyPgColumn => verdicts.id
		),
		createdAt: timestamp('created_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		check(
			'confidence_score_range',
			sql`${t.confidenceScore} IS NULL OR (${t.confidenceScore} >= 0 AND ${t.confidenceScore} <= 1)`
		),
		check(
			'no_self_correction',
			sql`${t.correctsVerdictId} IS NULL OR ${t.correctsVerdictId} != ${t.id}`
		),
	]
);

export type Verdict = typeof verdicts.$inferSelect;
export type NewVerdict = typeof verdicts.$inferInsert;

export const reasoningTraces = pgTable('reasoning_traces', {
	id: uuid('id').primaryKey().defaultRandom(),
	verdictId: uuid('verdict_id')
		.notNull()
		.references(() => verdicts.id, { onDelete: 'cascade' }),
	stepIndex: integer('step_index'),
	toolCall: jsonb('tool_call'),
	resultSummary: text('result_summary'),
	edgarFilingRef: text('edgar_filing_ref'),
	createdAt: timestamp('created_at', { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export type ReasoningTrace = typeof reasoningTraces.$inferSelect;
export type NewReasoningTrace = typeof reasoningTraces.$inferInsert;

export const toolCallLogs = pgTable('tool_call_logs', {
	id: uuid('id').primaryKey().defaultRandom(),
	jobId: uuid('job_id')
		.notNull()
		.references(() => analysisJobs.id, { onDelete: 'cascade' }),
	tool: text('tool').notNull(),
	input: jsonb('input').notNull(),
	output: jsonb('output'),
	createdAt: timestamp('created_at', { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export type ToolCallLog = typeof toolCallLogs.$inferSelect;
export type NewToolCallLog = typeof toolCallLogs.$inferInsert;

export const transcripts = pgTable(
	'transcripts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		ticker: text('ticker').notNull(),
		quarter: text('quarter').notNull(),     // "Q3-2024" format
		filingDate: text('filing_date').notNull(),
		rawText: text('raw_text').notNull(),
		filingUrl: text('filing_url').notNull(),
		parseStatus: text('parse_status').notNull(),  // "SUCCESS" or "PRESS_RELEASE" when cached
		ingestedAt: timestamp('ingested_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		unique('transcripts_ticker_quarter_unique').on(t.ticker, t.quarter),
		index('idx_transcripts_ticker').on(t.ticker),
	]
);

export type Transcript = typeof transcripts.$inferSelect;
export type NewTranscript = typeof transcripts.$inferInsert;

export const financialActuals = pgTable(
	'financial_actuals',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		ticker: text('ticker').notNull(),
		quarter: text('quarter').notNull(),     // "Q3-2024" format
		filingType: text('filing_type').notNull(),  // "10-Q" or "10-K"
		status: text('status').notNull(),       // "SUCCESS" or "PARTIAL" when cached
		filingUrl: text('filing_url').notNull(),
		metrics: jsonb('metrics').notNull(),    // serialised list[FinancialMetric]
		ingestedAt: timestamp('ingested_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		unique('financial_actuals_ticker_quarter_unique').on(t.ticker, t.quarter),
		index('idx_financial_actuals_ticker').on(t.ticker),
	]
);

export type FinancialActuals = typeof financialActuals.$inferSelect;
export type NewFinancialActuals = typeof financialActuals.$inferInsert;

export const executives = pgTable(
	'executives',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		personName: text('person_name').notNull(),
		companyId: uuid('company_id')
			.notNull()
			.references(() => companies.id, { onDelete: 'cascade' }),
		role: text('role').notNull(),
		startDate: text('start_date').notNull(),
		endDate: text('end_date'),
		createdAt: timestamp('created_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		index('idx_executives_company_role').on(t.companyId, t.role),
		index('idx_executives_person_name').on(t.personName),
	]
);

export type Executive = typeof executives.$inferSelect;
export type NewExecutive = typeof executives.$inferInsert;
