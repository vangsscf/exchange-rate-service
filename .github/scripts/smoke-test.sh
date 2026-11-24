#!/usr/bin/env bash
set -euo pipefail

image=${1:?Usage: smoke-test.sh IMAGE}
network="exchange-rate-smoke-$$"
redis="${network}-redis"
app="${network}-app"

cleanup() {
  docker rm -f "$app" "$redis" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --name "$redis" --network "$network" redis >/dev/null
for attempt in {1..30}; do
  if [[ $(docker exec "$redis" redis-cli ping 2>/dev/null) == PONG ]]; then
    break
  fi
  if (( attempt == 30 )); then
    docker logs "$redis" >&2
    exit 1
  fi
  sleep 1
done

docker run -d --name "$app" --network "$network" \
  -e PORT=3100 -e DEMO_MODE=true -e REDIS="redis://$redis:6379" "$image" >/dev/null

if ! docker exec -i "$app" node --input-type=module <<'NODE'; then
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

const currency = 'USD';
const amount = 10;
const url = new URL('http://127.0.0.1:3100/conversion');
url.search = new URLSearchParams({ from: currency, to: currency, amount, decimalPlaces: 2 });
for (let attempt = 1; attempt <= 30; attempt++) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
  } catch (error) {
    if (attempt === 30) throw error;
    await setTimeout(1_000);
    continue;
  }
  assert.equal(response.status, 200);
  const { from, to, amount: returnedAmount, value } = await response.json();
  assert.equal(from, currency);
  assert.equal(to, currency);
  assert.equal(returnedAmount, amount);
  assert.match(value, /^\d+\.\d{2}$/);
  assert.equal(Number(value), amount);
  console.log('Docker image smoke test passed.');
  break;
}
NODE
  docker logs "$app" >&2
  exit 1
fi
