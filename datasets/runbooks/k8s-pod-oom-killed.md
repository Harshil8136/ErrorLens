---
slug: k8s-pod-oom-killed
category: kubernetes
error_code: OOMKilled
title: Pod terminated with OOMKilled (exit code 137)
tags: [kubernetes, oom, cgroups, memory, limits, sigkill, 137]
source_url: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
verified_at: 2026-08-26
---

# Pod terminated with OOMKilled (exit code 137)

## Summary
The kernel killed the container because it exceeded the memory limit set in
`resources.limits.memory`, or because the node itself ran out of memory. The pod
shows a `lastState.terminated.reason` of `OOMKilled` and an exit code of 137.

## Root Cause
When a cgroup reaches its hard memory limit, the Linux OOM killer sends SIGKILL
to the offending process. SIGKILL is signal 9, and a process terminated by a
signal reports `128 + signal`, which is where 137 comes from. The container is
killed outright, so there is no graceful shutdown and no application-level error
to find in the logs.

Two distinct cases produce the same exit code: the container exceeded its own
limit, or the node came under memory pressure and the kubelet evicted it. The
first shows `OOMKilled` on the container; the second shows an `Evicted` pod
status.

## Diagnostic Command
```bash
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.status.containerStatuses[*].lastState.terminated.reason}'
```

## Triage Steps

### 1. Confirm the kernel killed it rather than the app exiting
Distinguishes an OOM kill from an ordinary non-zero exit, which needs a
completely different investigation.

```bash
kubectl describe pod <pod-name> -n <namespace> | grep -E "Reason|Exit Code|Limits|Requests"
```

**Expected:** Reason is OOMKilled and Exit Code is 137. If the reason is Error, this is not an OOM problem.

### 2. Check what the container was actually using
Tells you whether the limit is too low for normal load or the process is leaking.

```bash
kubectl top pod <pod-name> -n <namespace> --containers
```

**Expected:** Memory near the configured limit. A steady climb across restarts points to a leak rather than an undersized limit.

### 3. Check whether the node was under pressure
If the node is short on memory, raising the pod limit makes things worse rather than better.

```bash
kubectl describe node <node-name> | grep -A 5 "Conditions:"
```

**Expected:** MemoryPressure is False. If it is True, the node is the problem and the pod is a symptom.

### 4. Give the runtime headroom inside the limit
A JVM or Node heap sized to the container limit leaves nothing for thread stacks, metaspace and buffers, so the process is killed while the heap still looks healthy.

```bash
kubectl set env deployment/<deployment-name> NODE_OPTIONS="--max-old-space-size=1536"
```

**Expected:** Heap ceiling sits around 75% of the container limit, leaving room for non-heap memory.

### 5. Raise the limit once you know the real ceiling
Only after the previous steps, so you are sizing against measured usage rather than guessing.

```bash
kubectl set resources deployment/<deployment-name> --limits=memory=2Gi --requests=memory=1Gi
```

**Expected:** Pod restarts and stays Running. Setting requests below limits lets the scheduler pack nodes without over-committing.
