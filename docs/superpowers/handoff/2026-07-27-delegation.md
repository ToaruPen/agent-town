# Delegation — 2026-07-27

The owner moved the game from a colony sim to a real-time contest between nations
(`docs/superpowers/specs/2026-07-27-nation-rulers-realtime-design.md`). Roles for this phase:

| Role | Who | Owns |
|---|---|---|
| Supervisor | Claude (this thread) | Spec, slice plans, frozen contracts, task briefs, independent verification, merge + push, owner communication |
| Simulation worker | Codex | `packages/shared/`, `packages/server/` — implementation, tests, self-review, local commits |
| Client worker | Claude subagents | `packages/client/` — UI design and its implementation, tests, local commits |
| Reviewer | Codex | Review of each finished task before the supervisor merges, on either side of the boundary |

## Package ownership boundary

The owner split the work by package on 2026-07-27: Codex owns the simulation and the wire contracts,
Claude subagents own the client. The boundary is `packages/shared/src/protocol.ts` — Codex defines the
messages, the client worker consumes them.

- A client worker never edits `packages/shared/` or `packages/server/`. If it needs a protocol field
  that does not exist, it stops and reports; the supervisor turns that into a Codex task.
- A simulation worker never edits `packages/client/`.
- Both sides may read everything. Neither side changes a frozen contract.
- The two sides can run in parallel, but only in separate git worktrees under `.worktrees/`. A worker
  that shares the primary worktree with another worker will sweep the other's files into its commit.
  A fresh worktree has no `node_modules`, so `pnpm install` comes before `just check && just test`.

The supervisor does not implement plan tasks. A worker does not push and does not decide scope. Workers
*implement* the frozen contracts — creating `packages/shared/src/nation.ts` and reshaping `protocol.ts`
is assigned work — but never deviate from them: no renamed field, no changed type, no added field,
nothing made optional.

## Current state

- **N1 is code-complete except balance (Task 7). The game runs.** Verified by booting it rather than by
  reading tests: `SEED=12345 PORT=8791 packages/server/node_modules/.bin/tsx packages/server/src/index.ts`,
  then a WebSocket to `ws://localhost:8791/ws` — the `/ws` path is required and it binds IPv6, so
  `localhost` connects where `127.0.0.1` does not. At x8 the clock advanced 838 → 1470 ticks over nine
  1 Hz broadcasts, rolled 1年秋 → 2年春, fired two `season` reports and three `orders` messages; the
  chancellor governed unprompted; and the ledger carried `directiveEffect +50` against `directiveCost -20`
  under distinct directive ids, which is the double-charge trap closed in a live run rather than in a test.
- **The browser shows nothing.** Task 5 reduced `main.ts` to 14 lines by design, and `index.html` is 800
  lines of resident-era markup with nothing populating it. C1-6a's territory borders and C1-1's banners are
  in the tree but mounted nowhere, because the chronicle went out with `main.ts`. C1-3 then C1-6b is the
  path back to a visible game; until then `dev-city.html` is the only page that renders.
- `main` is green through S5 (social facilities and trails), V3 (readable settlement), the farming slice
  and N1 Tasks 1–5: `just check`, `just test`, client build, secretlint, and the `Date.now`/`Math.random`
  determinism scan all pass. `origin/main` matches, and CI is green.
- **`just check` does not type-check any test file.** All three package tsconfigs include only
  `src/**/*.ts`, so a test can assert against a contract shape that no longer exists and stay green — which
  silently weakens the per-task contract verification below. **Still open.** A first attempt was dispatched
  and abandoned — the `tooling-typecheck-tests` branch and worktree exist but sit at their base commit with
  nothing committed, so do not read them as work in progress.
  Measured on main at `6be468a`: adding `test/**/*.ts` to each package's `include` and running `tsc` yields
  **0 errors in all three packages**. So the fix is a clean-window change today, not an excavation, and the
  window closes as soon as a worker merges a test that only ever ran untyped. Two cautions for whoever takes
  it. Sibling worktrees on older bases *do* have errors — `wsClient.test.ts` there fails against the
  pre-`c8215cf` protocol — so enumerate inside the branch's own worktree and do not treat another worktree's
  errors as main's. And bring `lib`/`target` along: test files already use syntax like `Array.prototype.at`
  that a `lib` predating `es2022` rejects, which turns the gate red on code that is fine.
