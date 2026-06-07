import { Controller, Get, Param } from '@nestjs/common';
import { ScoreService } from './score.service';
import { CeoScoreDto } from './dto/ceo-score.dto';
import { TickerValidationPipe } from '../common/ticker-validation.pipe';

@Controller('companies')
export class ScoreController {
	constructor(private readonly scoreService: ScoreService) {}

	/**
	 * GET /api/v1/companies/:ticker/score — CEO Delivery Score with
	 * sample-size context (AC1/AC4). No auth / no PII (FR30, NFR15).
	 */
	@Get(':ticker/score')
	getScore(
		@Param('ticker', TickerValidationPipe) ticker: string
	): Promise<CeoScoreDto> {
		return this.scoreService.getScore(ticker);
	}
}
