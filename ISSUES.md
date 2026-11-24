# Exchange Rate Service issues

The NestJS migration addressed several findings from the initial review. The items below track the remaining behavior and the changes already made.

## High priority

### 2. A failed initial refresh can leave placeholder rates in use

Nest waits for seeding and the first refresh attempt before it accepts traffic. A failed attempt can still leave newly seeded currencies at 1, so conversions can return misleading values. Distinguish unavailable rates from real quotes and validate startup configuration, including the USD base. [Initialization and conversion](src/currencies/currency.service.ts)

### 3. Provider errors can interrupt refresh

A CoinAPI failure ends the refresh before CoinMarketCap or custom fallbacks run. A single failed currency can also prevent the refresh from saving any rates from that run. Provider calls now have timeouts, and refresh warnings omit request headers. Isolate provider and currency failures and keep a freshness timestamp with the last valid rate. [Rate service](src/currencies/rates.service.ts)

### 4. Concurrent writes can undo currency changes

The add route now checks the stored symbol and protects records with type `main`. Seeding still leaves existing records unchanged when their symbols are added to `COINS`. Refresh also reads a snapshot and writes full records back, so it can overwrite an update or recreate a deleted currency. Reconcile the seed policy with existing records and condition refresh writes on the record remaining unchanged. [Currency service](src/currencies/currency.service.ts) · [Rate service](src/currencies/rates.service.ts) · [Redis repository](src/currencies/currency.repository.ts)

### 5. The scraper can access internal network destinations

The scraper accepts an administrator-supplied URL and imposes a timeout. Destination, redirect, and response-size policies are still missing. Restrict outbound access to approved destinations and apply response-size limits. [Add validation](src/currencies/currency.controller.ts) · [Scraper request](src/currencies/rates.service.ts)

### 6. Configuration files exist in Git history

The Docker build excludes local environment files and Git metadata. Git history contains older versions of `.env` and `.env.example`. Check whether any historical values need rotation. [Docker ignore rules](.dockerignore)

## Medium priority

### 7. Conversion can return nonfinite or misleading values

Fixed rates are optional in the schema and may be zero or negative. Conversion does not verify that both rates are positive and finite. It can return a successful response with the string `NaN` or `Infinity`. A precision of 0 falls back to eight, the schema has no lower bound, and BigNumber can round the intermediate division before formatting. Validate rates and enforce the intended precision range. [Validation](src/currencies/currency.controller.ts) · [Conversion](src/currencies/currency.service.ts)

### 9. Scraped rates can be misread or calculated from stale dependencies

The scraper expects a space-delimited token containing `$` in both selectors. Plain numeric quantities and some price formats fail. Parsed values are used without verifying that they are positive numbers, and refresh can use the previous rate of the scraper's reference asset. Validate parsing and resolve rate dependencies from the active refresh where possible. [Rate service](src/currencies/rates.service.ts)

### 10. Authentication defaults and login need hardening

The environment template contains an easy-to-copy password and signing secret. Login has no attempt limits. Require a strong configured secret and rate-limit login. [Environment template](.env.example) · [Authentication service](src/auth/auth.service.ts)

### 11. Redis image version and persistence are unmanaged

Compose waits for Redis to respond to a health check before starting the app. The Redis image uses a floating tag and Compose has no explicit data volume. Pin Redis and manage data persistence explicitly. [Compose configuration](docker-compose.yml)

## Addressed in the NestJS migration

- **1. Scheduled refresh binding.** The Nest scheduler invokes the injected rate service every minute and skips overlapping ticks. Refresh awaits the Redis write. [Rate service](src/currencies/rates.service.ts)
- **8. Async route and Redis connection handling.** Nest handles rejected route promises. The repository shares a connection and closes it on application shutdown. [Bootstrap](src/main.ts) · [Redis repository](src/currencies/currency.repository.ts)
- **12. Regression checks and package metadata.** Package metadata points to the Nest build. The HTTP suite covers all routes and the scheduled refresh using fixtures. CI checks the runtime image with Compose, Redis, and demo-mode writes and conversions. Live providers, provider outages, write races, and precision edge cases remain outside this coverage. [API regression tests](test/api.test.cjs) · [Compose smoke test](.github/scripts/smoke-test.sh)
