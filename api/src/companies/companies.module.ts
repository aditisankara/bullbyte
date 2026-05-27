import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

// DrizzleModule is @Global, so DRIZZLE is injectable without importing it here.
@Module({
	controllers: [CompaniesController],
	providers: [CompaniesService],
})
export class CompaniesModule {}
