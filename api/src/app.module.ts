import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { HttpModule } from '@nestjs/axios';
import { WinstonModule } from 'nest-winston';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from './db/drizzle.module';
import { appValidationSchema } from './config/app.config';
import { createWinstonConfig } from './config/winston.config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { CustomThrottlerGuard } from './common/guards/throttler.guard';
import { MlSidecarService } from './common/ml-sidecar.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: appValidationSchema }),
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createWinstonConfig,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>('THROTTLE_TTL') * 1000,
          limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
        },
      ],
    }),
    HttpModule,
    DrizzleModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    MlSidecarService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD, useClass: CustomThrottlerGuard },
  ],
  exports: [MlSidecarService],
})
export class AppModule {}
