# Story 1.5: Angular SPA Scaffold & Routing Shell

## Story

**As a** developer,
**I want** the Angular SPA scaffolded with routing, core providers, the HTTP error interceptor, and the application shell,
**So that** the frontend has a working shell with the correct URL structure and error handling ready for feature development.

## Acceptance Criteria

1. **Given** the frontend service is running
   **When** a browser navigates to `http://localhost:4200`
   **Then** the Angular application shell loads without console errors
   **And** the initial load completes within 2 seconds on a broadband connection (NFR3)

2. **Given** `frontend/src/app/app.routes.ts`
   **When** a developer inspects it
   **Then** the following routes are defined with lazy loading: `/` → search feature, `/company/:ticker` → company feature, wildcard `**` → redirects to `/`

3. **Given** the HTTP error interceptor in `core/interceptors/http-error.interceptor.ts`
   **When** any API call returns a 4xx or 5xx response
   **Then** the interceptor catches it and routes to an explicit error state
   **And** no raw API error message, stack trace, or internal code is shown to the user

4. **Given** any page renders in the application
   **When** the page is inspected
   **Then** the disclaimer footer "Not financial advice. Data sourced from public SEC filings." is visible in a semantic `<footer>` element (FR44, UX-DR10, NFR20)

5. **Given** `frontend/src/environments/`
   **When** the files are inspected
   **Then** `environment.ts` sets `apiBaseUrl` to `http://localhost:3000/api/v1`
   **And** `environment.prod.ts` reads the API URL from a build-time variable — no hardcoded production URLs in source

## Tasks / Subtasks

- [x] Task 1: Create environment files
  - [x] Create `frontend/src/environments/environment.ts` with `apiBaseUrl: 'http://localhost:3000/api/v1'`
  - [x] Create `frontend/src/environments/environment.prod.ts` with empty `apiBaseUrl` (CI/CD injects via `--define`)
  - [x] Add `fileReplacements` to `angular.json` production config

- [x] Task 2: Create HTTP error interceptor
  - [x] Create `frontend/src/app/core/interceptors/http-error.interceptor.ts` as a functional interceptor
  - [x] Interceptor catches 4xx/5xx and returns sanitized error (no raw messages)
  - [x] Write spec: `http-error.interceptor.spec.ts`

- [x] Task 3: Create lazy-loaded feature stubs
  - [x] Create `frontend/src/app/features/search/search.component.ts`
  - [x] Create `frontend/src/app/features/search/search.routes.ts`
  - [x] Create `frontend/src/app/features/company/company.component.ts`
  - [x] Create `frontend/src/app/features/company/company.routes.ts`

- [x] Task 4: Wire up routes and providers
  - [x] Update `frontend/src/app/app.routes.ts` with lazy routes + wildcard redirect
  - [x] Update `frontend/src/app/app.config.ts` with `provideHttpClient(withInterceptors([...]))`

- [x] Task 5: Update app shell
  - [x] Replace placeholder `frontend/src/app/app.html` with routing shell + semantic footer
  - [x] Update `frontend/src/app/app.ts` to remove unused signal import
  - [x] Update `frontend/src/app/app.spec.ts` to match new shell

### Review Findings (AI) — 2026-05-18

#### Decision Needed
- [x] [Review][Decision] Interceptor error behavior — resolved: re-throw clean `ApiError` is the intended pattern (Option A); AC3 "routes to an explicit error state" means propagating a sanitized error for component-level handling. No Router navigation required.

#### Patches
- [x] [Review][Patch] Add `pathMatch: 'full'` to empty-path route — without it, Angular prefix-matches every URL to `''`, making `company/:ticker` and `**` unreachable [frontend/src/app/app.routes.ts]
- [x] [Review][Patch] Add `define` fallback for `API_BASE_URL` in angular.json production config — if CI/CD omits `--define`, `environment.prod.ts` throws a `ReferenceError` at runtime with no build-time warning [frontend/angular.json]
- [x] [Review][Patch] Handle HTTP `status === 0` (network/CORS/offline) as a distinct case — currently falls into the generic 4xx bucket, losing network-error semantics [frontend/src/app/core/interceptors/http-error.interceptor.ts]
- [x] [Review][Patch] Change wildcard `redirectTo: ''` to `redirectTo: '/'` — spec AC2 explicitly states redirect to `/` [frontend/src/app/app.routes.ts]
- [x] [Review][Patch] Add `instanceof HttpErrorResponse` guard — non-HTTP errors (client-side JS exceptions) are caught and swallowed with a misleading message [frontend/src/app/core/interceptors/http-error.interceptor.ts]
- [x] [Review][Patch] Add layout CSS to `app.scss` ensuring footer is always visible — no styles prevent a full-height `<main>` from obscuring the required disclaimer footer [frontend/src/app/app.scss]

