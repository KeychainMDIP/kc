# Agent Guide

This directory is the canonical starting point for AI agents working in this
repository. Read these documents before making changes:

1. [Architecture](architecture.md) explains the repository layout, ownership
   boundaries, and main data flows.
2. [Development](development.md) explains how to investigate, implement, test,
   document, and validate changes.

The root [AGENTS.md](../AGENTS.md) is the short cross-agent entry point. Keep
tool-specific files minimal: load or point to these documents when the tool
supports it, and repeat only essential guardrails when it does not.

## Existing Sources

- [README.md](../README.md): project overview, supported runtime, and node setup.
- [CONTRIBUTING.md](../CONTRIBUTING.md): contribution and pull-request process.
- Component READMEs: package, service, application, SDK, and demo usage.
- [Gatekeeper OpenAPI](../doc/gatekeeper-api.json) and
  [Keymaster OpenAPI](../doc/keymaster-api.json): generated REST API references.
- [Unit-test workflow](../.github/workflows/unit-test.yml): required root CI
  commands.

Do not copy detailed deployment configuration, public APIs, or component usage
into these files. Link to their maintained source instead. If this guide
disagrees with the code, tests, CI, or a component README, verify the current
behavior and correct the stale documentation in the same change.

## Reading A Task

Before editing, locate the owning component, then read its README, public
types, implementation, callers, and existing tests. Start with the repository
map rather than assuming the directory named in an issue owns the behavior.
