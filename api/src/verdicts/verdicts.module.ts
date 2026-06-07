import { Module } from '@nestjs/common';
import { VerdictsWriteService } from './verdicts-write.service';

// No controller: epics define no correction endpoint. This module exports the
// service-layer write path that future correction flows must go through (FR45).
// DrizzleModule is @Global, so DRIZZLE is injectable without importing it here.
@Module({
	providers: [VerdictsWriteService],
	exports: [VerdictsWriteService],
})
export class VerdictsModule {}
