import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

/**
 * Claims timeline + claim detail read endpoints (story 5.5). Read-only over
 * PostgreSQL — no FastAPI calls (AC2).
 */
@Module({
	controllers: [ClaimsController],
	providers: [ClaimsService],
})
export class ClaimsModule {}
