# Story 1.4: NestJS API Scaffold & Core Infrastructure

Status: done

## Story

As a **developer**,
I want the NestJS API scaffolded with config management, structured logging, global exception handling, rate limiting, and the MlSidecarService integration point,
So that the API has a production-ready core ready to accept feature modules with no architectural setup remaining.

## Acceptance Criteria

1. **Given** the api service is running
   **When** `GET /api/v1/health` is called
   **Then** the response is `{ "status": "ok", "service": "api" }` with HTTP 200

2. **Given** `api/src/common/ml-sidecar.service.ts`
   **When** a developer searches the entire NestJS codebase for the ML sidecar URL
   **Then** it appears only in `MlSidecarService` — no other module calls FastAPI directly
   **And** the sidecar URL is read from `ML_SIDECAR_URL` via `@nestjs/config`
   **And** `@nestjs/axios` is used as the HTTP client

3. **Given** any unhandled exception
   **When** `AllExceptionsFilter` catches it
   **Then** the response shape is `{ "statusCode": N, "error": "...", "code": "...", "details": {} }`
   **And** no internal stack trace or raw FastAPI error is included in any response

4. **Given** a client exceeds `THROTTLE_LIMIT` requests within `THROTTLE_TTL` seconds on a protected endpoint
   **When** `@nestjs/throttler` triggers
   **Then** the response is HTTP 429 with the standard error shape

5. **Given** any request is processed
   **When** the logging interceptor runs
   **Then** a structured JSON log entry is emitted with `level`, `message`, `service: "api"`, `timestamp`, request method, and path
   **And** no `console.log` calls exist anywhere in the NestJS codebase

6. **Given** the api service starts with a missing required environment variable
   **When** `@nestjs/config` schema validation runs
   **Then** the application fails to start immediately with a clear, human-readable error naming the missing variable

## Tasks / Subtasks

- [x] Task 1: Install new dependencies (AC: 2, 4, 5, 6)
  - [x] Add to `api/package.json` dependencies: `@nestjs/config`, `@nestjs/throttler`, `@nestjs/axios`, `axios`, `winston`, `nest-winston`, `joi`, `helmet`, `class-validator`, `class-transformer`
  - [x] Run `npm install` in `api/`
  - [x] Verify `npm run build` still succeeds after install

- [x] Task 2: Config management with environment validation (AC: 6)
  - [x] Create `api/src/config/app.config.ts` — Joi schema validating all required env vars (see Dev Notes for required vars and schema)
  - [x] Add `ConfigModule.forRoot({ isGlobal: true, validationSchema: appValidationSchema })` to `AppModule` imports — must be first import
  - [x] Remove `api/src/config/database.config.ts` dead code (created in 1.2 but never wired; `drizzle.module.ts` reads `process.env.DATABASE_URL` directly — keep that pattern, just delete the dead file)

- [x] Task 3: Winston structured logging (AC: 5)
  - [x] Create `api/src/config/winston.config.ts` — exports `winstonConfig` using `nest-winston` transport with `defaultMeta: { service: 'api' }`, JSON format + timestamp, log level from `LOG_LEVEL` env var
  - [x] Add `WinstonModule.forRoot(winstonConfig)` to `AppModule` imports
  - [x] Update `api/src/main.ts`: add `bufferLogs: true` to `NestFactory.create()` options and `app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER))` after creation

- [x] Task 4: Global exception filter (AC: 3, 4)
  - [x] Create `api/src/common/filters/all-exceptions.filter.ts` — `AllExceptionsFilter implements ExceptionFilter` (see Dev Notes for exact response shape and ThrottlerException mapping)
  - [x] Register as global filter in `main.ts`: `app.useGlobalFilters(new AllExceptionsFilter())`
  - [x] IMPORTANT: filter must catch `ThrottlerException` and return 429 with `code: "RATE_LIMIT_EXCEEDED"` using the same standard shape

- [x] Task 5: Global logging interceptor (AC: 5)
  - [x] Create `api/src/common/interceptors/logging.interceptor.ts` — `LoggingInterceptor implements NestInterceptor`; injects `WINSTON_MODULE_PROVIDER`; logs `{ message: 'request', method, path }` on each request; no `console.log` anywhere
  - [x] Register as global interceptor in `AppModule` providers: `{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }`
  - [x] Audit entire `api/src/` for any `console.log` — remove all

