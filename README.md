# Exchange Rate Service

[English](README.md) · [Português](README.pt.md)

A NestJS HTTP API written in TypeScript that converts fiat, crypto, and custom currencies using rates stored in Redis. Rates are expressed in USD per unit of the asset. The service requests quotes from CoinAPI first and uses CoinMarketCap for symbols it cannot price through CoinAPI.

## Run locally

Copy [`.env.example`](.env.example) to `.env` and set your own admin credentials and signing secret. Supply provider API keys if you want live rates.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP listen port. The example and Compose port mapping use `3100`. If you change it in Compose, update the container port in the mapping as well. |
| `COINS` | Comma-separated symbols to seed at startup. The example seeds `USD,BRL,EUR,BTC,ETH`. Use symbols as stored, including letter case, and keep `USD` as the base currency. |
| `DEMO_MODE` | Set to `true` for fixed demo rates. The default is `false`. |
| `COINAPIKEY` | CoinAPI key for the USD exchange-rate feed. |
| `MCAPIKEY` | CoinMarketCap API key for the symbol map and USD quotes. |
| `REDIS` | Redis URL. Use `redis://redis:6379` with bundled Compose Redis or `redis://127.0.0.1:6379` with Redis on the same host as a locally run app. |
| `LOGIN`, `PASS` | Credentials for the single administrator. |
| `SECRET` | JWT signing secret. |

With Docker and Compose installed, run:

```sh
docker compose up --build
```

For development without Docker, install Node.js 20.11 or newer and npm, start a Redis server reachable at `REDIS`, and run:

```sh
npm ci
npm run start:dev
```

`npm run start:dev` uses the Nest CLI in watch mode. For production, run `npm run build` then `npm run start:prod`. Run `npm test` to build and exercise the HTTP endpoints and scheduler with in-memory storage and provider fixtures. The examples below use a POSIX-compatible shell and `http://localhost:3100`.

In live mode, the service seeds configured currencies and attempts its first refresh before accepting requests, then refreshes every minute. New seed currencies retain a placeholder rate of 1 if the initial refresh fails. Known limitations are tracked in [ISSUES.md](ISSUES.md).

### Demo mode

Set `DEMO_MODE=true` in `.env` and restart the app. With Compose, recreate the app container to apply the new environment. Demo mode uses illustrative rates of 1 USD, 0.20 USD per BRL, 1.10 USD per EUR, 60,000 USD per BTC, and 3,000 USD per ETH. These five currencies are seeded regardless of `COINS`. For example, converting 10 USD to BRL returns 50 BRL.

Demo mode skips provider and scraper requests. You can add custom currencies as `fixed` with a positive rate. Redis is still required and stores demo currencies separately from live currencies. Set `DEMO_MODE=false` and restart the app to resume live rates.

## CI/CD with GitHub Actions

Pull requests targeting `main` run `npm ci` and `npm test` and verify that the Docker image builds. On each push to `main`, GitHub Actions runs the tests and, if they pass, publishes the image to the GitHub Container Registry with the full commit SHA as its tag.

Publishing uses the workflow's built-in `GITHUB_TOKEN`. To run a published image, replace `<commit-sha>` with the SHA of the version you want and set `REDIS` in `.env` to a URL the container can reach. To pull a private image, sign in to `ghcr.io` with a personal access token (classic) that has `read:packages` and read access to the package. [GitHub Container Registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-with-a-personal-access-token-classic)

```sh
docker run --rm --env-file .env -p 3100:3100 ghcr.io/vangsscf/exchange-rate-service:<commit-sha>
```

### PR review with OpenRouter

Under **Settings → Secrets and variables → Actions**, create the `OPENROUTER_API_KEY` secret. The `OPENROUTER_MODEL` variable is optional. The default model is `openai/gpt-5.4-mini`, which OpenRouter charges for. [Model and pricing](https://openrouter.ai/openai/gpt-5.4-mini)

The workflow reviews PRs ready for review from branches in this repository targeting `main`. Each eligible update sends up to 60,000 bytes of the diff to OpenRouter. Find the review in Portuguese under **Actions → PR review with OpenRouter → Summary**.

## Convert currency

`GET /conversion` is public.

| Query parameter | Description |
| --- | --- |
| `from` | Required source symbol. |
| `to` | Required destination symbol. |
| `amount` | Optional numeric amount. Defaults to 1. |
| `decimalPlaces` | Optional integer. Use 1–30 to format the result. The default is 8, and the current implementation also uses 8 when given 0. |

```sh
curl 'http://localhost:3100/conversion?from=USD&to=EUR&amount=10&decimalPlaces=2'
```

Example `200 OK` response. The result depends on the stored rates.

```json
{"from":"USD","amount":10,"to":"EUR","value":"9.20"}
```

An unknown symbol returns `404`. The formatted `value` is a JSON string.

## Authenticate and refresh

`POST /login` accepts a JSON body with the required strings `login` and `password`, which must match `LOGIN` and `PASS`.

```sh
curl 'http://localhost:3100/login' \
  -H 'Content-Type: application/json' \
  --data '{"login":"YOUR_LOGIN","password":"YOUR_PASSWORD"}'
```

A successful response is `200 OK` with `{"token":"<JWT>"}`. Tokens expire after two hours. Use the raw JWT as the `Authorization` header value, omitting the `Bearer` prefix. Replace `YOUR_JWT` in the examples with the token returned by login.

`GET /refresh` requires a valid, unexpired token and returns a newly signed token in the same response format.

```sh
curl 'http://localhost:3100/refresh' -H 'Authorization: YOUR_JWT'
```

## Add a currency

`POST /add` requires authentication and a JSON body. Adding a symbol already stored with type `main` returns `404`.

| Field | Description |
| --- | --- |
| `symbol` | Required alphanumeric string of up to 15 characters. Lookups are case-sensitive. |
| `type` | Required. One of `fiat`, `crypto`, `fixed`, or `scrapper`. |
| `rate` | Supply a positive numeric USD rate per unit for `fixed`. |
| `scrpprUrl` | Page URL required for the scraper fallback. |
| `scrpprRateTag` | CSS selector for price text, required for the scraper fallback. |
| `scrpprAmountTag` | Optional CSS selector for quantity text. Defaults to a quantity of 1. |
| `scrpprRateAsset` | Optional symbol already stored in Redis, indicating the price currency. Defaults to USD. |
| `scrpprDecimalSymbol` | Optional decimal separator, `,` or `.`. Defaults to `,`. |

In live mode, all types check the loaded CoinAPI quotes and then the CoinMarketCap symbol map before using a fixed rate or scraping a page. The current scraper expects a text fragment containing `$` in each configured selector. The service looks up a rate before saving the record. Some fallback inputs can still produce invalid stored rates.

```sh
curl 'http://localhost:3100/add' \
  -H 'Authorization: YOUR_JWT' \
  -H 'Content-Type: application/json' \
  --data '{"symbol":"DEMOCOIN","type":"fixed","rate":2.5}'
```

Example `200 OK` response:

```json
{"message":"Asset DEMOCOIN added with success!"}
```

## Remove a currency

`DELETE /remove/:asset` requires authentication. Removing an unknown symbol returns `404`. A currency currently stored with type `main` returns `400`.

```sh
curl -X DELETE 'http://localhost:3100/remove/DEMOCOIN' \
  -H 'Authorization: YOUR_JWT'
```

Example `200 OK` response:

```json
{"message":"Asset DEMOCOIN removed with success!"}
```
