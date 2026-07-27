# AGENTS.md

Real-time strategy game where LLM agents and the player each rule a nation and compete for prosperity. The player travels between a world map, where the game is played, and a local map of their own cities. Spec: docs/superpowers/specs/ (Japanese); current direction is `2026-07-27-nation-rulers-realtime-design.md`. Current milestone plan: docs/superpowers/plans/2026-07-27-n1-living-nations.md. Delegation model and package ownership: docs/superpowers/handoff/2026-07-27-delegation.md.

The resident-scale colony simulation is frozen: it stays in the tree with its tests green, but the live loop no longer runs it. That covers server sim/engine, executor, astar, fakePlanner, worldGen, society, foodAnxiety, spatialDemand, siteSelection, construction, facilityOperation, traffic, farming; shared/spatial.ts; and the client resident/terrain layers. World-history and world-map generation stay live as the game's world generator.

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
