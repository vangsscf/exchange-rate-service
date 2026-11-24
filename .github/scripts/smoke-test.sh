#!/usr/bin/env bash
set -euo pipefail

export SMOKE_IMAGE=${1:?Usage: smoke-test.sh IMAGE}
override=$(mktemp)
compose=(docker compose --project-name "exchange-rate-smoke-$$" --env-file .env.example
  -f docker-compose.yml -f "$override")

cleanup() {
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
  rm -f -- "$override"
}
trap cleanup EXIT

cat > "$override" <<'YAML'
services:
  app:
    image: ${SMOKE_IMAGE:?}
    pull_policy: never
    env_file: !reset []
    ports: !reset []
    environment:
      PORT: '3100'
      DEMO_MODE: 'true'
      REDIS: redis://redis:6379
      LOGIN: smoke-admin
      PASS: smoke-password
      SECRET: smoke-test-signing-secret
YAML

if ! "${compose[@]}" up --no-build --wait --wait-timeout 60; then
  "${compose[@]}" logs --no-color >&2
  exit 1
fi

if ! "${compose[@]}" exec -T app node --input-type=module <<'NODE'; then
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

const baseUrl = 'http://127.0.0.1:3100';
const request = (path, options) => fetch(baseUrl + path, { ...options, signal: AbortSignal.timeout(3_000) });
for (let attempt = 1; attempt <= 30; attempt++) {
  let response;
  try {
    response = await request('/conversion?from=USD&to=USD');
  } catch (error) {
    if (attempt === 30) throw error;
    await setTimeout(1_000);
    continue;
  }
  assert.equal(response.status, 200);
  await response.json();
  break;
}

const post = (path, body, authorization = {}) => request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...authorization },
  body: JSON.stringify(body),
});
const login = await post('/login', { login: process.env.LOGIN, password: process.env.PASS });
assert.equal(login.status, 200);
const { token } = await login.json();
assert.ok(typeof token === 'string' && token.length > 0);
const headers = { Authorization: `Bearer ${token}` };

for (const [symbol, rate] of [['SMOKEFROM', 2], ['SMOKETO', 4]]) {
  const added = await post('/add', { symbol, type: 'fixed', rate }, headers);
  assert.equal(added.status, 200);
  assert.deepEqual(await added.json(), { message: `Asset ${symbol} added with success!` });
}

const conversionPath = '/conversion?from=SMOKEFROM&to=SMOKETO&amount=10&decimalPlaces=2';
const conversion = await request(conversionPath);
assert.equal(conversion.status, 200);
assert.deepEqual(await conversion.json(), { from: 'SMOKEFROM', to: 'SMOKETO', amount: 10, value: '5.00' });

const removed = await request('/remove/SMOKETO', { method: 'DELETE', headers });
assert.equal(removed.status, 200);
assert.deepEqual(await removed.json(), { message: 'Asset SMOKETO removed with success!' });
const missing = await request(conversionPath);
assert.equal(missing.status, 404);
assert.deepEqual(await missing.json(), { response: 'SMOKETO not found' });
console.log('Compose smoke test passed.');
NODE
  "${compose[@]}" logs --no-color >&2
  exit 1
fi
