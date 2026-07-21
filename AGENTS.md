# AGENTS.md

Colony-sim game where residents are LLM agents. Spec: docs/superpowers/specs/ (Japanese). Current milestone plan: docs/superpowers/plans/.

## Layout
- packages/shared — domain types, wire protocol, game constants. No runtime deps.
- packages/server — authoritative simulation (src/sim, deterministic, pure) + WebSocket adapter (src/net).
- packages/client — PixiJS renderer. Renders server state; owns no game logic.

## Rules
- TDD: failing test → implement → green → commit (Conventional Commits).
- `just check` and `just test` must pass before every commit.
- sim/ is deterministic: seeded RNG only, no Date.now(), no I/O, no imports from net/.
- Game constants live in packages/shared/src/constants.ts, never inline.
- No `any`, no empty catch, cognitive complexity ≤ 10 (Biome enforces).
- Do not add dependencies without a note in the commit body explaining why.
- No absolute local paths in committed content.
