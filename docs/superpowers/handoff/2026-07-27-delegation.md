# Delegation — 2026-07-27

The owner moved the game from a colony sim to a real-time contest between nations
(`docs/superpowers/specs/2026-07-27-nation-rulers-realtime-design.md`). Roles for this phase:

| Role | Who | Owns |
|---|---|---|
| Supervisor | Claude (this thread) | Spec, slice plans, frozen contracts, task briefs, independent verification, merge + push, owner communication |
| Simulation worker | Codex | `packages/shared/`, `packages/server/` — implementation, tests, self-review, local commits |
| Client worker | Claude subagents | `packages/client/` — UI design and its implementation, tests, local commits |
| Reviewer | Codex | Review of each finished task before the supervisor merges, on either side of the boundary |

## Owner decisions, settled 2026-07-28

Eight questions had been accumulating for the owner. All eight are answered. Each is now a task, not a
question — the reasoning behind each is in its own section below.

| # | question | decision | what it costs |
|---|---|---|---|
| 1 | Autopilot: spec 184 says fill-the-gap, `engine.ts:104` implements always-chancellor | **Spec wins.** The chancellor decides only in a season with no queued order | One server change plus `bootstrap.ts:134`; one test in `nationDashboardViewModel.test.ts` flips. Also closes the silent hold on a new player's first order |
| 2 | Prosperity ceiling: every living nation pins 4 of 5 components by year 10–40 | **Stop using fixed references.** Normalize by rank within the field, or log-scale | `prosperity.ts` and its tests. Ends the unwinnable "how big should the reference be" tuning loop |
| 3 | A nation with population 0 still scores 443.6 | **Death must read as death.** A dead nation leaves the ranking; the spread is measured over survivors | Must land *before* #2 can be measured — today's spread number is propped up by a corpse |
| 4 | `orders.chancellorChoice` carries no `id`, so a chancellor's festival shows 発令者不明 | **Add the id to the protocol.** The server already knows | `shared` + `server`; the client's existing path then attributes it with no change |
| 5 | The first game year renders as 紀元0年 | **Give the generator a real epoch** | `historyGen.ts:615`; the client is already correct and needs nothing |
| 6 | `AGENTS.md` bans new assets; `asset-policy.md` allows generated art off the 16 px grid | **The design document wins.** Update `AGENTS.md` | Depends on the conformance gate actually working — see the `assetConformance.test.ts:409` entry in Queued cleanups, which is currently a no-op |
| 7 | Push | **Done.** `origin/main` is at `a863690` | — |
| 8 | Cleanup | **Done for worktrees**, 16 removed, 7.7 GB → 531 MB. The two `__diag_*` branches are **still there** — the command was refused by the permission layer, so it is the owner's to run | `git branch -D __diag_merge_test __diag_main_snapshot` |

**Order matters for 2 and 3.** Fixing the ceiling while a dead nation still scores 443 means measuring the
result against a spread that a corpse is holding up. Land #3 first, then re-measure, then do #2.

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
- **The browser shows the game again, as of C1-3 (`d9825a6`).** `just dev` serves the page on 5173 and Vite
  proxies `/ws` to the server on `WS_PORT` 8790, so both halves come up with one command. Verified end to end
  through that proxy — the path the browser actually takes, not a direct socket: `welcome` arrives with four
  nations, the five HUD roots (`nation-clock`, `nation-dashboard`, `nation-ranking`, `nation-select`,
  `world-status`) are present in the served markup, and the client bundles. What renders is the clock, the
  nation picker, then the dashboard and the prosperity ranking once a nation is chosen. The directive panel
  (C1-4) and the season report (C1-5) have since mounted. Still unmounted: the world map, whose branch is
  green but unmerged — see "Where C1-6b stopped". `dev-city.html` remains the only page showing the resident
  scale.
- **A fresh connect carries no player nation, and only `orders` ever names one.** Measured directly:
  `welcome` gives `playerNationId = null` with all four nations at `controller: "agent"`, and
  `wsServer.ts:161`'s `selectNation` returns `[orders]` and never a second `welcome`. So `orders.nationId` is
  the sole channel. An earlier note here recorded `playerNationId: polity-1`; that was read after a
  `selectNation` had already been sent and was wrong about the connect state. The consequence is load-bearing:
  without a picker the dashboard is unreachable, which is why C1-3 owns the picker even though its task
  bullets never listed one. C1-4 still owns the candidate list, `queued`, `chancellorChoice` and `rejected`.
- **Open fiction decision: the first game year renders as 紀元0年.** `historyGen.ts:615` hardcodes
  `currentYear: 0`, and the client's label is `history.currentYear + clock.year - 1` exactly as the plan
  specifies, so "now" is year 0 rather than the 紀元1043年 the design uses as its example. Nothing forces an
  absolute epoch today — the chronicle only ever renders durations (`開拓以前の${currentYear - startYear}年間`).
  Either the generator gains a real epoch or the label wants different wording; both are outside
  `packages/client/`, and the client needs no change under either. This is the owner's call, not a bug.
- After rebasing a client worktree onto a main that carries `22950e1`, run `pnpm install` before `tsc`, or it
  fails with `TS2688` (missing `@types/node`) before reaching any real error. The message names nothing useful.
