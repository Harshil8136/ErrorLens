# 🏛️ ErrorLens Architecture & RAG Pipeline Deep Dive

This document details the internal engineering, data structures, and edge-native optimization strategies implemented in ErrorLens.

---

## 1. Hybrid RAG Retrieval Engine

Traditional RAG systems typically rely exclusively on vector embeddings. While dense vectors excel at semantic similarity (e.g. mapping "container ran out of memory" to "RAM exhaustion"), they perform poorly with exact strings, error codes, exit statuses, and hex addresses (e.g. `Exit Code 137`, `502`, `0x80004005`, `ERR_OSSL_EVP_UNSUPPORTED`).

ErrorLens implements a **Dual-Engine Hybrid Search** with **Reciprocal Rank Fusion (RRF)**:

```
                      User Query: "Docker container exit 137"
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
     [ D1 SQLite FTS5 Search ]                [ Dense Semantic Search ]
     • BM25 Porter Stemmer                    • Workers AI BGE-small-en-v1.5
     • Exact token prefix matching            • 384-dimensional vector
     • Output: Ranked FTS results             • Output: Ranked Cosine results
                 │                                         │
                 └────────────────────┬────────────────────┘
                                      ▼
                      [ Reciprocal Rank Fusion (RRF) ]
                       Score = Σ (1 / (60 + Rank_i))
                                      │
                                      ▼
                      [ Top Grounded Runbook Context ]
```

### Reciprocal Rank Fusion (RRF) Algorithm
We apply the standard Information Retrieval RRF scoring function:
$$RRF(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$
Where $k = 60$ (standard smoothing constant) and $r_m(d)$ is the 1-based rank of document $d$ within search engine $m$.

---

## 2. Zero-Cost Edge Cache & Abuse Shield

To operate sustainably on free-tier services in public open-source environments:

### Normalized Query Hashing
Queries are normalized before hashing:
1. Punctuation and noise characters are stripped.
2. Multiple whitespaces are collapsed.
3. Strings are lowercased and passed through SHA-256 via the Web Cryptography API (`crypto.subtle.digest`).
4. The first 32 characters form the unique cache key.

### Sliding-Window IP Rate Limiter
1. Client IP address from Cloudflare's `CF-Connecting-IP` header is salted and hashed (preserving GDPR/privacy compliance).
2. Per-minute buckets (`window_minute = timestamp / 60`) track request velocity.
3. If an IP exceeds 5 requests/minute or 30 requests/day, HTTP 429 is returned with an explicit `Retry-After` header.

---

## 3. Dual-Tier LLM Generation & Offline Resiliency

ErrorLens guarantees high availability through a 3-stage fallback pipeline:

1. **Tier 1: Google AI Studio (Gemini 2.5 Flash-Lite)**
   - Low temperature (`0.2`) for deterministic code generation.
   - Structured JSON output mode enforced via `responseMimeType: "application/json"`.
2. **Tier 2: Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`)**
   - Triggers automatically if Gemini returns HTTP 429 (rate-limited) or fails network resolution.
   - Runs directly on Cloudflare GPU edge nodes at zero marginal cost.
3. **Tier 3: Deterministic Offline Catalog**
   - If all AI providers fail or during offline local development, the system directly synthesizes the matched D1 runbook steps into the standard schema.
   - **Zero 500 errors**: The system always delivers actionable troubleshooting steps to the user.
