# Repository Architecture

Keychain is the reference implementation of the Multi-Dimensional Identity
Protocol (MDIP). The repository contains reusable protocol libraries,
deployable services, network mediators, applications, SDKs, examples, and
their tests.

## Core Packages

The TypeScript packages under `packages/` are the heart of the software and
the root npm workspaces. Reusable MDIP domain behavior belongs here rather than
being duplicated in a service or user interface. Transport-specific
synchronization, HTTP orchestration, projections, and UIs remain in their
owning service or application.

| Package | Responsibility |
| --- | --- |
| `packages/gatekeeper` | Validates and stores DID operations, maintains DID histories, and resolves DID documents. Gatekeeper is the authority on whether an operation is valid. |
| `packages/keymaster` | Manages wallets, keys, identities, assets, credentials, challenges, and signed operations. It delegates DID storage and resolution to Gatekeeper. |
| `packages/cipher` | Node and browser cryptography, encryption, signatures, and key utilities. |
| `packages/common` | Shared errors, logging, environment handling, and utilities. |
| `packages/ipfs` | Content-addressed storage and IPFS clients/utilities. |
| `packages/inscription` | Creates and fee-bumps Taproot inscription transactions. |

When changing Gatekeeper or Keymaster behavior, begin in these packages even
if the behavior was observed through a REST service, CLI, mediator, or app.
Keep database-specific behavior behind the package's existing adapters.

## Services

`services/` contains processes that expose, transport, or project core data:

| Area | Responsibility |
| --- | --- |
| `services/gatekeeper/server` | Gatekeeper REST API, database selection, runtime loops, and server lifecycle. |
| `services/gatekeeper/client` | Browser wallet served with the Gatekeeper deployment. |
| `services/keymaster/server` | REST API around Keymaster for server wallets and non-TypeScript clients. |
| `services/keymaster/client` | Browser UI for the server-side Keymaster wallet. |
| `services/mediators/hyperswarm` | Exchanges Gatekeeper operations between peers using ordered catch-up and Negentropy reconciliation. It transports operations; Gatekeeper still decides validity. |
| `services/mediators/satoshi` | Exchanges operations through supported Bitcoin-family registries. |
| `services/mediators/satoshi-inscription` | Publishes operation batches as Bitcoin inscriptions. |
| `services/search-server` | Builds a disposable, rebuildable read model from Gatekeeper's index export and exposes search and network metrics. |
| `services/explorer` | React/Vite DID explorer backed by Search Server. |

Do not move core validation or wallet rules into HTTP handlers, mediators, or
search projections. Services should translate protocols, configure core
libraries, and manage process lifecycle.

## Applications And SDKs

- `apps/react-wallet` is the React/Capacitor browser and Android demonstration
  wallet.
- `apps/chrome-extension` packages an MDIP wallet as a Chrome extension.
- `java/` contains Java CID, cryptography, Gatekeeper client, and Keymaster
  libraries, plus a demo. It uses Gradle independently of the npm workspace.
- `python/keymaster_sdk` is the Python client for the Keymaster REST service.
- `demo/commonjs-demo` demonstrates consuming the built npm packages from
  CommonJS.
- `demo/inscription-demo` demonstrates creating Taproot inscriptions.

These consumers may need updates when a public package, REST, operation, or
wallet contract changes. They should not become alternate sources of core
protocol behavior.

## Tests And Supporting Files

- `tests/` contains the root Jest suites, grouped by the production domain:
  `cipher`, `common`, `gatekeeper`, `hyperswarm`, `inscription`, `ipfs`,
  `keymaster`, and `search-server`.
- `tests/cli-tests` contains Docker-backed Expect/Tcl CLI tests with separate
  setup requirements. Read its README before running them.
- `doc/` contains protocol/client documentation and generated Gatekeeper and
  Keymaster OpenAPI JSON.
- `scripts/` contains CLI entry points, operational helpers, release tooling,
  and examples.
- `share/` contains shared sample data and schemas, not application state.
- `data/` contains local container volumes, node configuration, and mediator
  checkpoints. Treat runtime contents as state and do not delete them unless
  explicitly requested.
- `.github/` contains CI and release workflows.
- Root Dockerfiles, `docker-compose.yml`, `sample.env`, and wrappers such as
  `kc`, `admin`, `start-node`, and `stop-node` define and operate the
  containerized deployment.

## Main Data Flows

1. Keymaster constructs and signs operations, then submits them to Gatekeeper.
2. Gatekeeper validates accepted operations, stores DID histories, and exposes
   registry queues and index changes.
3. Mediators carry operations over Hyperswarm or blockchain registries and
   import received operations back through Gatekeeper validation.
4. Search Server consumes Gatekeeper index exports into a rebuildable read
   model used by Explorer and search-enabled clients.

The Gatekeeper operation history is authoritative. Mediator sync stores and
Search Server databases are synchronization indexes or projections and must
not replace Gatekeeper validation as the source of accepted history.
