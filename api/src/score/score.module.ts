import { Module } from '@nestjs/common';
import { ScoreController } from './score.controller';
import { ScoreService } from './score.service';

// DrizzleModule is @Global, so DRIZZLE is injectable without importing it here.
@Module({
	controllers: [ScoreController],
	providers: [ScoreService],
})
export class ScoreModule {}
