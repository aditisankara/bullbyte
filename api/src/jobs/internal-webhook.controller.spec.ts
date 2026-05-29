import { BadRequestException } from '@nestjs/common';
import { InternalWebhookController } from './internal-webhook.controller';
import { ProgressWebhookDto } from './dto/progress-webhook.dto';

function makeDto(jobId = 'job-1'): ProgressWebhookDto {
	return {
		event: 'claims-extracted',
		jobId,
		stepIndex: 2,
		totalSteps: 5,
		message: 'Extracted 7 claims',
		timestamp: '2026-05-29T00:00:00.000Z',
	};
}

describe('InternalWebhookController', () => {
	let controller: InternalWebhookController;
	let progress: { publish: jest.Mock };
	let logger: { log: jest.Mock };

	beforeEach(() => {
		progress = { publish: jest.fn() };
		logger = { log: jest.fn() };
		controller = new InternalWebhookController(
			progress as any,
			logger as any
		);
	});

	it('relays the payload verbatim to ProgressService (AC2)', () => {
		const dto = makeDto('job-1');

		controller.relay('job-1', dto);

		expect(progress.publish).toHaveBeenCalledTimes(1);
		expect(progress.publish).toHaveBeenCalledWith(dto);
	});

	it('emits a structured log with jobId, event, stepIndex, timestamp (AC2)', () => {
		const dto = makeDto('job-1');

		controller.relay('job-1', dto);

		expect(logger.log).toHaveBeenCalledWith(
			'Progress webhook relayed',
			expect.objectContaining({
				service: 'api',
				jobId: 'job-1',
				event: 'claims-extracted',
				stepIndex: 2,
				timestamp: '2026-05-29T00:00:00.000Z',
			})
		);
	});

	it('rejects a path/body jobId mismatch and does not publish', () => {
		const dto = makeDto('body-job');

		expect(() => controller.relay('path-job', dto)).toThrow(
			BadRequestException
		);
		expect(progress.publish).not.toHaveBeenCalled();
	});
});
