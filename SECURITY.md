# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub:

1. Go to the [Security tab](https://github.com/stephennmiller/taskgraph-ai/security) of this repository.
2. Choose **Report a vulnerability** to open a private advisory.

Include the affected version (`taskgraph --version`), steps to reproduce, and the impact you see. If you can, say whether the problem needs a malicious `tasks.json`, PRD file, or MCP client to trigger.

## What to expect

This is a single-maintainer project. I aim to acknowledge a report within 7 days and to share a fix or a plan within 30 days. Fixes ship as a patch release, and the advisory credits the reporter unless you ask otherwise.

## Supported versions

Only the latest published release of `taskgraph-ai` receives security fixes.

## Scope

In scope: the `taskgraph` CLI, the `taskgraph-mcp` server, and the Claude Code plugin in this repository.

Out of scope: vulnerabilities in third-party dependencies with no exploitable path through TaskGraph (report those upstream), and issues that need an attacker who already controls your machine or your Claude Code session.