- `main` is green through S5 (social facilities and trails), V3 (readable settlement), the farming slice
  and N1 Tasks 1–5: `just check`, `just test`, client build, secretlint, and the `Date.now`/`Math.random`
  determinism scan all pass. `origin/main` matches, and CI is green.
- **`just check` now type-checks test files. Closed by `22950e1`.** Each package's tsconfig `include` gained
  `test/**/*.ts`. Until then a test could assert against a contract shape that no longer existed and stay
  green, which silently weakened the per-task contract verification below. Closing it required fixing 80 real
  type errors — 59 in server, 21 in client, 0 in shared — with no `any`, no `@ts-expect-error`, and no
  weakened or deleted assertion: guard-and-throw helpers for `noUncheckedIndexedAccess`, a shared spawn-mock
  type for the `child_process` fakes, `satisfies`/tuple typing against literal widening, and a Pixi type
  predicate. The client also gained `@types/node` as a devDependency plus `"types": ["node"]`, because a test
  reads `index.html` from disk. That is a standing looseness — the gate can no longer object to Node globals
  in client `src/` either — accepted deliberately over a second tsconfig, with a follow-up owed: a
  deterministic guard that fails if anything under `packages/client/src/` imports `node:*` or touches
  `process`/`Buffer`/`__dirname`. Nothing in `src/` uses them today; that was grepped, not assumed.
- **Two ways this document got the above wrong, both worth not repeating.** It first claimed a tooling task
  was in progress when the branch sat at its base commit with nothing committed — the work was in fact
  running and simply had not committed yet, so "no commit" was read as "abandoned". Then it claimed the fix
  would surface **0 errors in all three packages**. That measurement was a probe that never executed: it
  invoked `packages/<pkg>/node_modules/.bin/tsc`, which does not exist because pnpm hoists the binary to the
  repo root, so it exited 127, and an `|| echo 0` around the error count turned "the command failed" into
  "zero errors". Re-measured through `pnpm --filter`, the true counts were 0/59/21. A measurement that
  reports zero is worth one look at whether the thing ran.
- **`pnpm -r exec tsc` short-circuits on workspace dependency order.** `shared` runs first, and if it fails,
  `server` and `client` are never invoked at all — so a `just check` failure showing only `shared` errors
  means the other two are *unknown*, not clean. `server` and `client` do not depend on each other, so both
  report in the same run once `shared` passes. Do not read the error count as a size estimate.
- Still outside `tsc`'s reach: the root `vitest.config.ts` and `test/vitestConfig.test.ts`, because
  `pnpm-workspace.yaml` lists only `packages/*`. Also `packages/server` resolves `node:*` types only
  transitively through `@types/ws`; drop or bump that and server test files silently lose Node types.
- CI is roughly 2.7× slower than a local run. Determinism tests that pass locally can time out there.
  Timeouts are set per test at 3× or more of the measured local duration; there is deliberately no
  global `testTimeout` in `vitest.config.ts`, so a slow test states its own budget where a reader sees it.
- The farming plan's Task 10 is closed except for two items that need the owner: a browser judgement
  of whether fields read as fields at real scale, and a re-run of the Task 7 balance sweep.
- Active plans: `docs/superpowers/plans/2026-07-27-n1-living-nations.md` (simulation — **all tasks merged**,
  Task 7 balance closed by `d4c87b2`) and `docs/superpowers/plans/2026-07-27-c1-nation-client.md` (client,
  C1-1, C1-2, C1-3, C1-6a and C1-10 merged).
- **The simulation is complete; the N1 slice is not.** The plan's own completion criteria include "opening
  the browser shows live nations, a moving ranking, a working directive panel and a working speed control".
  Live nations, the ranking and the speed control landed with C1-3; `main.ts` mounts the HUD. **The
  directive panel is the one clause still unmet**, which is C1-4, and C1-6b then adds the map. Of the other
  criteria, same-seed reproducibility and seed *divergence* are both genuinely tested —
  `nationBootstrap.test.ts:91` and `worldMapGen.test.ts:158` — so only that one clause is outstanding.

  This paragraph claimed `main.ts` was still 14 lines and that C1-3 was next for four commits after C1-3
  merged, while the section at :41 recorded it as merged. A Codex review caught the contradiction. It is
  the same failure as the queue entry that outlived its worker: a status line in this file describing a
  world that has moved on, and an orchestration source that contradicts itself will send the next agent
  to redo finished work. Status claims here need editing when the status changes, not appending to.
- **The balance is tuned to a window the game leaves in about six minutes, and this is the next balance
  task.** Task 7's criteria sample year 20 only and impose a floor, so a spread that decays passes them.
  Measured at seed 42: the top-to-bottom prosperity spread runs 149.9 % at year 5, 103.3 % at year 10,
  59.0 % at year 15, 35.0 % at year 20 — roughly halving every five years. Extending the smoke run to 60
  years takes it to **9.60 %, below the plan's own 15 % floor, and the script's own assertion throws.**
  Leadership still changes exactly once, and peak food stock grows from 29 632 to 251 769, which suggests
  food accumulates with no sink rather than reaching a steady state. For scale: the live x8 run measured
  ≈70 ticks/second against 1200 ticks/year, so a year is ≈17 s and year 20 arrives in under six minutes.
  None of this is a defect in `d4c87b2`, which met every criterion it was given — it is the criteria being
  too short-horizoned. A follow-up should assert a spread floor at several horizons, not one.
