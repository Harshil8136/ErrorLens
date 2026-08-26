-- The seed runbook claimed Error 1101 is the CPU-time error. It isn't.
-- Per https://developers.cloudflare.com/workers/observability/errors/ :
--   1101 = Worker threw a JavaScript exception
--   1102 = Worker exceeded CPU time limit
-- The original entry also said the limit was "10ms or 50ms"; the Free plan
-- limit is 10 ms of CPU per invocation and the Paid plan is not 50 ms.

UPDATE runbooks SET
  slug       = 'cloudflare-worker-error-1102-cpu',
  error_code = 'Error 1102',
  title      = 'Cloudflare Worker Error 1102 (Exceeded CPU Time Limit)',
  summary    = 'Cloudflare returns Error 1102 when a Worker exceeds its CPU time limit. Error 1101 is the separate case where the Worker threw an uncaught JavaScript exception.',
  root_cause = 'The Workers Free plan allows 10 ms of CPU time per invocation. CPU time counts only active computation, not time spent awaiting I/O, so a slow upstream fetch will not trigger this but a large synchronous JSON parse, an unoptimised regex, or a big cryptographic loop will.',
  tags       = '["cloudflare", "workers", "error 1102", "error 1101", "cpu limit", "cpu time", "wrangler", "edge", "serverless"]',
  verified_at = '2026-08-26',
  updated_at = CURRENT_TIMESTAMP
WHERE slug = 'cloudflare-worker-error-1101-cpu';
