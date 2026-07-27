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

- `main` is green through S5 (social facilities and trails), V3 (readable settlement), the farming slice
  and N1 Task 1: `just check`, `just test`, client build, secretlint, and the `Date.now`/`Math.random`
  determinism scan all pass. `origin/main` matches, and CI is green.
- CI is roughly 2.7× slower than a local run. Determinism tests that pass locally can time out there.
  Timeouts are set per test at 3× or more of the measured local duration; there is deliberately no
  global `testTimeout` in `vitest.config.ts`, so a slow test states its own budget where a reader sees it.
- The farming plan's Task 10 is closed except for two items that need the owner: a browser judgement
  of whether fields read as fields at real scale, and a re-run of the Task 7 balance sweep.
- Active plan: `docs/superpowers/plans/2026-07-27-n1-living-nations.md` (tasks N1-1..7).
- N1 Task 1 (nation contracts) is merged. Task 2 (bootstrap) is with Codex.
- The owner asked for a world-map ↔ local-map traversal like Songs of Syx or RimWorld. The local view is
  a derived, non-authoritative view of the player's own cities; the resident-scale sim stays frozen.
  Design docs for the traversal, the ruler HUD and the visual identity are the client worker's brief.
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
