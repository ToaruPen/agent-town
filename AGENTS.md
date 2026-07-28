# AGENTS.md

Real-time strategy game where LLM agents and the player each rule a nation and compete for prosperity. The player travels between a world map, where the game is played, and a local map of their own cities. Spec: docs/superpowers/specs/ (Japanese); current direction is `2026-07-27-nation-rulers-realtime-design.md`. Current milestone plans: docs/superpowers/plans/2026-07-27-n1-living-nations.md (simulation) and 2026-07-27-c1-nation-client.md (client). Client design investigations: docs/superpowers/design/. Delegation model and package ownership: docs/superpowers/handoff/2026-07-27-delegation.md.

The resident-scale colony simulation is frozen: it stays in the tree with its tests green, but the live loop no longer runs it. That covers server sim/engine, executor, astar, fakePlanner, worldGen, society, foodAnxiety, spatialDemand, siteSelection, construction, facilityOperation, traffic, farming; shared/spatial.ts; and the client resident/terrain layers. World-history and world-map generation stay live as the game's world generator.

## Layout
- packages/shared — domain types, wire protocol, game constants. No runtime deps.
- packages/server — authoritative simulation (src/sim, deterministic, pure) + WebSocket adapter (src/net).
- packages/client — renderer. Two surfaces: the world map is HTML Canvas 2D, the local city view is PixiJS. Renders server state; owns no game logic.

## Verification
Each of these cost real time before it was written down.
- `pnpm -r exec tsc` short-circuits on workspace order. `shared` runs first; if it fails, `server` and `client` are never invoked — so a failure listing only `shared` errors means the other two are *unknown*, not clean.
- pnpm hoists binaries to the repo root. `packages/<pkg>/node_modules/.bin/tsc` does not exist; use `pnpm --filter @agent-town/<pkg> exec tsc`.
- A measurement that reports zero deserves one look at whether the command ran. A missing binary exits 127, and an `|| echo 0` around an error count turns "the command failed" into "zero errors".
- Run the gate from the worktree you are working in. `.worktrees/` siblings are full checkouts, so a run from the wrong root collects other people's tests.
- Never run a build, a test, an install, or a git operation inside a worktree another agent is working in. `tsc` and `vitest` compile whatever is on disk at that instant, so reading a live worktree with a build is not a read — it can produce an error from a tree no commit ever contained. To verify someone else's branch, check the tip out elsewhere.
- A failure report is evidence about a working tree, not about a commit. Before changing code to fix a reported error, compare its line numbers against the committed file.
- **A branch `git branch --no-merged` lists may be fully merged.** Merging here rebases, which changes every hash, and a later refactor on top changes the patch-id — so `git cherry` marks the commits `+` as well. Both tools then report finished, superseded work as outstanding. Before concluding a branch is unmerged, `git diff <tip> main -- <the files it touches>`: if main is a superset, the branch is stale, not pending.

## Before every code commit
Owner mandate, 2026-07-29. A commit that touches code is not finished when the gate is green.

1. **Run `polishment`, steps 1–5 only.** Step 6 does not apply: this repo has no PR flow and workers never
   push. It is replaced by "commit locally, report, the supervisor merges".
2. **The cleanup path is `ai-slop-cleaner`, not `simplify`.** Polishment's own text calls `simplify` the
   normal case and says not to run both; the owner named the deslop path, so that is the one that runs.
3. **The independent review is a separately dispatched Codex instance.** Not the implementing agent
   invoking a review role on itself, and not a sub-agent it spawns — a reviewer that inherits the author's
   framing is the author reviewing itself with extra steps. **The supervisor dispatches it**, against the
   committed diff, which is also why a worker's brief still says "do not dispatch reviewer sub-agents".
   The two rules do not conflict: workers do not review, the supervisor arranges review.

Order in practice: implement → gate → `ai-slop-cleaner` on your own diff → re-gate → commit → supervisor
dispatches a fresh Codex to review the commit → actionable in-scope findings go back for a further commit →
supervisor gates independently and fast-forward merges.

This binds the supervisor's own code commits too. A docs-only commit skips `ai-slop-cleaner` — the skill
excludes non-code by its own description — but not the review, when the prose makes claims about code.

## Rules
- TDD: failing test → implement → green → commit (Conventional Commits).
- `just check` and `just test` must pass before every commit.
- sim/ is deterministic: seeded RNG only, no Date.now(), no I/O, no imports from net/.
- Game constants live in packages/shared/src/constants.ts, never inline.
- No `any`, no empty catch, cognitive complexity ≤ 10 (Biome enforces).
- Do not add dependencies without a note in the commit body explaining why.
- No absolute local paths in committed content.
- No new asset files. Draw on the 16 px grid with procedural Graphics; the vendored Kenney packs (CC0) are the only sprite source. Asset policy: docs/superpowers/design/2026-07-27-asset-policy.md.
