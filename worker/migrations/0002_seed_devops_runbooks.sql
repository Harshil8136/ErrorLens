-- ============================================================
-- ErrorLens D1 Seed: 0002_seed_devops_runbooks.sql
-- Curated high-impact DevOps & Cloud troubleshooting runbooks
-- ============================================================

INSERT OR IGNORE INTO runbooks (
  slug, category, error_code, title, summary, root_cause,
  diagnostic_command, solution_steps, tags, source_url
) VALUES
-- 1. Docker Exit Code 137
(
  'docker-exit-code-137-oom',
  'docker',
  'Exit Code 137',
  'Container Terminated with Exit Code 137 (OOMKilled)',
  'Docker or Kubernetes terminated the container due to Out-Of-Memory (OOM) killer triggered by exceeding allocated cgroup memory limits.',
  'The process inside the container allocated more RAM than the container limit allowed (or host system ran out of swap and free memory), causing Linux kernel to send SIGKILL (signal 9: 128 + 9 = 137).',
  'docker inspect <container-id> --format="{{.State.OOMKilled}} {{.State.ExitCode}} {{.State.Error}}"',
  '[
    {"step": 1, "action": "Verify OOMKilled flag", "command": "docker inspect <container-id> --format=\"OOMKilled: {{.State.OOMKilled}}\"", "expected": "Returns true if kernel killed process due to memory exhaustion."},
    {"step": 2, "action": "Check memory usage trend before crash", "command": "docker stats --no-stream", "expected": "Identify if memory steadily climbed (memory leak) or spiked during a heavy batch job."},
    {"step": 3, "action": "Increase memory allocation in compose or run", "command": "docker run -m 2g --memory-swap 2g <image>", "expected": "Provides sufficient headroom for spike workloads."},
    {"step": 4, "action": "Tune runtime memory flags", "command": "NODE_OPTIONS=\"--max-old-space-size=1536\" (Node) or -Xmx1536m (JVM)", "expected": "Keeps runtime garbage collector within container cgroup boundary."}
  ]',
  '["docker", "kubernetes", "oom", "exit 137", "sigkill", "memory", "linux"]',
  'https://docs.docker.com/engine/containers/resource_constraints/'
),

-- 2. Kubernetes CrashLoopBackOff
(
  'k8s-crashloopbackoff',
  'kubernetes',
  'CrashLoopBackOff',
  'Pod Stuck in CrashLoopBackOff',
  'Kubernetes kubelet attempts to start a container in a Pod, but the container repeatedly crashes immediately on startup or fails liveness probes.',
  'Common causes include missing required environment variables, misconfigured ENTRYPOINT or CMD, failing database connection during bootstrap, or a failing liveness probe before the app is ready.',
  'kubectl describe pod <pod-name> -n <namespace> && kubectl logs <pod-name> -n <namespace> --previous',
  '[
    {"step": 1, "action": "Inspect previous container logs before crash", "command": "kubectl logs <pod-name> -n <namespace> --previous --tail=50", "expected": "Reveals fatal exception, missing secret, or panic message right before exit."},
    {"step": 2, "action": "Check pod events and exit code", "command": "kubectl describe pod <pod-name> -n <namespace> | grep -E \"(Exit Code|Reason|Back-off)\"", "expected": "Reveals Exit Code (e.g. 1 = app error, 137 = OOM, 139 = segfault)."},
    {"step": 3, "action": "Inspect startup probes vs liveness probes", "command": "kubectl get pod <pod-name> -o jsonpath=\"{.spec.containers[*].livenessProbe}\"", "expected": "If app takes 30s to boot but initialDelaySeconds is 5s, increase initialDelaySeconds or add a startupProbe."},
    {"step": 4, "action": "Debug with interactive shell", "command": "kubectl debug pod/<pod-name> -it --image=busybox --target=<container-name>", "expected": "Allows inspecting filesystem and testing database connectivity from within pod network."}
  ]',
  '["kubernetes", "k8s", "crashloopbackoff", "pod", "kubectl", "liveness", "startup"]',
  'https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/'
),

