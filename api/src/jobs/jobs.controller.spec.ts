import { HttpStatus } from '@nestjs/common';
import { JobsController } from './jobs.controller';

describe('JobsController', () => {
	let controller: JobsController;
	let jobsService: { requestAnalysis: jest.Mock };
	let res: { status: jest.Mock };

	beforeEach(() => {
		jobsService = { requestAnalysis: jest.fn() };
		res = { status: jest.fn() };
		controller = new JobsController(jobsService as any);
	});

	it('delegates to JobsService and returns 202 ACCEPTED for a new job (AC1)', async () => {
		jobsService.requestAnalysis.mockResolvedValue({
			jobId: 'job-1',
			status: 'QUEUED',
		});

		const result = await controller.analyze('TSLA', res as any);

		expect(jobsService.requestAnalysis).toHaveBeenCalledWith('TSLA');
		expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
		expect(result).toEqual({ jobId: 'job-1', status: 'QUEUED' });
	});

	it('returns 200 OK for a cache hit (AC3)', async () => {
		jobsService.requestAnalysis.mockResolvedValue({
			jobId: null,
			status: 'COMPLETED',
			cached: true,
		});

		const result = await controller.analyze('TSLA', res as any);

		expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
		expect(result).toEqual({
			jobId: null,
			status: 'COMPLETED',
			cached: true,
		});
	});
});