- [x] Task 6: Rate limiting (AC: 4)
  - [x] Add `ThrottlerModule.forRootAsync(...)` to `AppModule` imports — reads `THROTTLE_TTL` (seconds, convert to ms) and `THROTTLE_LIMIT` from `ConfigService` (see Dev Notes for exact config)
  - [x] Create `api/src/common/guards/throttler.guard.ts` — extends `ThrottlerGuard`, overrides `throwThrottlingException()` to throw an `HttpException` with standard shape `{ statusCode: 429, error: "TOO_MANY_REQUESTS", code: "RATE_LIMIT_EXCEEDED", details: {} }`
  - [x] Register throttle guard globally in `AppModule` providers: `{ provide: APP_GUARD, useClass: CustomThrottlerGuard }`
  - [x] Add `@SkipThrottle()` to the health endpoint in `AppController` (health checks must never be rate-limited)

- [x] Task 7: MlSidecarService (AC: 2)
  - [x] Add `HttpModule` from `@nestjs/axios` to `AppModule` imports
  - [x] Create `api/src/common/ml-sidecar.service.ts` — `@Injectable() MlSidecarService`; injects `HttpService` and `ConfigService`; reads `ML_SIDECAR_URL` from config in constructor; exposes `getHealth(): Observable<AxiosResponse>` as the initial method stub for sidecar connectivity checks (see Dev Notes)
  - [x] Add `MlSidecarService` to `AppModule` providers and exports
  - [x] CRITICAL: `ML_SIDECAR_URL` must appear ONLY in `ml-sidecar.service.ts` — never in any other file

- [x] Task 8: Update `main.ts` (AC: 1, 3, 4, 5)
  - [x] Add `helmet()` middleware: `app.use(helmet())`
  - [x] Add CORS: `app.enableCors({ origin: [process.env.CORS_ORIGIN ?? 'http://localhost:4200'] })`
  - [x] Add `ValidationPipe` globally: `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))` — needed by future DTO stories
  - [x] Verify `app.setGlobalPrefix('api/v1')` remains (already present)
  - [x] Verify health endpoint still reachable at `GET /api/v1/health`

- [x] Task 9: Tests (AC: 1–6)
  - [x] Create `api/src/common/filters/all-exceptions.filter.spec.ts` — unit tests: HttpException shape, generic Error shape, ThrottlerException → 429, no stack trace exposed
  - [x] Create `api/src/common/interceptors/logging.interceptor.spec.ts` — unit tests: mock ExecutionContext + CallHandler, verify logger called with correct fields (`method`, `path`, `service`)
  - [x] Create `api/src/common/ml-sidecar.service.spec.ts` — unit tests: mock HttpService + ConfigService, verify `ML_SIDECAR_URL` read from config, verify HttpService.get called with correct URL
  - [x] Create `api/src/common/guards/throttler.guard.spec.ts` — unit tests: verify `throwThrottlingException()` returns standard 429 shape
  - [x] Ensure `app.controller.spec.ts` still passes (regression — health + getHello tests must remain green)
  - [x] Ensure `db/schema.spec.ts` still passes (regression)
  - [x] Run `npm test` and confirm all tests pass with 0 failures

### Review Follow-ups (AI)

- [x] [Review][Patch] LoggingInterceptor: add tap() to log response/error phase — resolved decision: tap next.handle() to emit completion log with method+path+status; error responses currently have no interceptor log with request context. [api/src/common/interceptors/logging.interceptor.ts]
- [x] [Review][Patch] CORS_ORIGIN: parse comma-separated values — resolved decision: split on comma in main.ts before passing to enableCors; update Joi schema to reflect multi-origin support. [api/src/main.ts, api/src/config/app.config.ts]
- [x] [Review][Patch] AllExceptionsFilter instantiated via `new` outside DI — `app.useGlobalFilters(new AllExceptionsFilter())` bypasses NestJS DI; if filter gains injected dependencies (e.g. Winston) they will be undefined. Use `APP_FILTER` provider in AppModule instead. [api/src/main.ts, api/src/common/filters/all-exceptions.filter.ts]
- [x] [Review][Patch] AllExceptionsFilter missing `headersSent` guard — if response headers are already sent (SSE, streaming), calling `response.status(500).json()` throws "Cannot set headers after they are sent", crashing the exception handler itself. [api/src/common/filters/all-exceptions.filter.ts]
- [x] [Review][Patch] MlSidecarService returns raw Observable with no timeout or error mapping — `httpService.get()` with no `timeout()` or `catchError()` operator will hang indefinitely on a slow/dead sidecar and surface unformatted Axios errors through the generic filter. [api/src/common/ml-sidecar.service.ts]
- [x] [Review][Patch] ThrottlerModule uses `config.get()!` instead of `config.getOrThrow()` — non-null assertion on a potentially-undefined value produces `NaN * 1000 = NaN`, silently disabling throttling rather than failing at startup. [api/src/app.module.ts]
- [x] [Review][Patch] Winston config reads `process.env.LOG_LEVEL` at import time before ConfigModule — `winstonConfig` is a plain object constant evaluated at module-load time; Joi-validated `LOG_LEVEL` is never used; missing var silently falls back to 'info' instead of failing fast. [api/src/config/winston.config.ts]
- [x] [Review][Patch] LoggingInterceptor logs raw `path` without sanitization — URL path from HTTP request passes verbatim into structured log; newlines/control characters in path could corrupt log output (log injection). [api/src/common/interceptors/logging.interceptor.ts]

