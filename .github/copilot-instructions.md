Use `AGENTS.md` and the canonical guides under `.agents/` as the repository
instructions. Read the architecture and development guides before editing.

Core MDIP behavior belongs in `packages/`, especially `packages/gatekeeper`
and `packages/keymaster`. Behavior changes require focused tests and matching
documentation updates. Preserve unrelated changes and do not perform
destructive operations on persistent runtime data, operate deployment hosts,
run live synchronization, publish, or release unless explicitly requested.
Isolated test fixtures may manage their own state.