- CI is roughly 2.7× slower than a local run. Determinism tests that pass locally can time out there.
  Timeouts are set per test at 3× or more of the measured local duration; there is deliberately no
  global `testTimeout` in `vitest.config.ts`, so a slow test states its own budget where a reader sees it.
- The farming plan's Task 10 is closed except for two items that need the owner: a browser judgement
  of whether fields read as fields at real scale, and a re-run of the Task 7 balance sweep.
- Active plans: `docs/superpowers/plans/2026-07-27-n1-living-nations.md` (simulation, Tasks 1–5 merged,
  Task 7 balance in flight) and `docs/superpowers/plans/2026-07-27-c1-nation-client.md` (client, C1-1,
  C1-2 and C1-6a merged).
- A shared-chores commit (`c8a7c47`) sits between them. It landed `NATION_CITY_TIER_MIN_POPULATIONS`, so
  the client's provisional copy in `worldCityViewModel.ts` can now be replaced by an import. The values match
  exactly. The types do not: the client's copy is `as const`, the shared one is a mutable `number[]`, so the
  import drops the readonly tuple. That was checked rather than assumed — swapping the local declaration to
  `number[]` and running `pnpm -r exec tsc` exits 0 with no errors, nothing repo-wide keys off
  `typeof CITY_TIER_MIN_POPULATIONS`, and `CityTier` is written literally as `1 | 2 | 3 | 4` rather than
  derived from the array, which is what makes the widening harmless. Note the check's reach: that `tsc` run
  does not cover test files yet, so a test depending on the literal types would not have shown up. It also added a server test that pins the eight private
  polity template colours, which is the tripwire the client's hand-copied `ARCHIVAL_COLORS` table needed:
  change the server's palette and a server test fails naming the client file to re-measure.
- **Two constants in `shared/src/constants.ts` are dead and still declared.**
  `WORLD_MAP_CITY_RADIUS_PX` and `WORLD_MAP_CAPITAL_RADIUS_PX` have one repo-wide occurrence each, their own
  declaration; C1-6a replaced them with population tiers and the capital diamond. The chores worker was told
  to report references rather than delete, found four doc mentions, and correctly declined. Those docs are
  now corrected, so the deletion is unblocked and is a shared-package chore.
- The owner asked for a world-map ↔ local-map traversal like Songs of Syx or RimWorld. The local view is
  a derived, non-authoritative view of the player's own cities; the resident-scale sim stays frozen.
  Design docs for the traversal, the ruler HUD, the visual identity, the directive sprites, the asset policy
  and the sound design all live in `docs/superpowers/design/` and are the client worker's brief.
- **Two things wait on the owner and cannot be delegated.** The nine staged audio cues and seven alternates
  need auditioning — risks 2 through 6 in the audio design are decisions only a listener can make, and the
  authoring agent could not hear any of them. And the `dev-city.html` judgement cannot be delegated at all:
  browser access is denied to every agent here, not to one unlucky worker. Two workers were denied, then the
  supervisor tried directly and was denied too. Stop spending dispatches on it. What an agent *can* do is
  serve the page — `pnpm --filter @agent-town/client dev` puts it at `/dev-city.html` on the Vite port — and
  the owner opens it. The questions waiting there are the open square, whether six deliberate gaps read as
  room for growth or as holes, and forest tree density.
- **The territory fill is the worst-separated element on the world map.** `buildCells` washes territory in
  archival `Polity.color`, whose worst pairwise ΔE76 is 12.6 (sable/river), while the banner ring the city
  dots and borders use holds a 40.86 floor. The largest coloured region therefore has the least separation,
  inverting the point of the banner system. Folded into C1-6b, which already owns the fill alpha.
- No LLM work in N1. Ruler LLMs arrive in N4.

## Per-task loop

1. Supervisor hands the worker one task from the plan's task list (prompt template below).
2. Worker branches from the previous task's commit, works TDD, commits locally, never pushes.
3. Reviewer (a separate Codex pass) reviews the diff against the task brief and the frozen contracts.
4. Supervisor verifies independently: `just check`, `just test`, diff scope matches the task, contracts
   unchanged, no forbidden imports in `sim/nation/`.
5. Supervisor fast-forward merges into the slice branch and pushes; CI must go green before the next task.

