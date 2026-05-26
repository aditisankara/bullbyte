import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { JobsController } from './jobs.controller';
import { ANALYSIS_QUEUE, JobsService } from './jobs.service';
import { AnalysisProcessor } from './analysis.processor';
import { MlSidecarService } from '../common/ml-sidecar.service';

@Module({
	imports: [
		BullModule.registerQueue({ name: ANALYSIS_QUEUE }),
		// MlSidecarService depends on HttpService. Provided locally for this scaffold.
		// Preferred consolidation (do this when 5.2/5.3 also need shared providers):
		// extract a CommonModule that provides + exports MlSidecarService and import
		// it from both AppModule and JobsModule. See the 5.1 story Dev Notes.
		HttpModule,
	],
	controllers: [JobsController],
	providers: [JobsService, AnalysisProcessor, MlSidecarService],
})
export class JobsModule {}
