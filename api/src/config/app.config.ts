import * as Joi from 'joi';

export const appValidationSchema = Joi.object({
	NODE_ENV: Joi.string()
		.valid('development', 'production', 'test')
		.default('development'),
	PORT: Joi.number().default(3000),
	DATABASE_URL: Joi.string().uri().required(),
	REDIS_URL: Joi.string().uri().required(),
	ML_SIDECAR_URL: Joi.string().uri().required(),
	// Shared secret for the FastAPI -> NestJS internal progress webhook (story 5.3).
	INTERNAL_WEBHOOK_SECRET: Joi.string().required(),
	LOG_LEVEL: Joi.string()
		.valid('debug', 'info', 'warn', 'error')
		.default('info'),
	THROTTLE_TTL: Joi.number().integer().positive().default(60),
	THROTTLE_LIMIT: Joi.number().integer().positive().default(10),
	CORS_ORIGIN: Joi.string().default('http://localhost:4200'),
});