Simulation tasks are sequential, so Codex needs one worktree at a time. A client task running alongside
a simulation task needs its own worktree; see the ownership boundary above.

## Client worker brief additions

A client worker gets the same rules as a simulation worker, plus:

- Read the design docs before writing code. They are the scope; do not redesign from the task title.
- `packages/client/` only. No edits under `packages/shared/` or `packages/server/`. A missing protocol
  field is a stop-and-report, not something to add.
- No new dependencies and no external asset files. Graphics are produced procedurally — read
  `packages/client/src/render/sprites.ts` for the established approach before proposing anything.
- The client computes no score and judges no directive's legality. It renders what the server sends.
- Reuse the existing renderers and view models rather than forking them. Frozen resident-scale layers
  may be unmounted from `main.ts` but stay in the tree with their tests green.
- New game constants belong in `packages/shared/src/constants.ts`, which the client worker may not edit —
  so a client task that needs one is a stop-and-report. Pure presentation values (colours, pixel sizes,
  easing durations) are not game constants and live in the client.

## Delegation prompt template

> Repository: agent-town. Read `AGENTS.md`, the spec
> `docs/superpowers/specs/2026-07-27-nation-rulers-realtime-design.md`, and the plan
> `docs/superpowers/plans/2026-07-27-n1-living-nations.md`.
>
> Execute exactly Task N of that plan — nothing before it, nothing after it. Work on branch
> `<branch from the task table>`, branched from `<previous task's commit>`.
>
> Rules: TDD (failing test first). `just check && just test` must pass before you commit. Conventional
> Commits. Never delete or disable a test. Do not add dependencies or assets. Implement the contracts
> listed under "Frozen Contracts" exactly as written, including creating or reshaping the files that hold
> them; never rename a field, change a type, add a field, or make one optional. If a contract looks wrong,
> stop and report instead of editing it. Do not dispatch reviewer sub-agents. The commit is part of your
> task; never end your turn with uncommitted work. Do not push.
>
> Report: the commit hash, the files touched, the tests you added, and anything in the plan you found
> ambiguous or wrong.

## Verification checklist (supervisor, every task)

- `git status` is clean and the commit actually exists — do not trust a "done" report.
- `just check` and `just test` pass on a fresh checkout of the branch.
- **Run the gate inside the branch's own worktree, never from the primary.** Measured on 2026-07-27: `npx vitest list` from the primary returned 2395 tests, of which 1599 came from `.worktrees/` siblings. The primary gate therefore runs other workers' in-flight code, and a worker mid-TDD with a deliberately failing test turns it red for everybody. A worktree contains no nested `.worktrees/`, so running the gate inside one is clean — a sane test-file count is the tell. CI is unaffected because `.worktrees/` is gitignored and never exists in a fresh checkout. A fix to the root config is in progress; until it lands, this is a hard rule, and after it lands the file count is still worth a glance.
- The diff touches only what the task brief allows, and stays inside the worker's package.
- `packages/shared/src/nation.ts` and the protocol types match the frozen contracts byte for byte.
- The new `sim/nation/` files contain no `Date.now`, `Math.random` or `process.`.
- Read every import specifier in those files and resolve it: anything landing inside
  `packages/server/src/net/` or `packages/server/src/llm/` is forbidden. Do not grep for a fixed prefix —
  from `sim/nation/` the relative path is `../../net/`, and a deeper file would differ again.
- Frozen resident-scale modules and their tests are untouched and still green.

## Hard rules (from AGENTS.md and owner mandates)

- `sim/` stays deterministic: seeded RNG only, no wall clock, no I/O, no `net/` or `llm/` imports.
- All balance numbers live in `packages/shared/src/constants.ts`, never inlined.
- CI never spawns the real `claude` or `codex` binaries.
- No absolute local paths in committed content, commit messages or docs.
- Repo docs stay English; specs stay Japanese. The owner reads Japanese.
- Every slice must run to completion with LLMs disabled.

## Where the supervisor runs

The supervision thread started as a Claude Code web session and was pulled onto the owner's machine
with `claude --teleport`, so the supervisor now runs locally alongside the Codex CLI and can hand out
worker assignments directly. To move it again: `claude --teleport` (or `/teleport` in a running CLI
session) needs the same claude.ai account, a clean working tree, a checkout of this repository, and
the session branch pushed to the remote.
