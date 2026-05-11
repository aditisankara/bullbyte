import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
	constructor(private readonly appService: AppService) {}

	@Get()
	getHello(): string {
		return this.appService.getHello();
	}

	// Temporary stub — replaced by dedicated HealthModule in Story 1.4
	@Get('health')
	health(): { status: string; service: string } {
		return { status: 'ok', service: 'api' };
	}
}
