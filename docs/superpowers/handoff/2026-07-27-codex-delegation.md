# Codex Delegation — 2026-07-27

The owner moved the game from a colony sim to a real-time contest between nations
(`docs/superpowers/specs/2026-07-27-nation-rulers-realtime-design.md`). Roles for this phase:

| Role | Who | Owns |
|---|---|---|
| Supervisor | Claude | Spec, slice plans, frozen contracts, task briefs, independent verification, merge + push, owner communication |
| Worker | Codex | Implementation, tests, self-review, local commits |
| Reviewer | Codex | Review of each finished task before the supervisor merges |

The supervisor does not implement plan tasks. The worker does not push, does not change frozen
contracts, and does not decide scope.

## Current state

- `main` is green through the world-map slice (S4). The colony sim, world-history generation and
  world-map generation are all implemented and tested.
- Active plan: `docs/superpowers/plans/2026-07-27-n1-living-nations.md` (tasks N1-1..7, sequential).
- Nothing of N1 is implemented yet. Task 1 is the next assignment.
- No LLM work in N1. Ruler LLMs arrive in N4.

## Per-task loop

1. Supervisor hands the worker one task from the plan's task list (prompt template below).
2. Worker branches from the previous task's commit, works TDD, commits locally, never pushes.
3. Reviewer (a separate Codex pass) reviews the diff against the task brief and the frozen contracts.
4. Supervisor verifies independently: `just check`, `just test`, diff scope matches the task, contracts
   unchanged, no forbidden imports in `sim/nation/`.
5. Supervisor fast-forward merges into the slice branch and pushes; CI must go green before the next task.

Parallel tasks would need separate git worktrees. N1 is sequential, so a single worktree is enough.

## Delegation prompt template

> Repository: agent-town. Read `AGENTS.md`, the spec
> `docs/superpowers/specs/2026-07-27-nation-rulers-realtime-design.md`, and the plan
> `docs/superpowers/plans/2026-07-27-n1-living-nations.md`.
>
> Execute exactly Task N of that plan — nothing before it, nothing after it. Work on branch
> `<branch from the task table>`, branched from `<previous task's commit>`.
>
> Rules: TDD (failing test first). `just check && just test` must pass before you commit. Conventional
> Commits. Never delete or disable a test. Do not add dependencies or assets. Do not change any contract
> listed under "Frozen Contracts" — if one looks wrong, stop and report instead. Do not dispatch reviewer
> sub-agents. The commit is part of your task; never end your turn with uncommitted work. Do not push.
>
> Report: the commit hash, the files touched, the tests you added, and anything in the plan you found
> ambiguous or wrong.

## Verification checklist (supervisor, every task)

- `git status` is clean and the commit actually exists — do not trust a "done" report.
- `just check` and `just test` pass on a fresh checkout of the branch.
- The diff touches only what the task brief allows.
- `packages/shared/src/nation.ts` and the protocol types match the frozen contracts byte for byte.
- `grep` the new `sim/nation/` files for `Date.now`, `Math.random`, `process.`, and imports from
  `../net/` or `../llm/` — all must be absent.
- Frozen resident-scale modules and their tests are untouched and still green.

## Hard rules (from AGENTS.md and owner mandates)

- `sim/` stays deterministic: seeded RNG only, no wall clock, no I/O, no `net/` or `llm/` imports.
- All balance numbers live in `packages/shared/src/constants.ts`, never inlined.
- CI never spawns the real `claude` or `codex` binaries.
- No absolute local paths in committed content, commit messages or docs.
- Repo docs stay English; specs stay Japanese. The owner reads Japanese.
- Every slice must run to completion with LLMs disabled.

## Moving this session to a local machine

The supervisor thread can be pulled from the web session into a local terminal with
`claude --teleport` (or `/teleport` inside a running CLI session). It requires the same claude.ai
account, a clean working tree, a checkout of this repository, and the session branch pushed to the
remote. The conversation history and the branch both come across, after which the local Codex CLI can
take the worker assignments directly.
