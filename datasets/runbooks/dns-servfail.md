---
slug: dns-servfail-resolution-failure
category: networking
error_code: SERVFAIL
title: DNS query returns SERVFAIL
tags: [dns, servfail, dnssec, resolver, dig, nxdomain, delegation]
source_url: https://www.rfc-editor.org/rfc/rfc9499.html
verified_at: 2026-08-26
---

# DNS query returns SERVFAIL

## Summary

The resolver tried to answer and could not. Unlike `NXDOMAIN`, which is a
definitive "this name does not exist", `SERVFAIL` means the resolution process
itself broke — so the name may well be fine and something between you and the
authoritative servers is not.

## Root Cause

A recursive resolver returns SERVFAIL when it cannot produce a trustworthy
answer. The usual causes are a DNSSEC validation failure, authoritative
nameservers that are unreachable or timing out, or a broken delegation where the
parent zone points at nameservers that do not serve the zone.

The distinction from NXDOMAIN matters for triage. NXDOMAIN is an answer and
means fix the name. SERVFAIL is the absence of one and means fix the
infrastructure — often somebody else's.

## Diagnostic Command

```bash
dig +trace <domain> A
```

## Triage Steps

### 1. Confirm the status and rule out one bad resolver

If a public resolver answers cleanly, the problem is local rather than in the zone.

```bash
dig <domain> A @1.1.1.1 +noall +comments
```

**Expected:** status: NOERROR. If this returns SERVFAIL too, the problem is upstream and not with your resolver.

### 2. Walk the delegation from the root

Shows exactly which level of the hierarchy stops answering.

```bash
dig +trace <domain> A
```

**Expected:** A clean walk from root to TLD to the zone's nameservers. The last level that responds is the last one working.

### 3. Test whether DNSSEC validation is the cause

Asking for the answer with validation disabled isolates DNSSEC from everything else.

```bash
dig <domain> A @1.1.1.1 +cd +noall +comments
```

**Expected:** If +cd (checking disabled) returns NOERROR while the normal query returns SERVFAIL, this is a DNSSEC validation failure, usually a stale DS record after a key rollover.

### 4. Query the authoritative nameservers directly

Bypasses recursion entirely, so a failure here means the zone's own servers are the problem.

```bash
dig <domain> NS +short
```

**Expected:** The zone's nameservers. Query the domain against each one in turn; a server that times out or refuses is the one to chase.

### 5. Check the parent's delegation matches the zone

A mismatch between what the parent publishes and what the zone serves produces intermittent SERVFAIL.

```bash
dig <domain> NS @$(dig <tld> NS +short | head -1)
```

**Expected:** The same nameserver set the zone itself reports. Any difference is a stale delegation at the registrar.