#### Deferred
- [x] [Review][Defer] All 4xx errors produce identical message — no 401/403/429 distinction; needs per-status handling in future auth/rate-limit stories [frontend/src/app/core/interceptors/http-error.interceptor.ts] — deferred, pre-existing design choice
- [x] [Review][Defer] `ApiError` discards original `HttpErrorResponse` — url, method, and body are lost; future stories may need them — deferred, pre-existing
- [x] [Review][Defer] `environment.ts` is not yet imported by any service — intentional scaffold; future HTTP service stories will consume it — deferred, pre-existing
- [x] [Review][Defer] `CompanyComponent` doesn't read `:ticker` param — placeholder stub; Epic 6 stories will implement — deferred, pre-existing
- [x] [Review][Defer] `<main>` has no ARIA `role` or skip-navigation link — accessibility deferred to Epic 2 design system stories — deferred, pre-existing
- [x] [Review][Defer] Empty `:ticker` (`/company/`) and lazy-chunk-load failure lack route guards — feature-layer concern for Epic 6 stories — deferred, pre-existing
- [x] [Review][Defer] API URL normalization (trailing slash validation) at startup — beyond scaffold scope — deferred, pre-existing
- [x] [Review][Defer] No global `ErrorHandler` provided — cross-cutting concern; future observability story — deferred, pre-existing
- [x] [Review][Defer] Ticker case/encoding normalization — route guard concern for Epic 6 — deferred, pre-existing

## Dev Notes

- Angular 21 standalone components — use functional interceptors via `withInterceptors`
- Feature lazy loading uses `loadChildren` with separate route files for extensibility
- The `environment.prod.ts` leaves `apiBaseUrl` empty; CI/CD sets it via `ng build --define`
- `window.__env` runtime injection is NOT used — build-time only per story spec
- `@angular/common/http/testing` is available via `@angular/common` package dep
- `app.ts` file is the root component (Angular 21 renamed from `app.component.ts`)
- Testing: `ng test` uses `@angular/build:unit-test` (vitest under the hood with jsdom + Angular TestBed)

## Dev Agent Record

### Implementation Plan

1. Environment files → fileReplacements in angular.json
2. Functional HTTP error interceptor + spec
3. Feature stub components + route files
4. Update app.routes.ts + app.config.ts
5. Replace app.html placeholder with shell + footer; slim down app.ts

### Debug Log

_None_

### Completion Notes

Implemented Angular 21 SPA scaffold with:
- Environment files (dev URL hardcoded; prod uses empty placeholder injected by CI/CD)
- Functional HTTP error interceptor sanitizing 4xx/5xx responses
- Lazy-loaded search and company feature stubs
- App routing shell with wildcard redirect and semantic footer
- Updated app config with `provideHttpClient` + interceptor
- All tests passing (interceptor spec + updated app spec)

## File List

- `frontend/src/environments/environment.ts` (new)
- `frontend/src/environments/environment.prod.ts` (new)
- `frontend/src/app/core/interceptors/http-error.interceptor.ts` (new)
- `frontend/src/app/core/interceptors/http-error.interceptor.spec.ts` (new)
- `frontend/src/app/features/search/search.component.ts` (new)
- `frontend/src/app/features/search/search.routes.ts` (new)
- `frontend/src/app/features/company/company.component.ts` (new)
- `frontend/src/app/features/company/company.routes.ts` (new)
- `frontend/src/app/app.routes.ts` (modified)
- `frontend/src/app/app.config.ts` (modified)
- `frontend/src/app/app.ts` (modified)
- `frontend/src/app/app.html` (modified)
- `frontend/src/app/app.spec.ts` (modified)
- `frontend/angular.json` (modified)

## Change Log

- 2026-05-18: Story created and implemented — Angular SPA scaffold with routing shell, HTTP error interceptor, environment config, lazy-loaded feature stubs, and semantic footer

## Status

done
