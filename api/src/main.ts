import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create(AppModule, { bufferLogs: true });
	app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
	app.use(helmet());
	const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:4200')
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);
	app.enableCors({ origin: corsOrigins });
	app.setGlobalPrefix('api/v1');
	app.useGlobalPipes(
		new ValidationPipe({ whitelist: true, transform: true })
	);
	await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
