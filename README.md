<div align="center">

# ⚡ ErrorLens

**Deterministic, Edge-Native DevOps & Cloud Troubleshooting Engine**  
*Instant diagnostic decision trees and validated remediation &mdash; 100% Free Tier on Cloudflare + Google AI Studio.*

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![D1 Database](https://img.shields.io/badge/Storage-D1_FTS5-orange?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Vectorize](https://img.shields.io/badge/RAG-Vectorize_+_BGE-blue)](https://developers.cloudflare.com/vectorize/)
[![Google AI Studio](https://img.shields.io/badge/LLM-Gemini_2.5_Flash--Lite-4285F4?logo=google&logoColor=white)](https://aistudio.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Zero Cost](https://img.shields.io/badge/Cloud_Bill-$0.00/mo-success)](#-100-free-tier-cost-architecture)

<br />

[Live Demo](https://errorlens.pages.dev) &bull; [Architecture Deep Dive](docs/ARCHITECTURE.md) &bull; [Benchmarks vs ChatGPT](docs/BENCHMARKS.md) &bull; [Submit a Runbook](CONTRIBUTING.md)

</div>

---

## 💡 The Problem: Why Generic AI Fails at Troubleshooting

When developers and SREs hit cryptic errors in production (`Docker Exit Code 137`, `CrashLoopBackOff`, `ERR_OSSL_EVP_UNSUPPORTED`, `502 Bad Gateway`), generic LLMs like ChatGPT and Gemini often:
1. **Hallucinate Non-Existent Flags**: Invent invalid CLI parameters and deprecated flags.
2. **Miss Error Anchors**: Fail to map exact error codes to verified community workarounds.
3. **Generate Passive Walls of Text**: Produce 10 unranked paragraphs instead of **diagnostic decision trees** (*"Step 1: Run check command X. If output contains Y, do A; if output contains Z, do B"*).

**ErrorLens** solves this by pairing a **Hybrid RAG engine (D1 FTS5 lexical BM25 + Vectorize dense cosine search)** with structured triage guardrails, delivering verified, copy-pasteable terminal commands within sub-second latencies.

---

## ⚔️ Feature Comparison: ErrorLens vs. Vanilla ChatGPT / Gemini

| Capability | Generic LLM (ChatGPT / Gemini) | ErrorLens Engine |
| :--- | :---: | :---: |
| **Step 1 Verification** | ❌ Jumps straight to random guesses | ✅ **Mandatory diagnostic command** to verify root cause before making changes |
| **Flag Accuracy** | ⚠️ Frequently hallucinates CLI flags | ✅ **Grounded in official documentation & battle-tested runbooks** |
| **Response Latency** | 1,500 ms – 3,500 ms | ⚡ **15 ms (Cache Hit)** / **280 ms (Fresh RAG)** |
| **Interactive Triage** | ❌ Static text explanation | ✅ **Step-by-step decision flow with 1-click copy** |
| **Infrastructure Cost** | Paid API credits ($20–$200/mo) | 💚 **100% Free Forever ($0.00/mo)** |
| **Upstream Verification** | ❌ No direct documentation link | ✅ **Direct links to verified docs (K8s, Docker, Nginx, Node)** |

---

## 🏗️ System Architecture

ErrorLens runs completely within Cloudflare's global edge network and Google AI Studio's free tier:

```
                           [ Web Browser / Developer ]
                                        │
                         HTTPS Request / Search Query
                                        │
                                        ▼
                  ┌───────────────────────────────────────────┐
                  │   Cloudflare Pages / Worker Assets        │
                  │   • Preact 10 + Tailwind CSS (< 20KB JS)  │
                  │   • 0ms Cold Start, Global Edge CDN       │
                  └─────────────────────┬─────────────────────┘
                                        │
                                        ▼
                  ┌───────────────────────────────────────────┐
                  │   Cloudflare Edge Worker (100k req/day)   │
                  │                                           │
                  │   1. Sliding-Window Rate Limiter (D1/KV)  │
                  │      ↳ 5 req/min, 30 req/day per IP       │
                  │                                           │
                  │   2. Zero-Cost Normalized Query Cache     │
                  │      ↳ 15ms hit latency, $0 compute       │
                  │                                           │
                  │   3. Hybrid RAG Search (RRF Fusion)       │
                  │      ↳ D1 FTS5 (BM25 lexical search)      │
                  │      ↳ Vectorize + Workers AI (BGE-small) │
                  │                                           │
                  │   4. Dual-Tier LLM Generation             │
                  │      ↳ Primary: Gemini 2.5 Flash-Lite     │
                  │      ↳ Fallback: Workers AI Llama 3.1 8B  │
                  │      ↳ Catalog: Zero-LLM Offline Match    │
                  └───────────────────────────────────────────┘
```

---

## 💰 100% Free-Tier Cost Architecture

ErrorLens is engineered from the ground up to never generate surprise bills:

| Service | Free Tier Allowance | Project Consumption | Monthly Cost |
| :--- | :--- | :--- | :---: |
| **Cloudflare Workers** | 100,000 requests / day | ~10,000 requests / day | **$0.00** |
| **Cloudflare D1 (SQLite)** | 5M reads / day, 100k writes / day, 5GB storage | ~50,000 reads / day | **$0.00** |
| **Cloudflare Vectorize** | 30M queried dimensions / month | ~25,000 queries / month | **$0.00** |
| **Cloudflare Workers AI** | 10,000 Neurons / day | Embeddings & failover Llama | **$0.00** |
| **Cloudflare Pages** | Unlimited bandwidth & requests | Static Single Page App | **$0.00** |
| **Google AI Studio** | 15 RPM, 1,500 Requests / Day | Controlled via Edge Rate Limiter | **$0.00** |
| **TOTAL** | &mdash; | &mdash; | **$0.00 / mo** |

---

## 🚀 Quickstart & Local Development

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/errorlens.git
cd errorlens
npm install
```

### 2. Configure Environment Variables
Inside `worker/.dev.vars`, add your free Google AI Studio API key (obtainable at [aistudio.google.com](https://aistudio.google.com)):
```ini
GEMINI_API_KEY=AIzaSyYourFreeGoogleApiKeyHere
```

### 3. Initialize Local D1 Database & Run Migrations
```bash
cd worker
npx wrangler d1 migrations apply errorlens-db --local
```

### 4. Start Local Development Environment
```bash
# Start Worker API (Port 8787)
npm run dev --workspace=worker

# In a separate terminal, start Frontend (Port 3000)
npm run dev --workspace=frontend
```
Open `http://localhost:3000` in your browser.

---

## 🚢 One-Click Cloudflare Deployment

```bash
# 1. Create your free remote D1 database
npx wrangler d1 create errorlens-db

# 2. Apply migrations to Cloudflare D1
npx wrangler d1 migrations apply errorlens-db --remote

# 3. Create your free Vectorize index (384 dimensions for BGE-small)
npx wrangler vectorize create errorlens-vectors --dimensions=384 --metric=cosine

# 4. Set your Google AI Studio key as a secret
npx wrangler secret put GEMINI_API_KEY

# 5. Build frontend and deploy full stack to edge
npm run build --workspace=frontend
npm run deploy --workspace=worker
```

---

## 🤝 Contributing New Runbooks

Have a recurring bug or incident runbook you want to add?
1. Check out [`CONTRIBUTING.md`](CONTRIBUTING.md).
2. Add a new markdown file to `datasets/runbooks/<slug>.md`.
3. Run `node datasets/scripts/ingest.js` to compile it to SQL.
4. Submit a Pull Request!

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
