import { Test } from '@nestjs/testing';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

describe('ClaimsController', () => {
	let controller: ClaimsController;
	const service = {
		listByTicker: jest.fn(),
		getDetail: jest.fn(),
	};

	beforeEach(async () => {
		jest.clearAllMocks();
		const moduleRef = await Test.createTestingModule({
			controllers: [ClaimsController],
			providers: [{ provide: ClaimsService, useValue: service }],
		}).compile();
		controller = moduleRef.get(ClaimsController);
	});

	it('delegates the claims list to the service with ticker and page', async () => {
		const envelope = {
			data: [],
			meta: { total: 0, page: 2, pageSize: 20 },
		};
		service.listByTicker.mockResolvedValue(envelope);

		await expect(controller.listClaims('TSLA', 2)).resolves.toBe(envelope);
		expect(service.listByTicker).toHaveBeenCalledWith('TSLA', 2);
	});

	it('delegates the claim detail to the service with the claimId', async () => {
		const detail = { id: 'claim-1' };
		service.getDetail.mockResolvedValue(detail);

		await expect(
			controller.getClaim('11111111-1111-1111-1111-111111111111')
		).resolves.toBe(detail);
		expect(service.getDetail).toHaveBeenCalledWith(
			'11111111-1111-1111-1111-111111111111'
		);
	});
});
