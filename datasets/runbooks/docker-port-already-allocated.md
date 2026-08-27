---
slug: docker-port-is-already-allocated
category: docker
error_code: port is already allocated
title: Bind for 0.0.0.0:PORT failed - port is already allocated
tags: [docker, port, bind, eaddrinuse, compose, publish]
source_url: https://docs.docker.com/engine/network/
verified_at: 2026-08-26
---

# Bind for 0.0.0.0:PORT failed - port is already allocated

## Summary

Docker cannot publish a container port because something on the host is already
listening on it. The container never starts, and `docker ps` shows nothing new.

## Root Cause

Publishing a port makes the Docker daemon bind it on the host. If any process
already holds that host port the bind fails, and the daemon reports the whole
container start as failed.

The awkward case is when the holder is a stopped-but-not-removed container.
Docker keeps the port reservation for containers in the `created` or `exited`
state that were started with a published port, so `docker ps` looks clean while
`docker ps -a` shows the culprit.

## Diagnostic Command

```bash
docker ps -a --filter "publish=<port>" --format "{{.ID}}\t{{.Status}}\t{{.Names}}"
```

## Triage Steps

### 1. Check whether a container is holding the port

Covers the stopped-container case that a plain docker ps hides.

```bash
docker ps -a --filter "publish=<port>" --format "{{.ID}}\t{{.Status}}\t{{.Names}}"
```

**Expected:** Any container listed here holds the reservation, including ones with an Exited status.

### 2. If no container matches, find the host process

The port may belong to something outside Docker entirely.

```bash
sudo ss -tulpn | grep :<port>
```

**Expected:** The listening PID and program name. A dockerd or docker-proxy entry means Docker still owns it; anything else is a host service.

### 3. Remove the stale container

Stopping is not enough when the container still exists; the reservation goes with the container.

```bash
docker rm -f <container-id>
```

**Expected:** The container ID echoed back. Re-run the diagnostic and the port should now be free.

### 4. If it is a host service, pick a different host port

Changing the host side leaves the container's own port untouched, so nothing inside the image needs to change.

```bash
docker run -p 8081:8080 <image>
```

**Expected:** The container starts. The left number is the host port and the right is the container port, so only the host side moved.

### 5. For Compose, recreate rather than restart

Restart reuses the existing container and its reservation; down and up rebuilds the port mapping.

```bash
docker compose down --remove-orphans && docker compose up -d
```

**Expected:** Services come up cleanly. --remove-orphans clears containers left behind by a previous compose file.
