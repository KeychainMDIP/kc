# Repository Instructions

Keychain is the reference MDIP implementation. Begin with
[`.agents/README.md`](.agents/README.md), then read
[`.agents/architecture.md`](.agents/architecture.md) and
[`.agents/development.md`](.agents/development.md).

## Architecture

- `packages/` contains the reusable core and is the root npm workspace.
- `packages/gatekeeper` owns DID operation validation, histories, persistence,
  and resolution.
- `packages/keymaster` owns wallets, identities, assets, credentials, and
  signed-operation workflows.
- Services, mediators, apps, and SDKs consume the packages. Keep reusable MDIP
  domain behavior in packages and transport, HTTP, projection, and UI
  orchestration in their owning component.
- Read the relevant component README and existing tests before editing.

## Working Rules

- Inspect `git status --short` first and preserve unrelated changes.
- Keep changes narrowly scoped and follow existing patterns.
- Add or update focused behavioral tests whenever behavior changes.
- Update affected READMEs, OpenAPI output, examples, configuration, and SDKs
  when their contract changes.
- Do not wipe existing persistent runtime data, SSH to or operate deployment
  hosts, run live synchronization, publish, or release unless explicitly
  requested. Isolated test fixtures may manage their own state.

## Root Checks

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

Use focused Jest paths while developing. The root build covers `packages/*`;
standalone services and apps may require their own build or typecheck.
