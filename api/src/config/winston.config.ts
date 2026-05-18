import { ConfigService } from '@nestjs/config';
import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

export function createWinstonConfig(config: ConfigService): WinstonModuleOptions {
  return {
    level: config.get<string>('LOG_LEVEL', 'info'),
    defaultMeta: { service: 'api' },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),
    ],
  };
}