- **Tier 1 empties from year 15 onward**, so the smallest city glyph never appears in a mature game.
  Per-tier city counts at seed 42 are `[4,4,0,0]` at bootstrap, `[2,5,1,0]` at year 5, `[0,5,2,1]` at
  year 15 and `[0,4,2,2]` at year 20, with populations spanning 3 408–10 024 by then. Three of the four
  tiers stay occupied throughout, so the thresholds are not collapsing — but C1-6b should know the bottom
  glyph is an early-game-only sight.
- `packages/server/scripts/` is in neither tsconfig `include`, so the balance smoke script is not
  type-checked by `just check` and vitest does not collect it either.
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
- **After the fill change, the open question is the alpha and not the moss hue.** C1-6b folds the fill onto
  the banner colour, which makes three of the four world-map adjacencies a pure function of alpha and the
  terrain underneath — identical in kind for every nation, so they can be read off a table rather than
  measured per nation. Measured with the pipeline that reproduces the design's published moss-on-plains
  figure of 16.8 exactly, so these are commensurable with the design's own numbers. Worst first:

  | adjacency | ΔE76 | what it decides |
  |---|---|---|
  | wash vs unowned terrain | 4.8 @ 0.28, 5.2 @ 0.32, 7.4 @ 0.45 | whether territory *extent* reads at a glance |
  | wash vs wash at a frontier | 13.2 @ 0.32 (worst pair, ember/moss) | who borders whom |
  | banner vs its own wash | 12.1 @ 0.28, 11.6 @ 0.32, 9.5 @ 0.45 | whether a city reads against its own territory |
  | banner vs terrain | 16.8 | already handled: banner vs casing is 51.0 |

  Two consequences. **Raising alpha does not fix the worst figure** — it moves wash-vs-unowned by 2.6 across
  the entire range while costing 2.6 of banner distinctness, so extent is not tunable by alpha at all.
  And **the 1 px full-alpha band is not decorative.** There is no casing at a nation-nation frontier, so
  after the fill change the frontier is wash against wash at 13.2 while the banners either side are at 45.2;
  the band is the only mark there still separated at the figure the palette was designed around.
