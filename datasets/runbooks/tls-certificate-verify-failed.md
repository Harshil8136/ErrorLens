---
slug: tls-unable-to-get-local-issuer-certificate
category: networking
error_code: unable to get local issuer certificate
title: TLS verification fails with unable to get local issuer certificate
tags: [tls, ssl, certificate, ca, openssl, curl, chain, intermediate]
source_url: https://curl.se/docs/sslcerts.html
verified_at: 2026-08-26
---

# TLS verification fails with unable to get local issuer certificate

## Summary

The client can reach the server and negotiate TLS, but cannot build a trust
chain from the presented certificate up to a CA it trusts. Browsers often work
while curl, Node or Python fail on the same URL.

## Root Cause

Verification needs the full chain: leaf, any intermediates, then a root the
client already trusts. Servers are supposed to send the leaf plus intermediates;
the root comes from the client's trust store.

When a server is misconfigured to send only the leaf, browsers frequently paper
over it — they cache intermediates from previous sessions and can fetch missing
ones via the AIA extension. Most command-line clients do neither, which is why
the same endpoint works in Chrome and fails in curl. The other common cause is a
TLS-intercepting proxy presenting its own root that the client has never seen.

## Diagnostic Command

```bash
openssl s_client -connect <host>:443 -servername <host> -showcerts < /dev/null
```

## Triage Steps

### 1. Look at how many certificates the server actually sends

This distinguishes an incomplete chain from a trust-store problem in one step.

```bash
openssl s_client -connect <host>:443 -servername <host> -showcerts < /dev/null 2>/dev/null | grep -c "BEGIN CERTIFICATE"
```

**Expected:** Two or more for a normal chain. Exactly one means the server is sending only the leaf and is misconfigured.

### 2. Read the verify result and the chain order

Names the exact link that could not be resolved.

```bash
openssl s_client -connect <host>:443 -servername <host> < /dev/null 2>/dev/null | grep -E "Verify return code|^ *[0-9] s:|^ *[0-9] i:"
```

**Expected:** Verify return code 0 (ok) when healthy. Code 20 is the unable-to-get-local-issuer case; each s:/i: pair shows a subject and its issuer.

### 3. Check whether a proxy is intercepting

An unexpected corporate or security-appliance issuer explains failures that only happen on one network.

```bash
openssl s_client -connect <host>:443 -servername <host> < /dev/null 2>/dev/null | grep "issuer="
```

**Expected:** A public CA. A company or appliance name means traffic is being intercepted, and that CA has to be added to the client's trust store.

### 4. Confirm the client is reading the trust store you think it is

Language runtimes frequently ship their own CA bundle instead of the system one.

```bash
curl -sSv https://<host> 2>&1 | grep -iE "CAfile|CApath"
```

**Expected:** A path to a CA bundle. Node uses its own bundled roots unless NODE_EXTRA_CA_CERTS is set; Python requests uses certifi's.

### 5. Fix the server rather than the clients where you can

Serving the intermediates fixes every client at once, instead of adding exceptions to each one.

```bash
cat leaf.crt intermediate.crt > fullchain.crt
```

**Expected:** A bundle with the leaf first and intermediates after. Point the server at this file, reload, and re-run step 1 to confirm the count went up.
