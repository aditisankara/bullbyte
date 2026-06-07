import { ScoreController } from './score.controller';
import { CeoScoreDto } from './dto/ceo-score.dto';

describe('ScoreController', () => {
	let controller: ScoreController;
	let scoreService: { getScore: jest.Mock };

	beforeEach(() => {
		scoreService = { getScore: jest.fn() };
		controller = new ScoreController(scoreService as any);
	});

	it('delegates to ScoreService.getScore and returns the score payload (AC1)', async () => {
		const payload: CeoScoreDto = {
			ticker: 'TSLA',
			score: 0.75,
			deliveredCount: 3,
			missedCount: 1,
			totalResolved: 4,
			pendingCount: 2,
			insufficientDataCount: 1,
			context:
				'3 of 4 resolved promises delivered — 2 pending — 1 insufficient data',
		};
		scoreService.getScore.mockResolvedValue(payload);

		const result = await controller.getScore('TSLA');

		expect(scoreService.getScore).toHaveBeenCalledWith('TSLA');
		expect(result).toBe(payload);
	});
});