- **The gold/moss banner pair is closed — C1-1b already covers it.** The pair measures 24.6 at full alpha and
  would undercut the 40.86 floor if both were ever assigned. `nationBanner.test.ts` enumerates every ring pair
  below the bar and names this one explicitly ("olive/moss at ΔE 24.6 and violet/plum at ΔE 20.8, both a
  primary against a fallback"), asserts the assignment *refuses* to hand both out, and guards against a
  re-tuned ring making that pass vacuously. Checked rather than assumed; nothing to do.
- No LLM work in N1. Ruler LLMs arrive in N4.

## A live worktree is not readable with a build

The supervisor ran `just check` inside a worker's worktree while that worker was mid-edit, compiled a tree
that existed for about two minutes between two of its tool calls, and reported the resulting `TS2741` to it
as a blocker on its branch. The error cited `nationHud.ts(128,55)`; the committed call site is at 148 with
the required field supplied at 153, so what got compiled had one file already requiring a field and the
other not yet passing it — a state no commit ever contained. The same intrusion, one step later, rebased
that worker's branch onto a newer main and moved its hashes without telling it.

Both were the supervisor's, and both invert a rule the supervisor had been issuing all day: every directory
under `.worktrees/` is another agent's live workspace, and a worker is told never to touch a sibling's. The
hazard runs in both directions, and **reading a worktree with a build is not a read** — `tsc` and `vitest`
compile whatever is on disk at that instant, including a half-finished edit.

So: to verify a branch while its author is still working, check the tip out into a scratch directory, wait
for the author's report, or ask for the numbers. Do not run the gate in place, and do not rebase someone
else's branch out from under them — if a rebase is needed, ask the author to do it.

**The ten-second check, from the worker's side.** A failure report is evidence about a *tree*, not about a
commit, so reproduce it against a committed state before touching code. The cheap tell is comparing the line
numbers in the report against the committed file: the error above cited `nationHud.ts(128,55)` where the
committed call site is at 148 with the required field supplied at 153, and that gap is the whole answer. It
is what stopped the worker inventing a fix for a bug no commit contained.

One related correction, since it was published to the worker as evidence: the mismatched `77 / 1055` count
that looked like proof of the mid-edit compile came from the worker's own first report, not from any
supervisor measurement. The line-number argument establishes the mid-edit compile on its own — and the
worker, having built an inference on a number it had reported itself, went back and withdrew it rather than
letting it stand.

## Assignments outlive agents

Three times today a worker died mid-task and the artifact left behind said nothing about it. A branch sitting
at its base commit does not mean the worker abandoned the task — one was still running and simply had not
committed, and recording the inference as fact cost two correcting commits. The inverse is worse: a line in
this document reading "asked of the C1-10 worker" survived that worker's death by 529, which reads as *work is
assigned* when the truth is *nobody has it*. `client-c1-04` then died on a session limit before touching a
file, so a fourth line nearly joined them.

So: the reliable signal that a task is owned is the worker's status or a reply, never an artifact in the repo,
and never a line in this file. Any queue entry naming an owner must name a *live* one — if the agent is gone,
the entry says **unowned**, which is the state that gets it re-dispatched.

## The blank page, and the coverage hole underneath it

The owner opened the browser and saw nothing. Two independent defects, both real, both fixed in `25750e5`.

Vite's default `host` is the string `"localhost"`, which Node resolves to a **single** address — on macOS
`::1` — so the dev server listened on IPv6 loopback only and `http://127.0.0.1:5173/` was refused outright
while `[::1]:5173` served fine. Now binds `::`, which takes both stacks because Node does not set
`ipv6Only`. The cost, stated in the commit: the dev server is reachable from the local network.

The second is the one worth remembering. **Every HUD panel was empty until a `welcome` arrived**, so three
unrelated failures — the script never running, the socket never opening, the server being down — all
rendered as the same unbroken dark rectangle. A page that shows nothing also says nothing about why.
`index.html` now ships one unconditional line that `main.ts` clears on the first `welcome` and restores on a
disconnect, and `wsClient` gained an optional `onDisconnected` so a dropped socket stops reading as a paused
clock. It is markup rather than script deliberately: it survives the case where no script runs at all.

Why this shipped with 980 tests green: **there was no DOM environment in the client package.** Every client
test was a view-model test, and view models are pure, so the last step — view model to document — was
covered by nothing at all. `createNationHud` and the four panel renderers could have been broken in any way
and the suite would have stayed green. `happy-dom` and `test/nationHudDom.test.ts` close that: it mounts the
HUD against `index.html`'s real markup, looked up by the same ids `main.ts` uses. The render path turned out
to be sound, which is how the fault was localised to everything *before* the first payload.

The general lesson is the one C1-3's worker reached independently: a view model tested only against fixtures
is tested against its author's assumptions about the wire. The fixtures were green all the way to a blank
page.

## The whole-codebase deslop sweep

The owner asked for `polishment` and `ai-slop-cleaner` across all of it, not just the recent diff, since
neither had ever been run. Split by package because the file sets are disjoint, which is what keeps four
concurrent Codex worktrees from colliding:

| pass | scope | exclusions and why |
|---|---|---|
| `chore-deslop` | the 13 commits of `085fe35..25750e5` — 56 files, ~4,200 lines | none; this is the newest code and the likeliest to hold slop |
| `chore-deslop-server` | the 63 `packages/server` files *outside* that range | `sim/nation/{prosperity,season,engine,directives}.ts` — `n1-08-balance-horizon` is live in them |
| `chore-deslop-shared` | `packages/shared`, 18 files | `constants.ts`, contended by two other passes; `protocol.ts` shapes are frozen — comments and internals only |
| client remainder | the 47 `packages/client` files outside the range | **queued, not dispatched.** `chore-deslop` is editing `worldChronicle.ts` and `worldMapView.ts` to collapse the `hexColor`/`element` duplication, so a second client pass would collide. It goes out once that one lands |

Two standing instructions in every brief, because they are the failure modes that cost the most here: a
genuine defect is a report to me and never a cleanup commit, and a duplication that appears twice does not
justify an abstraction. The `just test` baseline of **75 files / 989 tests** must not go down in any pass.

`polishment`'s independent-review half runs *after* the cleanup lands, not alongside it — the point of that
step is that the author cannot be the only reviewer, so reviewing the cleanup diff is the useful ordering.
The PR step is deliberately not run: publishing is the owner's call.

## What the deslop sweep found

Three passes merged: `chore-deslop`, `chore-deslop-shared`, `chore-deslop-server`. Net **44 files,
+215/−627** — 412 lines removed — with the suite unchanged at 75 files / 989 tests and every touched test
file holding its exact count. The largest single win was 219 lines of an identical Agent fixture duplicated
across eleven server test files, replaced by a 24-line shared one.

The rule that earned itself: **a genuine defect is a report, never a cleanup commit.** Three came back.

- **`sim/engine.ts` wrote to the console**, which violates the no-I/O rule for the deterministic core. Fixed
  with a test, as its own commit: `applyPlan` for an unknown agent now throws instead of warning and
  returning. Worth knowing what that does downstream — the throw lands in `thoughtBroker`'s existing
  `.catch(() => this.failRequest(...))`, so there is no deadlock and no unhandled rejection, but a benign
  race (an agent dying between an LLM request and its response — `engine.ts:141` splices the dead out of
  `world.agents`) is now recorded as a **provider** planning failure. The I/O moved out of `sim/` and into
  `llm/`, where it is allowed, which is the right architecture; conflating "the agent is gone" with "the
  provider failed" is the part left to improve.
- **`protocol.ts`'s runtime validation is far shallower than the contract it advertises.** Measured:
  `decodeServerMessage` returns accepted for `nations: [null]`, for a world map whose every field is `null`,
  and for a history missing required fields. The client trusts `decode`, so this is the boundary between
  the two teams admitting values that are type-invalid on the other side.
- **Nothing in `sim/` performs I/O today, and no test enforces that.** The pass confirmed zero console,
  stream, `Date` or I/O imports across `sim/` — and confirmed there is no guard that would fail if one
  reappeared. The absence is the finding.

One cleanup I reverted. The shared pass removed the `biome-ignore` holding `Position` on one line as a
meaningless suppression; its comment stated a reason, and the reason checks out — the one-line form is
verbatim what the frozen contract block carries at `plans/2026-07-22-m1-living-aquarium.md:181`. Restored in
`7eb4996` with the file and line named, so the next reader can check the claim rather than trust it. **A
suppression that documents why it exists, whose why is verifiable, is not slop.**

Two "leave it alone" calls were right for the same reason, and both are worth imitating. `worldMapFixture.ts`
is genuinely identical in three packages and stayed — two of the three were out of scope and being edited
live. `spatialFixture.ts` looked like the same duplication and was not: only the trail fixture is shared,
while the facility and demand fixtures have diverged in purpose, so only the trail one moved. Not unifying a
duplicate that has diverged is as much a result as removing one that has not.

## Autopilot does not fill the gap — it always decides

C1-4's worker falsified the assumption `hud.md` §3.2 flagged for the owner, with a pre-registered falsifier
that never fired. Measured:

| `autoPilot` | `queued` | what commits |
|---|---|---|
| true | anything | `chancellorChoice`. The queued order **waits** — neither obeyed nor discarded |
| false | non-null | the queued order |
| false | null | nothing |

`sim/nation/engine.ts`'s `selectDirective` tests `autoPilot` before it ever reads the queued list, and the
chancellor branch returns `consumedQueuedDirectiveId: null`. Live at x8, a queued order sat through three
boundaries with autopilot on and committed at the first boundary after it went off.

So there are **four** slot states, and the fourth is the one a new player meets first: `bootstrap.ts:134`
starts nations with `autoPilot: true` and `wsServer.selectNation` does not touch it, so **a brand-new
player's first order is silently held** until they find a toggle they have no reason to look for.

This is a spec/implementation divergence, not a client question. Spec line 184 —
`プレイヤーの国も、指示がない季は宰相が決める` — reads as fill-the-gap; `engine.ts` implements
always-chancellor. **One of the two is wrong and it is the owner's call which.** If the engine changes, one
test in `nationDashboardViewModel.test.ts` is what flips.

## The prosperity ceiling, measured on today's main

Measured 2026-07-28 against `a863690`, **seed 12345**, chancellor governing, no queued directives, 120 years.
This is a different seed from the year-20 balance figures above, and it shows a different failure — record
both, and state the seed whenever quoting either.

```
year | nation   |  pop  prod wealth stab  cult | total
  10 | polity-1 | 1.00 0.97 1.00 1.00 0.33 |  925.1
  10 | polity-2 | 0.30 0.47 1.00 0.00 0.14 |  422.7   population 3050
  10 | polity-3 | 1.00 1.00 1.00 1.00 0.18 |  917.5
  10 | polity-4 | 1.00 1.00 0.95 1.00 0.33 |  923.4
  40 | polity-2 | 0.00 0.32 1.00 0.10 0.14 |  308.6   population 0
  40 | polity-4 | 1.00 1.00 1.00 1.00 1.00 | 1000.0
 120 | polity-1 | 1.00 0.97 1.00 1.00 1.00 |  992.3   unchanged since year 40
 120 | polity-2 | 0.00 0.32 1.00 1.00 0.14 |  443.6   population 0, wealth 64124
 120 | polity-3 | 1.00 1.00 1.00 1.00 0.72 |  971.6   culture is the only thing moving
 120 | polity-4 | 1.00 1.00 1.00 1.00 1.00 | 1000.0   unchanged since year 40
```

**The measuring stick is too short.** Population, wealth and stability are all at 1.00 by **year 10**. From
year 40 the only component still moving anywhere is culture, so a 120-year game is decided by one of five
components carrying 10 % of the weight. The scale of the mismatch: population reads 23 598 against a
reference of 10 000, wealth 64 124 against 5 000. Raising the references buys years, not a fix.

**And the spread is held up by a corpse.** `polity-2` loses its population entirely by year 40 and still
scores 443.6, because a nation with nobody in it is perfectly stable (1.00), its wealth is never spent and
climbs forever, and `production` keeps 0.32 from `materialProduction` alone with zero people to produce it.
Any spread floor measured across all four nations is therefore measuring a dead one. This is the exact
failure the supervision skill names — *a floor on a spread can be satisfied by one permanently crippled
member while the rest are pinned at a ceiling* — showing up in live data.

**A correction to an earlier report.** Figures of "14.43 % spread at year 80, 3 of 4 nations pinned at 1000"
were given to the owner during this session. They do not reproduce on main: `n1-08-balance-horizon` raises
`NATION_PROSPERITY_POPULATION_REFERENCE` from 10 000 to 12 000 and branches from a much older main, so that
measurement described that tree, not this one. Quote the seed and the commit with any balance number.

## C1-4 landed, and the transport was the interesting part

`af74fc5`. The order desk is in: **78 test files / 1087 tests**, up from 75 / 989, everything inside
`packages/client/`. The page now serves all six HUD roots including `directive-panel`, so of N1's browser
criterion — "live nations, a moving ranking, a working directive panel and a working speed control" — only
the world map is left, which is C1-6b.

The finding worth keeping is not the panel. It is that **a dropped socket was silently eating every send**,
and that fixing it forced a choice with a wrong answer available.

`onclose` left `current` pointing at the closed socket for the full reconnect second. `createBrowserSocket`'s
queue only buffers before the *first* open, so that adapter's `pending` was already null and every send
reached a CLOSED socket — which browsers discard without throwing. Click and key both vanished with no error
anywhere while the controls stayed enabled.

**Rejected rather than queued, deliberately.** Queueing would have reintroduced at the transport layer
exactly what the desk exists to prevent: submit, no answer, and a second later something happens. And a
replayed `issueDirective` lands on a runtime whose season may have advanced, whose `queued` may have been
cleared by a `selectNation`, and whose `autoPilot` may have been flipped from another connection — all three
measured, not supposed. `SendClientMessage` now returns whether the message went out, and a refusal is
announced in `#world-status` rather than inferred.

Two things about how that fix arrived, both worth imitating. My objection named the 発令 button and stopped
there; the worker found that **取消 was the worse of the two** and had been left live — withdrawing an order
is what a player does *because* something looked wrong, and a silent 取消 leaves the order committing at the
boundary anyway. And the keys had the same hole one layer down with nothing on screen to grey out, so every
outbound message now goes through one wrapper and `main.ts` binds keys to `hud.send` rather than the raw
channel.

The worker also declined credit twice, which is the part that makes the other claims trustworthy. Restoring
the `??` chain in the key map **fails no test** — `Number("a")` is `NaN`, so the explicit dispatch and the old
chain are behaviourally identical and the change is structural only. And the build-time `markCanSend` has no
observable path through the HUD, because `renderPanels` always calls `renderCanSend` straight after `render`;
it was kept and tested against the controller's own contract instead of being reported as a caught mutation.

One known gap, stated rather than hidden: `main.ts` binding keys to `hud.send` is a one-line wiring choice no
test covers. The DOM test pins the contract and a comment pins the intent.

One deviation from the plan's letter, flagged rather than assumed: §4.3 said to export `CULTURAL_VALUE_LABELS`
in place in `worldChronicle.ts`; it moved to `nationText.ts` instead, because a pure view model importing a
DOM controller would drag `document` into the node-only view-model tests. Accepted — that is the separation
the repo asks for, and the chronicle imports it back so there is still one table.

## Where C1-6b stopped

`c1-06b-world-map-host` at **`89ba3df`**, one commit, base `ce37717`, tree clean, **gate-green and not WIP**:
`just check` exit 0, `just test` **79 files / 1101 tests**. Not pushed, not merged. Five of nine pieces done.

| piece | state |
|---|---|
| persistent host (`worldMapHost.ts`) | done — owns canvas, pointer handler, view-model closure; both surfaces mount it |
| first mount in `index.html` + `main.ts` | done — `#world-map`, docked between the HUD panels, capped at native 576×384 |
| repaint from `update` | done — server-driven, no dedupe key on purpose |
| fill onto banner colours | done — off the archival `Polity.color` |
| player alpha 0.32 vs 0.28 | done — nothing marked when there is no player nation |
| 1 px inner rule | **not started** — decision now recorded, unblocked |
| capital cross-hatch | **not started** — same |
| hover-only selection (§2.2.1) | **not started** — 0.52 is still a persistent resting state, which the design says collapses terrain to ΔE 6.3 |
| locate pulse | **not started** |

The four answers to the worker's design questions arrived after it committed, so all four remaining pieces are
unblocked with the decisions recorded and none begun. The decisions: `worldMapView.ts` paint internals are
fair game because the design settles it (§2.6 calls the inner rule "the key move" and V-4's test line names
the inner rule, not the alpha); the hover-only change is to be made deliberately; the hover state applies to
*any* nation including rivals, under the spec's equality principle.

**Owed before more work lands, both:**

- **Rebase.** `89ba3df` is based on `ce37717`; main has since moved to `77798e1` through the player-alpha
  constant, two docs commits and all five of C1-5's. C1-5 touched `index.html`, `main.ts`, `nationHud.ts` and
  `nationHudState.ts` — the same four files the map host mounts through — so this rebase, unlike C1-5's, will
  conflict. **Unowned.** Both client workers stood down on the owner's stop order, so nobody holds this branch;
  whoever picks it up rebases it themselves rather than having it rebased under them. The nine-piece table
  above is the whole brief, and the four unstarted pieces have their decisions recorded.
- **The constant swap.** `MAP_PLAYER_POLITY_ALPHA = 0.32` is at `client/src/render/colors.ts:47` with five
  references: `src/ui/worldMapView.ts:16` and `:113`, `test/worldMapView.test.ts:10` and `:243`,
  `test/worldMapHost.test.ts:10`, `:160` and `:170`. Swap to `WORLD_MAP_PLAYER_POLITY_ALPHA` from
  `@agent-town/shared` and **delete the local doc comment** rather than keeping it — the shared one carries
  the ΔE reasoning, and duplicating the figures is how they drift.

**Mid-decision state, so it is not rediscovered:**

- `cellAlpha` reads selection → player → resting, and the branch order is right, but **its comment argues from
  a framing that has been superseded** and should be rewritten. Hover is transient and universal; the player
  rule is persistent and singular; they are not competing marks of ownership. The passing test "lets a
  selection outrank the player's own step" stays valid but is named from the old framing.
- **The locate pulse needs a second redraw source.** The host repaints only when `render` is called, ~1 Hz
  from the heartbeat, so a 500 ms one-shot needs its own wall-clock frames. The shape the author reached: the
  host owns an optional animation deadline and self-schedules frames only while one is live — deliberately
  *not* the HUD's `requestAnimationFrame` loop, which belongs to the countdown.
- `WorldMapMarks` is an object rather than a fourth nullable string, so it cannot be passed where
  `selectedPolityId` belongs, and it has room for `hoveredPolityId` when the hover change lands.
- The canvas class is a **required** host option, not a default: the chronicle's CSS keys off
  `world-chronicle__map-canvas`, and a shared default would silently restyle whichever surface was written second.

## C1-5 landed, and it found a hole in the wire format

Merged at **`77798e1`**, five commits, `packages/client` only: 15 files, +1810/−16, two new files
(`seasonReportViewModel.ts`, `seasonReportPanel.ts`). Verified independently of the author's report, by
rebasing a *copy* onto main in the supervisor's own tree rather than touching the live worktree: `just check`
exit 0, `just test` **79 files / 1131 tests**, matching the author's numbers exactly. Only four lines were
deleted from any test file — three imports and one destructuring return — so no assertion was weakened.

**The finding, which is the owner's and not the client's.** `orders.chancellorChoice` (`protocol.ts:33`) is
`{ kind, targetCityId } | null` — it carries **no `id`**. `holdFestival` is the one one-season directive:
`activateBoundaryDirectives` creates and resolves it inside the same boundary, so a chancellor-picked festival
is never observed sitting in `activeDirectives` and the client has no id to log it against. It therefore
renders as 発令者不明 rather than 宰相の決定, even though the server knew who chose it. The report computes
nothing the server did not send, so this cannot be fixed in `packages/client/`. Degrading gracefully is
covered ("still renders a completed directive whose kind was never observed, rather than throwing"). Verified
by reading `protocol.ts` directly.

**Where the plan was silent, the design decided,** and both choices are worth keeping in mind:

- One controller and one view model serve both `#nation-strip` (always-on, §4.1) and `#season-report`
  (on-demand, §4.5), rather than building the diff-with-reasons view twice.
- **Famine's auto-open is keyed on `(year, season)`, not object identity.** A `wsClient` snapshot that is a
  fresh-but-identical object on an ordinary tick must not reopen a panel the player just closed. Regression
  test: "does not reopen a closed panel on a later repaint of the same famine season".
- `HUD_ALERT_COLOR` could not be reused — it is a module-private Pixi hex in the frozen `render/hudLayer.ts`
  — so the strip uses `--world-ember` from the existing CSS palette. Confirmed: the constant is unexported.
- §3.6's reconnect rule is now honoured in full. `ownDirectiveIds` resets on `applyWelcome` while
  `directiveLog` survives, and the announcement is the spec's own string, 再接続しました。発令の履歴は失われました。
  Verified against §3.6, which names both the drop and the 宰相 misattribution as the accepted consequence.

**Two corrections to the author's own report,** neither affecting the merge:

- It described the surviving `lint/complexity/useOptionalChain` warning on `seasonReportViewModel.ts:296` as
  "pre-existing and present before this ticket". It cannot be: `git log --diff-filter=A` puts that file's
  creation on this branch. The warning is **introduced here** and deliberately left, which is a defensible
  call — Biome's fix is unsafe-only because `report?.entries.some(…)` is `boolean | undefined` where the code
  needs `boolean` — but it is the branch's warning, and `just check` now carries one where main carried none.
  The clean form is `report?.entries.some(…) === true`.
- It filed the missing return-focus-to-opener (hud.md §3.5) as consistency with `directivePanel.ts`'s
  precedent. The reasoning is sound but the state is **two panels both owe it**, not "settled by precedent".

## Two of the three "unmerged" branches are not unmerged

`git branch --no-merged main` lists four branches plus `__diag_merge_test`. Only **two** hold work main lacks:
`c1-06b-world-map-host` (`89ba3df`) and `n1-08-balance-horizon` (`cb58162`). The other two are finished:

- `c1-05-season-report` — merged as `38be255..77798e1`. `git cherry` marks all five commits `-`.
- `c1-06a-territory-tiers` (`03e0bf1`) — **superseded, not pending.** Its work is in main as `3fb4d8d`, and
  `5852137` then refactored `worldCityViewModel.ts` onto the shared city-tier thresholds, which is why main is
  25 lines shorter there. `git diff 03e0bf1 main` over the branch's own files shows main as a strict superset:
  the two territory files are byte-identical and only the refactored city model differs. Nothing is lost.

The trap is that `git cherry` marked `03e0bf1` as `+`, i.e. *not applied*. Merging here rebases, so the hash
changes; a later refactor changes the patch-id too; and both tools then report superseded work as outstanding.
Diff the tip against main over the branch's files before believing either of them. This cost a false alarm
raised to the owner and then retracted.

## `world.playerNationId` looks authoritative and is not

The C1-6b probe caught this rather than confirming the work, and any future surface needing the player's
nation will hit it. Reading the held nation from `world.playerNationId` left the map marking **nobody for the
entire session** after a mid-session claim: only a `welcome` ever sets that field, a fresh connect carries
null, and nothing afterwards updates it — `clock` has no such field and `season` does not copy one.

Read the HUD's state instead, which takes the id from a `welcome` *and* from the `orders` echo, so the
fresh-claim and reconnect paths both work. `nationHudState.test.ts` pins that the id survives later updates,
because `applyUpdate` spreading the previous state is the only thing keeping it — a mutation copying the
payload id fails that test.

## `dev-city.html` is a build artifact now, and it serves as a static site

`a9863b3` names both pages in `vite.config.ts`'s `build.rollupOptions.input`. Vite's default input is
`index.html` alone, so the resident-scale page had been built by nobody and existed only under `vite dev` —
which is why it could not be published. It is the only page that can be: `devCityScene.ts` opens no socket,
while `main.ts:56` connects a WebSocket, so `index.html` is inert without the simulation server behind it.

**Verify a static build by serving the artifact, not by trusting `vite dev`.** `npx wrangler pages dev
packages/client/dist --port <free>` runs the real Pages runtime over the real output with no Cloudflare
account involved. Three things only that surfaced:

- **Pages strips `.html`.** `/dev-city.html` answers `308 → /dev-city`. The deployed page lives at
  `/dev-city`, and `/` will be the inert `index.html`, so a blank root is expected, not a regression.
- **Bind to a port with no listener, and confirm the answer is wrangler's.** `8788` was already held by an
  unrelated local service on `127.0.0.1`; wrangler reported "Ready" on `::` and every request still went to
  the other process. A 404 whose `Server:` header names something else is a port collision, not a bad build.
- All 12 JS chunks and all 25 sprite paths baked into the bundle answer 200 over that server.

Do not use `vite preview` for this: the IPv6 fix in `vite.config.ts` is on `server.host`, and `preview` reads
a separate `preview.host` that still defaults to single-address `localhost`.

Publishing is the owner's, twice over: `wrangler login` is interactive OAuth, and `wrangler pages deploy`
against a project that does not exist prompts for a project name — creating one is persistent configuration
on their Cloudflare account, so the name is theirs to choose.

## Queued cleanups

Small, independent, and none of them blocking. Each is here because it was found while verifying something
else, and would otherwise be lost. Several are now inside a deslop pass's scope and will land there instead.

| what | where | why it is not done yet |
|---|---|---|
| Delete `WORLD_MAP_CITY_RADIUS_PX` and `WORLD_MAP_CAPITAL_RADIUS_PX` | `shared/src/constants.ts` | Was blocked by doc references claiming they were current; those are corrected, so it is unblocked now |
| Derive the prosperity expectation instead of pasting it | `server/test/nationProsperity.test.ts` | `toBeCloseTo(0.321_428_571_428_571_45)` is `225 / NATION_PROSPERITY_PRODUCTION_REFERENCE`; correct today, but needs re-pasting on every retune, and the derivation is invisible |
| Guard Node *globals* in client `src/` | `client/test/assetConformance.test.ts` | C1-10 already blocks `from "node:"` imports; `types: ["node"]` also admits bare `process`/`Buffer`/`__dirname`, which no rule catches. **Unowned.** It was asked of the C1-10 worker, which then died on a 529 before replying, so the request may never have been read — see "Assignments outlive agents" below |
| Guard `sim/` against I/O mechanically | `server/test/` | Nothing in `sim/` performs I/O today and no test would fail if one reappeared. The deslop pass confirmed both. **Unowned** |
| Distinguish a vanished agent from a failed provider | `server/src/llm/thoughtBroker.ts:122` | `applyPlan` now throws for an unknown agent, and the existing catch books it as a provider planning failure. Nothing failed — the agent died mid-request. **Unowned** |
| Deepen `decodeServerMessage`'s validation to match its contract | `shared/src/protocol.ts` | It accepts `nations: [null]`, an all-`null` world map, and a history missing required fields. Needs shape-level work and a decision about how strict the boundary should be, so it is a task rather than a chore |
| Make the new-art gate check new art | `client/test/assetConformance.test.ts:409` | It asserts `NEW_ART_ROOT` is *empty*, so the first conforming PNG fails the suite for existing — and nothing ever runs `checkTile` over that directory, so the advertised gate can neither accept valid new art nor report its violations. Iterate the directory and assert each file's violations are empty instead. Found by Codex review; **unowned**, and independent of the AGENTS.md asset decision |
| Collapse the three copies of `hexColor` and `element` | `client/src/ui/` | C1-3 duplicated both locally rather than exporting from `worldMapView.ts` / `worldChronicle.ts`. That was the right call for its diff, but it leaves three copies for C1-6b to collapse — the same duplication class the `ARCHIVAL_COLORS` tripwire exists to catch, without a tripwire |
| Return focus to the opener when a panel closes | `client/src/ui/directivePanel.ts`, `seasonReportPanel.ts` | hud.md §3.5 names the behaviour and neither panel does it. C1-5 read the existing gap as precedent; recorded here so it is one item against both panels rather than a settled question. **Unowned** |
| Clear the one lint warning `just check` now carries | `client/src/ui/seasonReportViewModel.ts:296` | `useOptionalChain`, introduced by C1-5 and left because Biome's fix changes the type to `boolean \| undefined`. `report?.entries.some(…) === true` satisfies both. **Unowned** |
| Narrow `treeSpritePath()`'s return type | `client/src/render/sprites.ts` | Returns a widened `string` against an `as const` `SPRITE_PATHS`, so a test cannot assert path validity at compile time. Narrowing touches unaudited callers |
| Bring the repo root under `tsc` | root `vitest.config.ts`, `test/` | `pnpm-workspace.yaml` lists only `packages/*`, so `pnpm -r exec tsc` never reaches the root |
| Make server's Node types a direct dependency | `server/package.json` | Resolves `node:*` only transitively via `@types/ws`; drop or bump that and server tests silently lose Node types |

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
