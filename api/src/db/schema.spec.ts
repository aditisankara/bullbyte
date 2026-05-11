import { getTableName } from 'drizzle-orm';
import {
	companies,
	analysisJobs,
	claims,
	verdicts,
	reasoningTraces,
	toolCallLogs,
	jobStatusEnum,
	verdictTypeEnum,
} from './schema';

describe('db/schema — table definitions', () => {
	it('exports all six tables with correct SQL table names', () => {
		expect(getTableName(companies)).toBe('companies');
		expect(getTableName(analysisJobs)).toBe('analysis_jobs');
		expect(getTableName(claims)).toBe('claims');
		expect(getTableName(verdicts)).toBe('verdicts');
		expect(getTableName(reasoningTraces)).toBe('reasoning_traces');
		expect(getTableName(toolCallLogs)).toBe('tool_call_logs');
	});

	it('exports both enum definitions', () => {
		expect(jobStatusEnum).toBeDefined();
		expect(verdictTypeEnum).toBeDefined();
	});
});

describe('db/schema — verdicts immutability (NFR7)', () => {
	it('has no updated_at column — append-only model enforced at schema level', () => {
		const columnKeys = Object.keys(verdicts);
		expect(columnKeys).not.toContain('updatedAt');
		expect(columnKeys).not.toContain('updated_at');
	});

	it('has is_correction and corrects_verdict_id for correction tracking', () => {
		expect(verdicts.isCorrection).toBeDefined();
		expect(verdicts.correctsVerdictId).toBeDefined();
	});

	it('has created_at column', () => {
		expect(verdicts.createdAt).toBeDefined();
	});
});

describe('db/schema — claims table', () => {
	it('stores quarter as text', () => {
		expect(claims.quarter.columnType).toBe('PgText');
	});

	it('stores extraction_confidence as numeric', () => {
		expect(claims.extractionConfidence.columnType).toBe('PgNumeric');
	});

	it('has created_at column', () => {
		expect(claims.createdAt).toBeDefined();
	});
});

describe('db/schema — created_at on every table', () => {
	it.each([
		['companies', companies],
		['analysis_jobs', analysisJobs],
		['claims', claims],
		['verdicts', verdicts],
		['reasoning_traces', reasoningTraces],
		['tool_call_logs', toolCallLogs],
	] as const)('%s has a createdAt column', (_name, table) => {
		expect('createdAt' in table).toBe(true);
	});
});

describe('db/schema — reasoning_traces column names', () => {
	it('uses snake_case verdict_id (not camelCase verdictId) as DB column name', () => {
		expect(reasoningTraces.verdictId.name).toBe('verdict_id');
	});

	it('stores created_at as a timestamp (not text)', () => {
		expect(reasoningTraces.createdAt.columnType).toBe('PgTimestamp');
	});
});
