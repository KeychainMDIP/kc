# Development Workflow

## Before Editing

1. Run `git status --short` and preserve unrelated user changes.
2. Read the owning component's README, public types, implementation, callers,
   and existing tests.
3. Confirm whether the behavior belongs in a core package or in a transport,
   API, projection, or UI adapter.
4. Prefer existing helpers and patterns. Keep the change scoped to the stated
   behavior and avoid unrelated refactors.

Never reset or delete existing persistent runtime data, SSH to or operate
deployment hosts, run live network synchronization, publish packages, or
create releases unless the user asks explicitly. Tests may create and reset
their own isolated fixtures. Do not expose secrets from `.env`; use
`sample.env` for documented configuration.

## TypeScript Imports

Core packages and Node services use NodeNext module resolution. Keep `.js`
extensions on their relative imports in TypeScript so the emitted JavaScript
resolves correctly. Browser applications and clients are bundled separately;
follow the import convention in the project being changed rather than
normalizing imports across the repository.

## Tests And Validation

Behavior changes require a focused regression test in the matching `tests/`
area. Test the public behavior and failure mode, not only implementation
details or coverage lines. Reuse existing fixtures and helpers where possible.

For a fresh checkout, install root dependencies with `npm ci`. From the
repository root, the standard checks are:

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

During development, pass a test path to the root Jest command, for example:

```bash
npm test -- --runTestsByPath tests/gatekeeper/crud.test.ts
```

Run the full suite for shared package, protocol, persistence, or cross-service
changes. The root build compiles the npm workspaces in `packages/`; standalone
services, apps, and demos have their own `package.json` commands. Install their
dependencies and run their local build or typecheck when changing them.

Run Java tests with `(cd java && ./gradlew test)`. The Python SDK suite is an
integration test that requires running Gatekeeper and Keymaster services with
the local registry enabled. Follow the
[Python SDK workflow](../.github/workflows/python-sdk-tests.yml), then run
`pytest -q tests/test_keymaster_sdk.py` from `python/keymaster_sdk`.

CLI integration tests have destructive local setup, so follow
`tests/cli-tests/README.md` and run them only when relevant and safe.
The Docker smoke test required before merge is documented in
`CONTRIBUTING.md`; because it changes local state and may join configured
networks, run it only in a confirmed test environment.

## Change Impact

| Change | Expected follow-up |
| --- | --- |
| Gatekeeper validation, resolution, or persistence | Update `tests/gatekeeper`; consider every supported database adapter and Gatekeeper service behavior. |
| Keymaster wallet or identity workflow | Update `tests/keymaster`; review CLI, browser clients, apps, and SDK contracts. |
| REST route or request/response shape | Update API tests and clients; run `npm run generate-openapi`; commit the affected file under `doc/`. |
| Hyperswarm protocol or synchronization | Update protocol, lifecycle, and black-box behavior tests under `tests/hyperswarm`; review rolling-network compatibility. |
| Search projection or metric | Update `tests/search-server`; remember that its database is a rebuildable index. |
| Environment variable or deployment default | Update `sample.env`, `docker-compose.yml`, the relevant service README, and deployment files that expose it. |
| Frontend behavior | Run the local app/client typecheck or build and update existing UI tests where available. |
| Public package or REST contract | Review Java and Python clients and both demos for compatibility. |

## Documentation

Update documentation in the same change when behavior, public APIs,
configuration, commands, architecture, or directory ownership changes:

- Package behavior and usage belong in the package README.
- Service configuration and runtime behavior belong in the service README.
- Public HTTP changes belong in source annotations and generated OpenAPI.
- Repository architecture and development conventions belong in `.agents/`.
- Contributor process belongs in `CONTRIBUTING.md`.

Do not duplicate large API or configuration tables in agent documentation.
Link to the maintained source.

## Completion

Before finishing:

1. Review the diff for scope, compatibility, error handling, and accidental
   generated or unrelated changes.
2. Run the narrowest relevant checks, then broader checks in proportion to the
   change's blast radius.
3. Report which checks passed and any checks that could not be run.
4. Ensure code, tests, documentation, examples, and public clients describe the
   same behavior.