## Dev Notes

### Current API State (what exists from Stories 1.1 + 1.2)

- `api/src/main.ts` — minimal: `NestFactory.create(AppModule)`, `setGlobalPrefix('api/v1')`, listen on port 3000. No config, no filters, no interceptors, no middleware.
- `api/src/app.module.ts` — imports only `DrizzleModule`
- `api/src/app.controller.ts` — has `@Get() getHello()` + `@Get('health') health()` returning `{status:'ok',service:'api'}`. Comment says "replaced by HealthModule in 1.4" — the health method STAYS but the comment should be removed. Do NOT move health to a new module.
- `api/src/app.service.ts` — just `getHello(): string`. Keep as-is.
- `api/src/db/drizzle.module.ts` — `@Global()` module; provides `DRIZZLE` (DrizzleDB) and `DB_POOL` (pg.Pool); runs migrations on startup; exports `DRIZZLE` only
- `api/src/db/schema.ts` — 6 tables fully defined; exports typed row types
- `api/package.json` — has: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `drizzle-orm`, `pg`, `reflect-metadata`, `rxjs`. Missing all new packages.
- `api/src/config/database.config.ts` — does NOT exist in filesystem (listed in 1.2 file list but never created or deleted). Nothing to clean up.
- No `src/common/` directory — create it entirely in this story.

### Required Environment Variables — Joi Validation Schema

```typescript
// api/src/config/app.config.ts
import * as Joi from 'joi';

export const appValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),
  ML_SIDECAR_URL: Joi.string().uri().required(),
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').default('info'),
  THROTTLE_TTL: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(10),
  CORS_ORIGIN: Joi.string().default('http://localhost:4200'),
});
```

`ConfigModule.forRoot({ isGlobal: true, validationSchema: appValidationSchema })` — validation happens at bootstrap, process exits immediately with a human-readable error naming the missing field.

### AllExceptionsFilter — Exact Shape

```typescript
// api/src/common/filters/all-exceptions.filter.ts
// Response shape for ALL errors:
// { "statusCode": N, "error": "SCREAMING_SNAKE", "code": "SCREAMING_SNAKE", "details": {} }

// HttpException (including ThrottlerException):
//   statusCode = exception.getStatus()
//   response = exception.getResponse() as object or string
//   error = httpStatusToError(statusCode)  // e.g. 404 → "NOT_FOUND", 429 → "TOO_MANY_REQUESTS"
//   code = response.code ?? httpStatusToError(statusCode)
//   details = response.details ?? {}

// Generic Error (non-HttpException):
//   statusCode = 500
//   error = "INTERNAL_SERVER_ERROR"
//   code = "INTERNAL_SERVER_ERROR"
//   details = {}  // NEVER expose error.message or stack to client
//   Log the full error server-side at 'error' level

// HTTP status → error string mapping (implement as helper function):
// 400 → "BAD_REQUEST", 401 → "UNAUTHORIZED", 403 → "FORBIDDEN"
// 404 → "NOT_FOUND", 409 → "CONFLICT", 422 → "UNPROCESSABLE_ENTITY"
// 429 → "TOO_MANY_REQUESTS", 500 → "INTERNAL_SERVER_ERROR"
// Default → "UNKNOWN_ERROR"
```

The filter must inject a logger (use `Logger` from `@nestjs/common` within the filter — it will automatically use Winston). For unit tests, mock the logger.

### Winston Config

```typescript
// api/src/config/winston.config.ts
import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

export const winstonConfig: WinstonModuleOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
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
```

`defaultMeta: { service: 'api' }` ensures every log line has `service: "api"` automatically — no need to add it manually in each log call.

### LoggingInterceptor — Key Requirement

