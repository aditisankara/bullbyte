import { CompaniesController } from './companies.controller';
import { CompanySummaryDto } from './dto/company-summary.dto';

describe('CompaniesController', () => {
	let controller: CompaniesController;
	let companiesService: { getSummary: jest.Mock };

	beforeEach(() => {
		companiesService = { getSummary: jest.fn() };
		controller = new CompaniesController(companiesService as any);
	});

	it('delegates to CompaniesService.getSummary and returns the summary (AC1)', async () => {
		const summary: CompanySummaryDto = {
			id: 'company-1',
			ticker: 'TSLA',
			name: 'Tesla, Inc.',
			lastAnalysedAt: '2026-05-01T12:00:00.000Z',
			jobStatus: 'COMPLETED',
			latestJobId: 'job-1',
		};
		companiesService.getSummary.mockResolvedValue(summary);

		const result = await controller.getCompany('TSLA');

		expect(companiesService.getSummary).toHaveBeenCalledWith('TSLA');
		expect(result).toBe(summary);
	});
});
