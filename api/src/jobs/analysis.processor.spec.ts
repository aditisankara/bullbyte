import { of, throwError } from 'rxjs';
import type { Job } from 'bullmq';
import { AnalysisProcessor } from './analysis.processor';
import type { AnalysisJobData } from './jobs.service';

describe('AnalysisProcessor', () => {
	let processor: AnalysisProcessor;
	let jobsService: { markRunning: jest.Mock; markFailed: jest.Mock };
	let mlSidecar: { analyze: jest.Mock };
	let logger: { error: jest.Mock };

	const job = {
		data: { jobId: 'job-1', ticker: 'TSLA' },
	} as Job<AnalysisJobData>;

	beforeEach(() => {
		jobsService = {
			markRunning: jest.fn().mockResolvedValue(undefined),
			markFailed: jest.fn().mockResolvedValue(undefined),
		};
		mlSidecar = { analyze: jest.fn() };
		logger = { error: jest.fn() };
		processor = new AnalysisProcessor(
			jobsService as any,
			mlSidecar as any,
			logger as any
		);
	});

	it('marks RUNNING and dispatches to the sidecar, leaving the job RUNNING (AC2)', async () => {
		mlSidecar.analyze.mockReturnValue(
			of({ data: { jobId: 'stub', status: 'QUEUED' } })
		);

		await processor.process(job);

		expect(jobsService.markRunning).toHaveBeenCalledWith('job-1');
		expect(mlSidecar.analyze).toHaveBeenCalledWith('TSLA');
		// COMPLETED is owned by the 5.3 webhook, never set here.
		expect(jobsService.markFailed).not.toHaveBeenCalled();
	});

	it('marks FAILED, logs structured error, and rethrows when the sidecar errors (AC4)', async () => {
		mlSidecar.analyze.mockReturnValue(
			throwError(() => new Error('sidecar down'))
		);

		await expect(processor.process(job)).rejects.toThrow('sidecar down');

		expect(jobsService.markFailed).toHaveBeenCalledWith('job-1');
		expect(logger.error).toHaveBeenCalledWith(
			'Analysis job failed',
			expect.objectContaining({
				service: 'api',
				jobId: 'job-1',
				ticker: 'TSLA',
				error: 'sidecar down',
			})
		);
	});
});