-- 3. Node.js OpenSSL 3.0 Crypto Legacy Provider
(
  'node-err-ossl-evp-unsupported',
  'node',
  'ERR_OSSL_EVP_UNSUPPORTED',
  'Node.js error:0308010C:digital envelope routines::unsupported',
  'Web development build (Webpack, Create React App, Vue CLI) fails on Node.js 17+ with ERR_OSSL_EVP_UNSUPPORTED.',
  'Node.js 17+ upgraded to OpenSSL 3.0, which disabled legacy cryptographic algorithms (such as MD4 hashing previously used by Webpack 4 for hashing file assets).',
  'node -e "console.log(process.versions.node, process.versions.openssl)"',
  '[
    {"step": 1, "action": "Immediate local workaround", "command": "export NODE_OPTIONS=\"--openssl-legacy-provider\" (Linux/macOS) or set NODE_OPTIONS=--openssl-legacy-provider (Windows)", "expected": "Enables OpenSSL 3.0 legacy crypto provider allowing build to succeed."},
    {"step": 2, "action": "Permanent package script fix", "command": "\"scripts\": { \"build\": \"NODE_OPTIONS=--openssl-legacy-provider next build\" } in package.json", "expected": "Ensures CI/CD runners automatically include flag without manual environment setup."},
    {"step": 3, "action": "Recommended long-term fix", "command": "npm install --save-dev webpack@latest", "expected": "Upgrade to Webpack 5.61.0+ which uses SHA-256 / xxhash instead of deprecated MD4."}
  ]',
  '["node", "npm", "webpack", "react", "openssl", "err_ossl_evp_unsupported", "crypto"]',
  'https://github.com/nodejs/node/issues/40455'
),

-- 4. Nginx 502 Bad Gateway
(
  'nginx-502-bad-gateway',
  'networking',
  '502 Bad Gateway',
  'Nginx 502 Bad Gateway (Upstream Connection Refused or Timed Out)',
  'Nginx reverse proxy received an invalid response or connection refusal from the upstream backend application server.',
  'The backend service (FastAPI, Express, Gunicorn, PHP-FPM) is either down, listening on a different port/socket, or failing to accept connections before proxy_connect_timeout.',
  'tail -n 25 /var/log/nginx/error.log',
  '[
    {"step": 1, "action": "Check Nginx error log for upstream address", "command": "grep \"502\" /var/log/nginx/error.log | tail -n 10", "expected": "Displays: connect() failed (111: Connection refused) while connecting to upstream [127.0.0.1:3000]."},
    {"step": 2, "action": "Verify if upstream process is listening", "command": "ss -tulpn | grep -E \"(3000|8000|8080|9000)\"", "expected": "Confirm whether the backend application process is running and bound to 127.0.0.1 or 0.0.0.0."},
    {"step": 3, "action": "Check upstream systemd service health", "command": "systemctl status <your-app-service>", "expected": "Shows if the backend crashed with unhandled exception."},
    {"step": 4, "action": "Unix socket permission check (if using sockets)", "command": "ls -l /var/run/<app>.sock", "expected": "Ensure nginx user (www-data or nginx) has read/write permissions to socket file."}
  ]',
  '["nginx", "502", "bad gateway", "proxy", "networking", "upstream", "connection refused"]',
  'https://nginx.org/en/docs/http/ngx_http_proxy_module.html'
),

-- 5. Linux Inode Exhaustion (No Space Left On Device)
(
  'linux-no-space-inodes',
  'linux',
  'ENOSPC / Inode Exhaustion',
  'No space left on device (Disk Has Free GBs but Out of Inodes)',
  'Commands or scripts fail with "No space left on device" despite `df -h` showing plenty of available gigabytes.',
  'Linux filesystem has exhausted its allocated inode table (1 inode per file/directory). Millions of tiny files (often Docker layers, temp session files, or mail queues) have consumed 100% of inodes.',
  'df -ih && df -h',
  '[
    {"step": 1, "action": "Verify inode percentage vs block percentage", "command": "df -ih", "expected": "Shows IUse% at 100% on the root (/) or data mount."},
    {"step": 2, "action": "Locate directories containing largest file count", "command": "find / -xdev -printf \"%h\\n\" 2>/dev/null | sort | uniq -c | sort -nr | head -n 15", "expected": "Pinpoints exact directory holding millions of files (e.g. /var/lib/docker or /tmp)."},
    {"step": 3, "action": "Clean up Docker dangling layers and build caches", "command": "docker system prune -af --volumes", "expected": "Releases thousands of orphaned layer inodes."},
    {"step": 4, "action": "Safely delete million small files without argument list too long", "command": "find /path/to/bloated/dir -type f -name \"*.log\" -delete", "expected": "Recovers inodes immediately without exceeding bash ARG_MAX."}
  ]',
  '["linux", "disk", "enospc", "inodes", "df", "filesystem", "storage"]',
  'https://www.kernel.org/doc/html/latest/filesystems/ext4/inodes.html'
),