```typescript
// api/src/common/interceptors/logging.interceptor.ts
// Inject: @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: winston.Logger
// Log shape per request: { message: 'request', method: 'GET', path: '/api/v1/health' }
// Winston adds: level, timestamp, service (from defaultMeta) automatically
// Use logger.info({ message, method, path }) — NOT console.log
// Return next.handle() — do not tap or transform the response
```

### ThrottlerModule Config

```typescript
// In app.module.ts imports:
ThrottlerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => [
    {
      ttl: config.get<number>('THROTTLE_TTL') * 1000, // convert seconds to ms
      limit: config.get<number>('THROTTLE_LIMIT'),
    },
  ],
}),
```

### MlSidecarService — Exact Boundary Contract

```typescript
// api/src/common/ml-sidecar.service.ts
// This is the ONLY file in the NestJS codebase that may contain:
// - ML_SIDECAR_URL env var reference
// - httpService calls to the FastAPI sidecar
// - Any direct sidecar URL string

@Injectable()
export class MlSidecarService {
  private readonly baseUrl: string;
  
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.getOrThrow<string>('ML_SIDECAR_URL');
  }
  
  getHealth(): Observable<AxiosResponse<{ status: string; service: string }>> {
    return this.httpService.get(`${this.baseUrl}/health`);
  }
  // Future methods added in Epic 5 stories — do not add more now
}
```

Use `configService.getOrThrow()` so missing `ML_SIDECAR_URL` surfaces clearly.

### AppModule Final Structure

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: appValidationSchema }), // FIRST
    WinstonModule.forRoot(winstonConfig),
    ThrottlerModule.forRootAsync({ ... }),
    HttpModule,  // from @nestjs/axios — provides HttpService for MlSidecarService
    DrizzleModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    MlSidecarService,
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD, useClass: CustomThrottlerGuard },
  ],
  exports: [MlSidecarService],
})
export class AppModule {}
```

### main.ts Final Shape

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.use(helmet());
  app.enableCors({ origin: [process.env.CORS_ORIGIN ?? 'http://localhost:4200'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
```

`setGlobalPrefix` must come BEFORE the app starts listening. Order: useLogger → middleware → prefix → filters → pipes → listen.

### Regression Protection

- `app.controller.spec.ts` creates `AppController` + `AppService` in isolation — it does NOT import `AppModule`. Adding new providers to `AppModule` will NOT break it. The test must pass as-is.
- `db/schema.spec.ts` validates schema shape — no changes to schema in this story, test must pass unchanged.
- Run full test suite before marking any task complete: `cd api && npm test`

### Package Versions (NestJS 11 compatible)

- `@nestjs/config`: ^4.0.0
- `@nestjs/throttler`: ^6.0.0
- `@nestjs/axios`: ^4.0.0
- `axios`: ^1.7.0
- `winston`: ^3.17.0
- `nest-winston`: ^1.10.0
- `joi`: ^17.13.0
- `helmet`: ^8.0.0
- `class-validator`: ^0.14.0
- `class-transformer`: ^0.5.1

Install command: `npm install @nestjs/config @nestjs/throttler @nestjs/axios axios winston nest-winston joi helmet class-validator class-transformer`

### Project Structure Notes

New files created by this story (all within `api/src/`):

```
api/src/
├── config/
│   ├── app.config.ts          ← NEW — Joi validation schema
│   └── winston.config.ts      ← NEW — Winston transport config
└── common/
    ├── filters/
    │   └── all-exceptions.filter.ts    ← NEW
    ├── interceptors/
    │   └── logging.interceptor.ts      ← NEW
    ├── guards/
    │   └── throttler.guard.ts          ← NEW (CustomThrottlerGuard)
    └── ml-sidecar.service.ts           ← NEW
```

Existing files updated: `api/src/main.ts`, `api/src/app.module.ts`, `api/src/app.controller.ts` (remove stub comment + add @SkipThrottle), `api/package.json`.

### Architecture Anti-Patterns to Avoid

- `console.log` anywhere in NestJS — use `Logger` from `@nestjs/common` or injected Winston
- Exposing stack traces in HTTP responses — internal 5xx logs to Winston, client gets generic message
- Any NestJS module other than `MlSidecarService` reading `ML_SIDECAR_URL` or calling FastAPI
- Skipping `bufferLogs: true` — without it, early bootstrap logs bypass Winston
- THROTTLE_TTL in wrong unit — `@nestjs/throttler` v6+ uses milliseconds, multiply env var (seconds) by 1000
- Using `configService.get()` without fallback for required vars — use `getOrThrow()` in MlSidecarService

### References

