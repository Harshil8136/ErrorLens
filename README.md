# ErrorLens

> Instant, universal troubleshooting and fix playbooks for any software, cloud, server, or operating system error.

Paste any error code, terminal log, exit code, or stack trace. ErrorLens gives you the **exact command to confirm the cause**, the **step-by-step fix**, and **what to do next if issues persist**.

Built to run 100% free on Cloudflare Workers (D1, Vectorize, KV) and Google AI Studio's Gemini 3.5 Flash-Lite.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Built on Cloudflare](https://img.shields.io/badge/Cloudflare-Workers%20%7C%20D1%20%7C%20Vectorize-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Powered by Gemini](https://img.shields.io/badge/Google-Gemini%203.5%20Flash--Lite-4285F4?logo=google&logoColor=white)](https://aistudio.google.com/)

---

## 🌟 Universal Troubleshooting for Any System

Unlike static catalogs that only know a handful of pre-coded errors, ErrorLens is a **universal troubleshooting engine**. It analyzes and resolves issues across:

- **Windows & Active Directory**: BSOD stop codes (`0x000000EF CRITICAL_PROCESS_DIED`, `0x80070005`), Kerberos pre-auth errors, Event Viewer logs, DISM/SFC repairs.
- **Linux & Servers**: `systemd`, `cgroups`, OOM kills, inode exhaustion (`ENOSPC`), file permissions, socket states.
- **Cloud & Edge**: Cloudflare Workers (CPU 1102), Cloudflare 52x errors (520, 521, 522, 524), AWS S3/IAM 403s, Azure.
- **Containers & Kubernetes**: Docker Exit Code 137, Pod `CrashLoopBackOff`, `ImagePullBackOff`, OOMKilled, liveness probe failures.
- **Networking & DNS**: Cisco routing, DNS `SERVFAIL`/`NXDOMAIN`, WireGuard/IPSec VPN drops, Cloudflare Zero Trust (CFZT).
- **Databases**: PostgreSQL / Supabase connection slot exhaustion (`53300`), deadlocks (`40P01`), RLS policy rejections.
- **Applications & APIs**: Sentry unhandled exceptions, Node.js OpenSSL errors, Python tracebacks, HTTP 5xx/4xx.

---

## 📋 What You Get for Every Error

1. **Root Cause**: Clear technical explanation of why the failure occurred at the kernel, protocol, or runtime layer.
2. **Diagnostic Check**: The single, non-destructive command to run in your terminal first to confirm the exact cause before changing anything.
3. **Step-by-Step Fix**: Sequential remediation instructions with runnable CLI commands and expected terminal outputs.
4. **Still Not Working?**: Contingency options and decision trees providing concrete fallback commands if the primary fix doesn't resolve the issue.
5. **Prevention Tip**: Recommended alerting rule (e.g. in Sentry, BetterStack, or Cloudflare) to prevent repeat incidents.
6. **One-Click Summary**: Clean markdown export ready to paste into Jira, ServiceNow, or Slack.

---

## ⚡ 3-Tier Multi-Model Resilience

ErrorLens is engineered with three fallback layers so outages on any single provider never break the tool:

```
┌─────────────────────────────────────────────────────────────┐
│  User Query (Any Error, Code, Log, or Stack Trace)         │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────▼───────────────┐
               │   Cloudflare D1 Query Cache   │──[HIT]──> Sub-10ms Response
               └───────────────┬───────────────┘
                               │ [MISS]
                               ▼
               ┌───────────────────────────────┐
               │    Tier 1: Google Gemini      │──[SUCCESS]──> Structured Plan
               │    (Gemini 3.5 Flash-Lite)    │
               └───────────────┬───────────────┘
                               │ [TIMEOUT / 429]
                               ▼
               ┌───────────────────────────────┐
               │  Tier 2: Cloudflare Workers AI│──[SUCCESS]──> Structured Plan
               │      (Llama 3.1 8B Edge)      │
               └───────────────┬───────────────┘
                               │ [OFFLINE]
                               ▼
               ┌───────────────────────────────┐
               │    Tier 3: Domain Fallback    │──[FALLBACK]─> Safe OS/Domain
               │     & Verified Runbooks       │               Diagnostics
               └───────────────────────────────┘
```

---

## 💰 How It Stays 100% Free

Every component operates within published free-tier allowances:

- **Cloudflare Workers**: 100,000 requests/day.
- **Cloudflare D1**: 100,000 row writes/day and 5,000,000 row reads/day.
- **Google AI Studio**: 15 requests/minute and 1,000 requests/day on the free tier (no credit card needed).
- **Edge Caching**: Identical queries return immediately from the D1 cache, preserving AI quotas for unique queries.
- **Rate Limiting**: Sliding-window rate limiting (5 req/min, 30 req/day per IP) stops bot abuse.

---

## 🚀 Running Locally

```bash
# 1. Clone the repository
git clone https://github.com/Harshil8136/ErrorLens.git
cd ErrorLens

# 2. Install dependencies
npm install

# 3. Configure secrets
cp worker/.dev.vars.example worker/.dev.vars
# Add your free Google AI Studio key from https://aistudio.google.com/apikey

# 4. Start development servers
npm run dev              # Worker API on http://localhost:8787
npm run dev:frontend     # Preact UI on http://localhost:5173
```

---

## 🌐 Deploying to Cloudflare

```bash
# 1. Create D1 database and Vectorize index
npx wrangler d1 create errorlens-db
npx wrangler vectorize create errorlens-vectors --dimensions=384 --metric=cosine

# 2. Set your production secrets
npx wrangler secret put GEMINI_API_KEY   # from aistudio.google.com/apikey
npx wrangler secret put ADMIN_TOKEN      # your admin dashboard password
npx wrangler secret put IP_HASH_SALT     # random string for IP hashing

# 3. Apply database migrations
npx wrangler d1 migrations apply errorlens-db --remote

# 4. Build and deploy
npm run build
npm run deploy
```

---

## 📁 Repository Structure

```
├── worker/               # Cloudflare Worker backend
│   ├── src/
│   │   ├── index.ts      # Router, rate limiter, security headers
│   │   ├── core/         # AI providers, prompts, RAG, cache, schema
│   │   ├── storage/      # D1 client, rate limits, logs, usage
│   │   └── admin/        # Observability dashboard and API
│   └── migrations/       # SQL migrations for D1 schema
├── frontend/             # Lightweight Preact UI (no heavy frameworks)
│   └── src/
│       ├── App.tsx       # Search and incident triage interface
│       ├── api.ts        # Client API layer
│       └── components/   # Modular result and terminal components
├── shared/               # Shared TypeScript types between worker and frontend
├── datasets/             # Verified SOP runbooks and compilation scripts
└── wrangler.jsonc        # Root Cloudflare deployment configuration
```

---

## 👤 Author

**Harshil Panchal**  
NOC / IT Support Analyst • Infrastructure Monitoring & Incident Response

- LinkedIn: [linkedin.com/in/pharshil](https://www.linkedin.com/in/pharshil/)
- Email: [Harshil.8136@gmail.com](mailto:Harshil.8136@gmail.com)

---

## 📄 License

MIT. See [LICENSE](LICENSE) for details.
