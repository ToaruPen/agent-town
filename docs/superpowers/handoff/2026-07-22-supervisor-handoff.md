# Supervisor Handoff — 2026-07-22

Claude Code (previous supervisor) hands supervision to a Codex supervisor thread. Claude may resume later (session_01ABjChJdWwKQYQSBPAVpHp4).

## Current state

- main is green (CI: biome + tsc + vitest + secretlint) through the V visual pass. 83 tests.
- Active plan: `docs/superpowers/plans/2026-07-22-m3a-survival-loop.md` (survival loop, tasks M3a-1..7).
- IN FLIGHT: a worker thread "agent-town M3a-1: needs+calendar" is executing Task M3a-1 on branch `m3a-1-needs-calendar` (commit-but-not-push regime). If it already committed, review + merge; if it stalled uncommitted, verify gates yourself and have it commit (known quirk below).
- Public deploy: https://agent-town.toarupen.org — processes `just serve-llm` and `cloudflared tunnel --config ~/.cloudflared/agent-town.yml run agent-town` must be running locally. Redeploy = restart `just serve-llm` (it rebuilds the client).

## Supervision loop (per task)

1. Worker executes one plan task on its own branch, TDD, commits locally, never pushes.
2. Supervisor verifies INDEPENDENTLY: `just check`, `just test`, diff scope matches the task, contracts match the plan.
3. Fast-forward merge to main, push origin main, confirm CI green.
4. Continue with the next plan task. Parallel tasks require separate git worktrees (never share a working tree between two workers).
5. After M3a-6: run Task M3a-7 (full-year balance smoke, ~32 real minutes) per the plan; tune constants only in `packages/shared/src/constants.ts`; redeploy public build.

## Known worker quirks

- Workers sometimes end their turn with staged-but-uncommitted work, especially if they spawn internal reviewer sub-agents. Delegation prompts MUST include: "Do NOT dispatch reviewer sub-agents. The commit is part of your task; never end with uncommitted work."
- Verify actual `git status` after every worker report; do not trust "done" claims.

## Hard rules (from AGENTS.md + owner mandates)

- Commit gates: just check + just test green before every commit; Conventional Commits; never delete/disable tests; bug fixes need failing-then-passing test.
- sim/ stays deterministic and never imports llm/ or net/. Balance constants only in shared/constants.ts.
- No absolute local paths (/Users/...) in committed content, commit messages, or docs.
- CI must never spawn the real `claude` or `codex` binaries.
- Do not install system services (launchd) without the owner's explicit ok.
- Owner reads Japanese; repo docs stay English except specs.