- [Architecture: API Patterns](../_bmad-output/planning-artifacts/architecture.md#api--communication-patterns)
- [Architecture: NestJS Module Layout](../_bmad-output/planning-artifacts/architecture.md#structure-patterns)
- [Architecture: Logging](../_bmad-output/planning-artifacts/architecture.md#infrastructure--deployment)
- [Architecture: Security](../_bmad-output/planning-artifacts/architecture.md#authentication--security)
- [Epics: Story 1.4 AC](../_bmad-output/planning-artifacts/epics.md#story-14-nestjs-api-scaffold--core-infrastructure)
- [Story 1.2: DrizzleModule](./1-2-postgresql-schema-and-drizzle-migration-infrastructure.md) — `DRIZZLE` token export pattern
- [Story 1.3: FastAPI logging pattern](./1-3-fastapi-ml-sidecar-scaffold.md) — structured logging reference

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented all 9 tasks for NestJS API scaffold with production-ready core infrastructure
- `app.config.ts`: Joi validation schema for all required env vars (DATABASE_URL, REDIS_URL, ML_SIDECAR_URL required; others have defaults)
- `winston.config.ts`: JSON + timestamp format, `service: 'api'` defaultMeta, log level from LOG_LEVEL env var
- `all-exceptions.filter.ts`: Catches HttpException (including 429 throttle) and generic errors; never exposes stack traces to clients
- `logging.interceptor.ts`: Injects WINSTON_MODULE_PROVIDER, logs `{ message, method, path }` per request
- `throttler.guard.ts`: CustomThrottlerGuard extends ThrottlerGuard, throws HttpException with standard 429 shape
- `ml-sidecar.service.ts`: ML_SIDECAR_URL appears ONLY here; uses getOrThrow() + HttpService.get()
- `app.module.ts`: ConfigModule first, then Winston, Throttler, Http, Drizzle; APP_INTERCEPTOR + APP_GUARD wired globally
- `main.ts`: bufferLogs, Winston logger, helmet, CORS, global prefix, AllExceptionsFilter, ValidationPipe
- `app.controller.ts`: @SkipThrottle() on health endpoint; stub comment removed
- All 29 tests pass, 0 failures, 6 test suites

### File List

- api/src/config/app.config.ts (new)
- api/src/config/winston.config.ts (new)
- api/src/common/filters/all-exceptions.filter.ts (new)
- api/src/common/filters/all-exceptions.filter.spec.ts (new)
- api/src/common/interceptors/logging.interceptor.ts (new)
- api/src/common/interceptors/logging.interceptor.spec.ts (new)
- api/src/common/guards/throttler.guard.ts (new)
- api/src/common/guards/throttler.guard.spec.ts (new)
- api/src/common/ml-sidecar.service.ts (new)
- api/src/common/ml-sidecar.service.spec.ts (new)
- api/src/app.module.ts (modified)
- api/src/app.controller.ts (modified)
- api/src/main.ts (modified)
- api/package.json (modified — new dependencies installed)

### Change Log

- 2026-05-18: Story file created — comprehensive context from architecture, epics, prior stories 1.1–1.3
- 2026-05-18: Story implemented — NestJS API scaffold with config, logging, exception filter, rate limiting, MlSidecarService; all 29 tests pass
- 2026-05-18: Code review complete — all 8 patches applied, 3 decisions resolved, 5 dismissed; 33 tests pass

## Senior Developer Review (AI)

**Date:** 2026-05-18
**Outcome:** Changes Requested
**Reviewer:** claude-sonnet-4-6 (Blind Hunter + Edge Case Hunter + Acceptance Auditor)

### Action Items

| # | Severity | Type | Title |
|---|----------|------|-------|
| 1 | Med | Decision | LoggingInterceptor: request-only vs. request+response logging |
| 2 | Med | Decision | CORS_ORIGIN: single-string only, multi-origin silently broken |
| 3 | Med | Decision | Health endpoint at `/api/v1/health` only — infra probe concern |
| 4 | Med | Patch | AllExceptionsFilter instantiated via `new` outside DI |
| 5 | Med | Patch | AllExceptionsFilter missing `headersSent` guard |
| 6 | Med | Patch | MlSidecarService raw Observable — no timeout or error mapping |
| 7 | Med | Patch | ThrottlerModule `config.get()!` → `config.getOrThrow()` |
| 8 | Low | Patch | Winston config reads `process.env.LOG_LEVEL` at import time |
| 9 | Med | Patch | LoggingInterceptor logs raw `path` — log injection risk |

**Dismissed:** 5 (false positives / idiomatic patterns)
