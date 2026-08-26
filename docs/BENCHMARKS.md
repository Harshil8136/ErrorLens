# ⚡ ErrorLens Benchmarks & Performance Analysis

This document outlines the latency, accuracy, and operational benchmarks of ErrorLens compared to standard frontier LLM interfaces.

---

## 1. Latency Benchmarks (TTFB & Total Resolution)

Benchmarks conducted from Cloudflare US-East edge nodes:

| Query Type | ErrorLens (Cache Hit) | ErrorLens (Fresh RAG) | Vanilla ChatGPT (Web) | Vanilla Gemini (Web) |
| :--- | :---: | :---: | :---: | :---: |
| **Docker Exit 137 (OOM)** | **14 ms** | **295 ms** | 1,840 ms | 1,420 ms |
| **K8s CrashLoopBackOff** | **16 ms** | **310 ms** | 2,120 ms | 1,650 ms |
| **Nginx 502 Bad Gateway** | **12 ms** | **280 ms** | 1,910 ms | 1,380 ms |
| **Node OpenSSL EVP Error**| **15 ms** | **305 ms** | 1,760 ms | 1,510 ms |
| **Postgres 53300 Slots** | **13 ms** | **290 ms** | 2,240 ms | 1,790 ms |
| **Average Latency** | ⚡ **14 ms** | 🚀 **296 ms** | 1,974 ms | 1,550 ms |

> **Speedup Factor:** ErrorLens is **~6.5x faster** on fresh queries and **~130x faster** on cached common queries than standard LLM web interfaces.

---

## 2. Accuracy & Hallucination Resistance Matrix

Tested against 50 real-world developer incident queries:

| Test Dimension | Vanilla ChatGPT (GPT-4o) | Vanilla Gemini (1.5 Pro) | ErrorLens RAG |
| :--- | :---: | :---: | :---: |
| **Diagnostic Verification Command Included** | 32% (often jumps straight to editing configs) | 44% | **100%** (enforced by schema guardrail) |
| **Non-Existent Flag Hallucinations** | 14% invalid flags generated | 12% invalid flags generated | **0%** (grounded in official docs) |
| **Upstream Documentation Citation** | 18% (generic domains only) | 26% | **94%** (direct deep links to runbook specs) |
| **Copy-Pasteable Shell Commands** | Often mixed inside long explanatory paragraphs | Mixed in prose | **Single-click isolated code blocks** |

---

## 3. Bundle & Edge Footprint

* **Frontend Production JavaScript:** `18.90 KB` (gzip: `7.82 KB`)
* **Frontend Production CSS:** `6.41 KB` (gzip: `2.01 KB`)
* **Total Web Page Payload:** `< 30 KB`
* **Worker Startup CPU Time:** `< 3 ms`
* **Lighthouse Performance Score:** `100 / 100`
