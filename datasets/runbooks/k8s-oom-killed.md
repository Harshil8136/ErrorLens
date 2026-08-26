---
slug: k8s-pod-oom-killed
category: kubernetes
error_code: OOMKilled / Exit Code 137
title: Pod Terminated with OOMKilled (Exit Code 137)
tags: [kubernetes, oom, cgroups, memory, limits, requests]
source_url: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
---

# Pod Terminated with OOMKilled (Exit Code 137)

## Summary
The Linux kernel killed the container process because it exceeded its container memory limits configured in `resources.limits.memory` (or the host node exhausted its memory).

## Root Cause
When cgroup memory usage hits the hard limit set in the Pod specification, Linux triggers the kernel Out-Of-Memory (OOM) killer. The kernel sends SIGKILL (9) to the primary container process, terminating it immediately with exit code 128 + 9 = 137.

## Diagnostic Command
```bash
kubectl describe pod <pod-name> -n <namespace> | grep -E "(OOMKilled|Exit Code|Limits|Requests)"
```

## Triage Steps
1. **Verify OOM status**: Check pod status with `kubectl get pod <pod-name> -o jsonpath='{.status.containerStatuses[*].lastState.terminated.reason}'` (Confirm it says `OOMKilled`).
2. **Review Memory Metrics**: Run `kubectl top pod <pod-name> --containers` to observe memory consumption leading up to the crash.
3. **Inspect JVM / Node Heap Settings**: Verify that application heap ceilings (e.g. `-Xmx`, `--max-old-space-size`) leave at least 25% headroom for non-heap native memory (metaspace, thread stacks, buffers).
4. **Adjust Kubernetes Resource Limits**: Bump `resources.limits.memory` in the Deployment manifest to accommodate legitimate load spikes.
