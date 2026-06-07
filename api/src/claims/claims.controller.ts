import {
	Controller,
	DefaultValuePipe,
	Get,
	Param,
	ParseIntPipe,
	ParseUUIDPipe,
	Query,
} from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { ClaimListResponseDto } from './dto/claim-list.dto';
import { ClaimDetailDto } from './dto/claim-detail.dto';
import { TickerValidationPipe } from '../common/ticker-validation.pipe';

@Controller()
export class ClaimsController {
	constructor(private readonly claimsService: ClaimsService) {}

	/**
	 * GET /api/v1/companies/:ticker/claims — paginated claims timeline
	 * (AC1, AC4). No auth / no PII (FR30, NFR15).
	 */
	@Get('companies/:ticker/claims')
	listClaims(
		@Param('ticker', TickerValidationPipe) ticker: string,
		@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number
	): Promise<ClaimListResponseDto> {
		return this.claimsService.listByTicker(ticker, page);
	}

	/**
	 * GET /api/v1/claims/:claimId — full claim detail with verdict,
	 * reasoning trace, and EDGAR source (AC2, AC3).
	 */
	@Get('claims/:claimId')
	getClaim(
		@Param('claimId', new ParseUUIDPipe()) claimId: string
	): Promise<ClaimDetailDto> {
		return this.claimsService.getDetail(claimId);
	}
}
