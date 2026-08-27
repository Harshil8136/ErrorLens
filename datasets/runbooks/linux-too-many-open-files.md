---
slug: linux-emfile-too-many-open-files
category: linux
error_code: EMFILE
title: Too many open files (EMFILE)
tags: [linux, emfile, ulimit, file descriptors, nofile, systemd, sockets]
source_url: https://man7.org/linux/man-pages/man2/open.2.html
verified_at: 2026-08-26
---

# Too many open files (EMFILE)

## Summary

A process hit its file-descriptor limit. Every new file, socket or pipe it tries
to open fails with `EMFILE`, so the symptom is usually a service that accepts no
new connections while the process itself keeps running.

## Root Cause

Each process has a limit on concurrently open descriptors, reported by
`ulimit -n` and enforced as `RLIMIT_NOFILE`. Sockets count, so a busy server or
one that leaks connections reaches the limit even with few actual files open.

Two things commonly get confused here. The soft limit is what applies and can be
raised by the process up to the hard limit. And a service started by systemd does
not inherit your shell's limits at all — it gets whatever `LimitNOFILE` says in
its unit, which is why raising `ulimit -n` in a terminal appears to do nothing.

## Diagnostic Command

```bash
cat /proc/$(pgrep -f <process-name> | head -1)/limits | grep -i "open files"
```

## Triage Steps

### 1. Read the limit the running process actually has

Not the shell's limit, and not the unit file's intent. This is what the kernel is enforcing right now.

```bash
cat /proc/<pid>/limits | grep -i "open files"
```

**Expected:** Soft and hard values. A soft limit of 1024 is the common default and is low for any network service.

### 2. Count what the process currently holds

Tells you whether you are near the ceiling or something is leaking.

```bash
ls /proc/<pid>/fd | wc -l
```

**Expected:** A number close to the soft limit confirms exhaustion. Watch it over a minute: steadily climbing under constant load means a leak, not an undersized limit.

### 3. Find what kind of descriptor is being held

A leak of sockets points at connection handling; a leak of regular files points at unclosed handles.

```bash
ls -l /proc/<pid>/fd | awk '{print $NF}' | sed 's/:.*//' | sort | uniq -c | sort -rn | head
```

**Expected:** A dominant type. Large counts of socket entries usually mean connections are not being closed or pooled.

### 4. Raise the limit for a systemd service

Editing limits.conf does not affect systemd units; the unit file is the only thing that matters here.

```bash
systemctl edit <service-name>
```

**Expected:** An override editor. Add LimitNOFILE=65535 under a [Service] section, then reload and restart the unit.

### 5. Apply the change and confirm it took

The unit has to be reloaded and restarted, and it is worth re-reading the live limit rather than assuming.

```bash
systemctl daemon-reload && systemctl restart <service-name> && cat /proc/$(systemctl show -p MainPID --value <service-name>)/limits | grep -i "open files"
```

**Expected:** The new soft limit. If it still shows the old value, the override did not apply to the unit you restarted.
