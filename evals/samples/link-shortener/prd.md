# Link Shortener

## Overview

An internal service that turns long URLs into short links on `go.acme.dev`, so teams can share links in chat and slides.

## Technical Requirements

These are fixed; do not propose alternatives.

- Go 1.23, standard library `net/http` only (no web framework).
- PostgreSQL 16 for links and click counts, migrations with `golang-migrate`.
- Redis 7 as a read-through cache for lookups.
- Ships as one Docker image; runs on the existing Kubernetes cluster with a Helm chart.
- Sign-in through the company's existing OIDC provider (Okta).

## Features

### Create a short link

A signed-in user submits a URL and optionally a custom slug (3–32 characters, letters, digits and hyphens). Without a slug the service generates a 7-character one. Reserved slugs (`api`, `admin`, `health`) are refused. A slug already taken returns a clear error.

### Redirect

`GET /<slug>` answers with a 302 to the target URL. Lookups hit Redis first and fall back to PostgreSQL. An unknown slug shows a 404 page with a link to create it. Redirects must answer in under 20 ms at p99 from cache.

### Click counts

Each redirect increments the link's click count. Counting must not slow the redirect: counts can lag up to a minute.

### Manage links

Owners see their links with click counts, can change the target URL, and can delete a link. Deleting a link frees its slug after 30 days.

## Non-functional Requirements

- 500 redirects per second per pod.
- Structured JSON logs and Prometheus metrics for redirect latency and cache hit rate.
- Zero-downtime deploys.

## Out of Scope

Public (unauthenticated) link creation, QR codes, and per-click analytics such as referrers or geography.