-- 6. Cloudflare Worker CPU Time Limit Exceeded (Error 1101)
(
  'cloudflare-worker-error-1101-cpu',
  'cloud',
  'Error 1101',
  'Cloudflare Worker Error 1101 (Worker Threw Exception / CPU Timeout)',
  'Cloudflare Edge returns Error 1101 when a Worker exceeds its allocated execution CPU time or throws an unhandled top-level exception.',
  'On the free tier, Cloudflare Workers enforce a 10ms or 50ms synchronous CPU limit. Heavy JSON parsing, unoptimized regexes, or large cryptographic loops exceed this limit.',
  'npx wrangler tail --format=pretty',
  '[
    {"step": 1, "action": "Stream live real-time error traces from Cloudflare edge", "command": "npx wrangler tail --status error", "expected": "Outputs exact stack trace and shows \"CPU time limit exceeded\" or uncaught promise rejection."},
    {"step": 2, "action": "Offload long-running work to ctx.waitUntil()", "command": "ctx.waitUntil(analyticsPromise); return response;", "expected": "Allows worker to deliver HTTP response within 10ms while background I/O continues safely."},
    {"step": 3, "action": "Avoid large in-memory synchronous operations", "command": "Stream response using TransformStream instead of reading entire 10MB file into memory buffer.", "expected": "Keeps CPU cycles under 5ms per chunk."}
  ]',
  '["cloudflare", "workers", "error 1101", "cpu limit", "wrangler", "edge", "serverless"]',
  'https://developers.cloudflare.com/workers/observability/errors/'
),

-- 7. PostgreSQL Connection Limit Exceeded
(
  'postgres-fatal-remaining-connection-slots',
  'database',
  'FATAL: 53300',
  'PostgreSQL FATAL: remaining connection slots are reserved for superuser',
  'Application cannot connect to PostgreSQL database; returns error 53300: remaining connection slots are reserved for non-replication superuser connections.',
  'The number of active backend client connections has reached the `max_connections` threshold configured in postgresql.conf. Serverless functions or idle client leaks open new connections without closing them.',
  'psql -U postgres -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"',
  '[
    {"step": 1, "action": "Check connection breakdown by user and state", "command": "SELECT datname, usename, client_addr, count(*) FROM pg_stat_activity GROUP BY 1,2,3 ORDER BY count DESC;", "expected": "Identifies if a specific client IP or application service has orphaned 100+ idle connections."},
    {"step": 2, "action": "Terminate all idle connections immediately", "command": "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = ''idle'' AND state_change < current_timestamp - INTERVAL ''5 minutes'';", "expected": "Instantly recovers connection slots for production traffic."},
    {"step": 3, "action": "Enable connection pooling (PgBouncer or Supabase Supavisor)", "command": "Connect via port 6543 (transaction pooler) instead of port 5432 (direct connection)", "expected": "Multiplexes thousands of serverless requests across 20 persistent Postgres connections."},
    {"step": 4, "action": "Configure idle timeout in postgresql.conf", "command": "idle_in_transaction_session_timeout = ''30s''", "expected": "Prevents unclosed client transactions from locking connection slots indefinitely."}
  ]',
  '["postgres", "postgresql", "sql", "database", "pgbouncer", "connection limit", "53300"]',
  'https://www.postgresql.org/docs/current/runtime-config-connection.html'
),

-- 8. Kubernetes ImagePullBackOff
(
  'k8s-imagepullbackoff',
  'kubernetes',
  'ImagePullBackOff',
  'Kubernetes Pod in ImagePullBackOff / ErrImagePull',
  'Kubernetes node cannot pull the specified container image from the container registry (Docker Hub, GitHub Packages, AWS ECR, GCP Artifact Registry).',
  'Typical causes: typo in image tag (e.g. `v1.2.0` instead of `1.2.0`), private registry missing `imagePullSecrets`, Docker Hub rate limit exceeded (429 Too Many Requests), or image platform mismatch (e.g. ARM64 image on AMD64 node).',
  'kubectl describe pod <pod-name> -n <namespace> | grep -A 5 -B 2 "Events:"',
  '[
    {"step": 1, "action": "Inspect exact registry pull error message in events", "command": "kubectl get events -n <namespace> --field-selector reason=Failed --sort-by=''.metadata.creationTimestamp''", "expected": "Returns exact error: e.g. \"manifest unknown\", \"unauthorized: authentication required\", or \"toomanyrequests\"."},
    {"step": 2, "action": "Check image pull secret existence", "command": "kubectl get secret <secret-name> -n <namespace> -o jsonpath=\"{.data.\\.dockerconfigjson}\" | base64 -d", "expected": "Verifies that registry credentials are valid and unexpired."},
    {"step": 3, "action": "Test docker pull directly on node or local machine", "command": "docker pull <exact-image-string>", "expected": "Confirms image exists and tag spelling is 100% accurate."},
    {"step": 4, "action": "Attach imagePullSecrets to Deployment or ServiceAccount", "command": "spec.imagePullSecrets: [name: my-registry-secret]", "expected": "Provides authentication token for private repository access."}
  ]',
  '["kubernetes", "k8s", "imagepullbackoff", "docker", "registry", "kubectl"]',
  'https://kubernetes.io/docs/concepts/containers/images/#imagepullbackoff'
);
