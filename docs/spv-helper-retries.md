# SPV helper throttling

The hosted SPV helper client retries HTTP 429 for GET lookups, `/tx/address`,
and the explicitly allowlisted read-only RPC methods. It makes at most three
attempts (the first request plus two retries). Unknown or state-changing POST
operations, HTTP 4xx other than 429, HTTP 5xx, network failures, and JSON-RPC
error envelopes are not retried.

`Retry-After` is interpreted as nonnegative integer seconds or an HTTP date.
For dates, the response's `Date` header is used when available to avoid local
clock skew. Missing or invalid values use one- then two-second fallback delays.
Each wait adds 1–250 ms of positive jitter. The retry deadline is 125 seconds
from the initial request; a server delay that will not fit returns the 429
without retrying early. The deadline bounds retry scheduling, not an in-flight
fetch. Suspension past the deadline stops retries with a rate-limit error.

The same configured helper URL and serialized body are used on each attempt.
Final HTTP/JSON-RPC failures remain errors; provider message/type/code metadata
is retained. GET failures now check Fetch's `status` rather than `statusCode`.
Discarded throttle responses are drained without requiring JSON, so an HTML
throttle response can still be retried.

This is a per-request retry policy. It does not change gateway limits, add
unlimited retries, coordinate all requests behind a shared public IP, or solve
upstream database timeouts. Large concurrent history scans can still exhaust
their retry budget. Future pacing/coalescing work should use the gateway's
recent limiter-specific diagnostics to measure that need.

Validation:

- `node_modules/.bin/tape -r @babel/register app/background/node/tests/spvHelperRequest.spec.js`
- `npm test` (includes the new tests via `unit.js`)
- `npm run build` (includes compiled application validation)

A wallet application release is needed before existing installations use this
source change; the hosted gateway deployment alone cannot update wallet clients.
