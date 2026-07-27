# N1 — Living Nations Implementation Plan

**Goal:** Turn the generated world into a live, real-time contest between nations. Surviving polities become playable powers with stocks, population, stability and a prosperity score; a deterministic chancellor governs every nation that receives no orders; the player picks one nation and issues economic directives; the world advances continuously with pause and speed control.

**Spec:** `docs/superpowers/specs/2026-07-27-nation-rulers-realtime-design.md` (§4, §10).

**Architecture:** Freeze the live-nation contracts in `packages/shared/src/nation.ts` and all tuning numbers in `packages/shared/src/constants.ts`. Build the simulation as pure modules under `packages/server/src/sim/nation/`, driven by a tick loop in `net/wsServer.ts`. Reuse `historyGen`, `worldMapGen` and `rng` unchanged as the world generator. The whole resident-scale simulation is frozen — `sim/engine.ts`, `executor.ts`, `astar.ts`, `fakePlanner.ts`, `worldGen.ts`, `society.ts`, `foodAnxiety.ts`, `spatialDemand.ts`, `siteSelection.ts`, `construction.ts`, `facilityOperation.ts`, `traffic.ts`, `farming.ts`, the `shared/spatial.ts` contracts, and the client resident/terrain layers. They stay in the tree with their tests green, but nothing in this slice imports them.

**Tech Stack:** TypeScript 7, Vitest, WebSocket, HTML Canvas 2D, Vite, Biome, pnpm, just.

**No LLM in this slice.** The `llm/` package is untouched; the server must run the whole slice without it.

---

## Scope

The slice is complete when:

- every polity still alive at the end of world-history generation becomes a live nation with derived stocks, cities, population and stability;
- the same seed produces deeply identical nations, and a different seed changes them;
- a season resolves every `NATION_TICKS_PER_SEASON` ticks through a fixed pipeline and emits a structured `SeasonReport` in which every delta carries a reason;
- each nation has a prosperity score with a visible breakdown, and nations are ranked by it;
- directives can be listed, validated, issued, paid for and completed, and blocked candidates state why they are blocked;
- the chancellor picks a directive deterministically from the nation's cultural values and its last report, so a nation that is never given orders still develops;
- the player selects a nation, issues directives, toggles auto-pilot, and changes speed including pause;
- speed and pause change wall-clock pacing only: the state at tick N is identical at every speed;
- the server completes 20 game years headless with no LLM process spawned.

Explicitly out of scope:

- diplomacy, war, territory change, colonisation (N3) — the `changedCells` protocol field is frozen now but stays empty;
- LLM rulers, generated prose, nation naming by LLM (N4);
- crisis events, plagues, magical anomalies (N5);
- victory conditions, replay, save/load;
- reviving or rendering the resident-scale simulation;
- new dependencies, new assets, fonts or images.

## Frozen Contracts

Do not rename these, make fields optional, or add fields while executing this plan. If a task appears to need a change, stop and raise it with the supervisor.

### `packages/shared/src/nation.ts` (new)

```ts
import type { SEASONS } from "./constants.js";
import type { WorldHistory } from "./history.js";

export type NationId = string; // equals Polity.id
export type DirectiveId = string;
export type Season = (typeof SEASONS)[number];
export type NationController = "player" | "agent";
export type SpeedMultiplier = 0 | 1 | 2 | 4 | 8; // 0 = paused

export interface NationStocks {
  food: number;
  materials: number;
  wealth: number;
}

export type DirectiveKind =
  | "clearFarmland"
  | "developTimber"
  | "openMine"
  | "growCity"
  | "encourageStores"
  | "holdFestival";

export type DirectiveBlockedReason =
  | "insufficientFood"
  | "insufficientMaterials"
  | "insufficientWealth"
  | "missingTerrain"
  | "cityAtMaxDevelopment"
  | "taboo"
  | "alreadyActive";

export interface DirectiveOption {
  kind: DirectiveKind;
  targetCityId: string | null;
  cost: NationStocks;
  seasons: number;
  /** Fit with the nation's cultural values, -1..1. Feeds stability and chancellor scoring. */
  affinity: number;
  blockedReason: DirectiveBlockedReason | null;
}

export interface ActiveDirective {
  id: DirectiveId;
  kind: DirectiveKind;
  targetCityId: string | null;
  issuedAtTick: number;
  seasonsRemaining: number;
}

export interface NationCityState {
  cityId: string; // WorldCity.id
  population: number;
  developmentLevel: number;
}

export type SeasonMetric = "food" | "materials" | "wealth" | "population" | "stability" | "culture";

export type SeasonLedgerReason =
  | "baseProduction"
  | "tradeIncome"
  | "directiveEffect"
  | "directiveCost"
  | "directiveUpkeep"
  | "populationConsumption"
  | "famine"
  | "growth"
  | "stabilityDrift"
  | "cultureAffinity";

export interface SeasonLedgerEntry {
  metric: SeasonMetric;
  delta: number;
  reason: SeasonLedgerReason;
  directiveId: DirectiveId | null;
}

export interface SeasonReport {
  year: number;
  season: Season;
  entries: SeasonLedgerEntry[];
  completedDirectiveIds: DirectiveId[];
}

export interface ProsperityScore {
  population: number;
  production: number;
  wealth: number;
  stability: number;
  culture: number;
  /** Weighted total, 0..1000. */
  total: number;
}

export interface NationState {
  id: NationId;
  controller: NationController;
  autoPilot: boolean;
  stocks: NationStocks;
  cities: NationCityState[];
  territoryCellCount: number;
  population: number;
  /** 0..100. */
  stability: number;
  culture: number;
  foodProduction: number;
  materialProduction: number;
  activeDirectives: ActiveDirective[];
  prosperity: ProsperityScore;
  lastReport: SeasonReport | null;
}

export interface NationWorldState {
  tick: number;
  year: number;
  season: Season;
  speed: SpeedMultiplier;
  history: WorldHistory; // unchanged contract, carries worldMap
  nations: NationState[];
  playerNationId: NationId | null;
}

export interface WorldCellChange {
  index: number;
  polityId: string | null;
}
```

### `packages/shared/src/protocol.ts` (reshaped)

```ts
import type {
  DirectiveId,
  DirectiveKind,
  NationId,
  NationState,
  NationWorldState,
  Season,
  SpeedMultiplier,
  WorldCellChange,
} from "./nation.js";

export type ServerMessage =
  | { type: "welcome"; state: NationWorldState }
  | { type: "clock"; tick: number; year: number; season: Season; speed: SpeedMultiplier }
  | {
      type: "season";
      tick: number;
      year: number;
      season: Season;
      nations: NationState[];
      changedCells: WorldCellChange[];
    };

export type ClientMessage =
  | { type: "hello" }
  | { type: "selectNation"; nationId: NationId }
  | { type: "issueDirective"; kind: DirectiveKind; targetCityId: string | null }
  | { type: "cancelDirective"; directiveId: DirectiveId }
  | { type: "setSpeed"; speed: SpeedMultiplier }
  | { type: "setAutoPilot"; enabled: boolean };
```

`welcome` carries the full initial state exactly once. `clock` is a light heartbeat, emitted on a wall-clock interval so its rate does not change with game speed, and carries no nation state. Nation state changes only at season boundaries, so `season` is the only message that carries `nations`. `changedCells` stays empty in N1 and exists so N3 does not break the wire format.

This replaces the resident-scale wire format wholesale. The current `welcome` payload (`WorldState` with `tiles`, `agents`, `stockpile`, `buildings`, `deaths`, `collectives`, `institutions`, `spatialDemands`, `trailCells`, `history`) and the current `update` payload (`agents`, `stockpile`, `buildings`, `deaths`, `collectives`, `institutions`, `spatialDemands`, `changedTiles`, `changedTrailCells`) are no longer sent. `WorldState` itself stays in `world.ts` because the frozen resident modules and their tests still use it.

### Constants (`packages/shared/src/constants.ts`, appended — never rename existing ones)

Nation-scale time is separate from the frozen resident-scale time constants:

```ts
export const NATION_TICKS_PER_SEASON = 300; // 30 s at x1
export const NATION_TICKS_PER_YEAR = NATION_TICKS_PER_SEASON * SEASONS.length; // 2 min at x1
export const SPEED_MULTIPLIERS = [0, 1, 2, 4, 8] as const;
export const DEFAULT_SPEED: SpeedMultiplier = 1;
export const CLOCK_BROADCAST_MS = 1000; // wall-clock heartbeat; stays ~1 Hz at every speed
```

Those five are the whole of Task 1's constant work. They are frozen: exact names, exact values.

Every other number this slice needs is added by **the task that consumes it**, in the same file, with a
clear name and a one-line comment — never inlined in `sim/nation/`, and never invented ahead of the code
and tests that justify it. The expected owners:

| Task | Constants it appends |
|---|---|
| 2 | Codex | Population scaling from history effects, capital population weighting, value-driven starting-stock coefficients, terrain production coefficients |
| 3 | Codex | Directive costs, durations, effects, city development cap, the kind → cultural-value affinity table |
| 4 | Codex | Per-capita food production and consumption, trade-route income, city growth and capacity rates, famine population loss, stability drift bounds, culture gain, **initial stability and initial culture**, prosperity weights (population 0.30, production 0.25, wealth 0.20, stability 0.15, culture 0.10) and the fixed normalisation reference per component |
| 7 | Codex | No new constants — tunes the values above |

Only the prosperity weights are fixed in advance, because they define what the game rewards. Every other
value is a first guess that Task 7 is expected to change.

### Determinism rules (apply to every task)

- `sim/nation/` is pure: seeded RNG only, no `Date.now()`, no I/O, no imports from `net/` or `llm/`.
- Season resolution processes nations in ascending `NationId` order and reads a pre-season snapshot for anything cross-national, so processing order cannot change results.
- Speed and pause live in the wall-clock pacing of the loop, never in the tick math.

## Task List

Simulation tasks are sequential; each depends on the previous commit. One branch per task, commit locally,
never push. The supervisor verifies independently, fast-forward merges to the slice branch, and pushes.

Ownership follows `docs/superpowers/handoff/2026-07-27-delegation.md`: the simulation worker (Codex) owns
`packages/shared/` and `packages/server/`, the client worker (Claude subagents) owns `packages/client/`.
Task 6 is the client worker's, and can start as soon as Task 5 has landed the protocol it renders. Parallel
work needs separate worktrees under `.worktrees/`.

| Order | Owner | Assignment | Branch | Independent gate |
|---|---|---|---|---|
| 1 | Codex | Frozen `nation.ts` contracts, nation-scale constants, `nationYearOfTick`/`nationSeasonOfTick` helpers, exports | `n1-01-nation-contracts` | Contract + time-helper tests, `just check && just test`, local commit |
| 2 | Codex | `sim/nation/bootstrap.ts`: derive `NationState[]` from `WorldHistory` | `n1-02-nation-bootstrap` | Determinism, survivor selection, history-derived stocks/values tests, forbidden-import scan, `just check && just test`, local commit |
| 3 | Codex | `sim/nation/directives.ts` + `chancellor.ts`: candidates, preconditions, costs, affinity, effects, deterministic choice | `n1-03-directives-chancellor` | Precondition/cost/taboo/affinity tests, culture-divergence test, `just check && just test`, local commit |
| 4 | Codex | `sim/nation/season.ts` + `prosperity.ts`: fixed pipeline, ledger, score | `n1-04-season-prosperity` | Pipeline-order, ledger-completeness, order-invariance, score tests, `just check && just test`, local commit |
| 5 | Codex | `sim/nation/engine.ts` + protocol reshape + `net/wsServer.ts` wiring + `SEED` env | `n1-05-realtime-protocol` | Speed-invariance, message-shape, directive-validation, headless 20-year smoke tests, `just check && just test`, local commit |
| 6 | Claude | Client: nation dashboard, ranking table, directive panel, season report, speed control, live territory paint | `n1-06-client-nation-ui` | View-model tests, controller tests, build + browser check, `just check && just test`, local commit |
| 7 | Codex | Balance pass: headless 20-year run, tune constants only | `n1-07-balance` | Smoke-run assertions, `just check && just test`, local commit |

### Task 1 — Contracts and constants

- Create `packages/shared/src/nation.ts` exactly as frozen above and export it from `index.ts`.
- Append exactly the five nation-scale time and speed constants to `constants.ts`. Do not touch existing
  constants and do not add economy constants — those belong to the tasks that consume them.
- Add `nationSeasonOfTick(tick)` and `nationYearOfTick(tick)` to `time.ts` next to the existing resident
  helpers; do not modify `seasonOfTick` or `dayOfTick`.
- Years and seasons are **1-based and elapsed**, matching `dayOfTick` returning day 1 at tick 0:
  `nationYearOfTick(0) === 1` and `nationSeasonOfTick(0) === SEASONS[0]`. `nationYearOfTick` counts game
  years played, not calendar years. The calendar year shown to the player is
  `history.currentYear + nationYearOfTick(tick) - 1`, computed at the display edge in Task 6, never here.
- Tests: year/season boundaries at tick 0, at `NATION_TICKS_PER_SEASON - 1`, at exact multiples, and
  across a year rollover.

### Task 2 — Nation bootstrap

- `bootstrap.ts` exports `bootstrapNations(history: WorldHistory, playerNationId: NationId | null): NationState[]`.
- A polity is live when it still owns at least one cell in `history.worldMap.cells`. Dead polities never become nations.
- Initial population folds the polity's `population` history effects, scaled by a constant, and is distributed across its cities with the capital weighted highest.
- Initial stocks derive from the polity's cultural values and its owned terrain: `mutualAid`/`stewardship` raise starting food, `commerce` raises starting wealth, `valor`/`order` raise materials. Every coefficient is a named constant.
- `foodProduction`/`materialProduction` derive from owned terrain counts. `territoryCellCount` counts owned cells.
- `controller` is `"player"` for `playerNationId`, `"agent"` otherwise; `autoPilot` starts `true` for every nation.
- `prosperity` is computed by task 4's module once it exists; until then bootstrap fills a zeroed score, and task 4 wires the real call.
- Tests: same history → deeply identical nations; different seed → different nations; dead polities excluded; value-driven stock differences; population conserved across the city split.

### Task 3 — Directives and chancellor

- `directives.ts` exports `listDirectiveOptions(nation, polity, worldMap): DirectiveOption[]` and `applyDirectiveEffects(...)` used by the season pipeline.
- Every `DirectiveKind` appears in the returned list every season. Unavailable ones carry a non-null `blockedReason` instead of being omitted, so the UI can explain them.
- `openMine` requires an owned `hills` or `mountains` cell (`missingTerrain`). `growCity` requires a city below the development cap. A directive already active on the same target is `alreadyActive`. `Polity.taboo` blocks the matching kind with `taboo`.
- `affinity` is computed from `Polity.values` weights and a constant table mapping each kind to the cultural values it expresses.
- `chancellor.ts` exports `chooseDirective(nation, polity, options, lastReport): DirectiveOption | null`. It scores unblocked options by affinity plus a deficit term read from `lastReport` (a food deficit last season raises farmland; low stability raises festival), and picks the highest score with a stable tie-break by `DirectiveKind` ordering. It may return `null` when nothing is affordable.
- The chancellor never calls RNG, never mutates its inputs, and never imports from `llm/` or `net/`.
- Tests: each blocked reason fires for the right state; two polities with opposite value weights choose different directives from the same state; repeated calls are identical; a nation with an empty treasury gets `null`.

### Task 4 — Season pipeline and prosperity

- `season.ts` exports `resolveSeason(nations, polities, worldMap, tick): { nations: NationState[]; reports: Map<NationId, SeasonReport> }`, pure and snapshot-based.
- Pipeline order is exactly §4.3 of the spec: directives → production → consumption → population → stability → territory/cities → prosperity → report.
- Every mutation of a `SeasonMetric` appends a `SeasonLedgerEntry` with its reason. Summing the entries for a metric must equal the observed change in that metric — assert this in tests.
- Famine: food stock reaching zero with unmet demand reduces population and stability by constant rates and logs `famine` entries.
- `prosperity.ts` exports `computeProsperity(nation): ProsperityScore`, normalising each component against its fixed reference constant and clamping to 0..1000.
- Tests: pipeline order observable through the ledger; ledger sums match state deltas; reordering the input array does not change any nation's result; removing a rival nation does not change another nation's score; a full famine cycle behaves as specified.
- Replace bootstrap's placeholder starting values for `stability` and `culture`. Task 2 had no owned constant for either and left `stability` as the history population points clamped to 0..100, which saturates near 100 for most nations, and `culture` as the raw sum of cultural-value weights. Both need a named constant and a derivation that leaves headroom in **both** directions from the start, so the stability and culture components of the prosperity score can actually move. `developmentLevel` starting at `0` is correct and stays.
- Tests: no bootstrapped nation starts with `stability` at either bound; two nations with different histories start with different stability and different culture.

### Task 5 — Real-time engine, protocol, server

- `engine.ts` owns tick advance and season-boundary detection; it calls `resolveSeason` and returns the new state plus the reports. No wall-clock inside.
- `wsServer.ts` drives the loop, applies `SPEED_MULTIPLIERS` to pacing only, broadcasts `clock` on a `CLOCK_BROADCAST_MS` wall-clock interval — never on a tick count, which would scale the heartbeat with speed — and `season` at boundaries, and sends `welcome` on connect.
- Client messages are validated server-side: an unknown nation, an unaffordable or blocked directive, a directive for another nation, or an out-of-range speed is rejected and never mutates state.
- Player directives queue and take effect at the next season boundary. When a nation is on auto-pilot (or is an agent nation), the chancellor's choice is applied at the boundary instead.
- `index.ts` accepts a `SEED` env var (positive integer) and keeps the time-based default when unset. Determinism tests use `SEED`.
- The old resident-sim wiring is removed from `wsServer.ts`. Its modules and tests stay untouched in the tree.
- Update the protocol tests to the new shapes; do not delete them.
- Tests: welcome shape; `clock` carries no nation state; `season` fires exactly on boundaries; identical state at tick N under speeds 1, 4 and a pause/resume cycle; every invalid client message rejected; a headless run of `NATION_TICKS_PER_YEAR * 20` ticks completes with no thrown error, no negative stock and no spawned process.

### Task 6 — Client

- Reuse the existing world-map canvas and chronicle/国柄 renderers. Do not fork them.
- Add, as pure tested view models plus a thin DOM adapter, in Japanese: nation selection at start, own-nation dashboard (備蓄・人口・安定度・進行中の施策), ranking table (順位・国名・繁栄度・内訳), directive panel (候補・コスト・所要季数・国柄適合・不可理由), season report panel (前季の増減と理由), speed control (一時停止 / x1 / x2 / x4 / x8) with year and season readout, and auto-pilot toggle.
- The client computes no score and no directive availability; it renders what the server sends.
- Resident and local-terrain layers (`agentLayer`, `deathLayer`, `hudLayer`, `tickerLayer`, `structureLayer`, `trailLayer`, `terrainDecor`, `shadow`, `motion`, `mapLayer`, `sprites`, plus the survival/society view models) are no longer mounted from `main.ts` but remain in the tree with their tests green.
- Tests: view models for ranking, directive list, and season report; the controller sends the right client message for each control; blocked directives render their reason and cannot be submitted.

### Task 7 — Balance

- Add a headless smoke script (not a server) that runs 20 game years at a fixed seed with every nation on auto-pilot and prints per-nation prosperity every 5 years.
- Tune only `packages/shared/src/constants.ts` until: no nation collapses to zero population by year 20 under auto-pilot; the ranking changes hands at least once; the top and bottom prosperity totals differ by at least 15%; no stock goes negative or unbounded.
- Record the final constants and the resulting 20-year table in the commit body.

## Completion Criteria

- `just check && just test` pass at every commit.
- Two runs with the same `SEED` produce identical nation state at the same tick; different seeds differ.
- Opening the browser shows live nations, a moving ranking, a working directive panel and a working speed control, with no LLM process ever spawned.
- A nation that is never given an order still develops under its chancellor, and its choices reflect its cultural values.
- The ledger explains every change: for any metric in any season, the report's entries sum to the observed delta.
- Frozen resident-scale modules and their tests remain in the tree and green.

## Worker Rules

- TDD: failing test → implement → green → commit. Conventional Commits.
- Never delete or disable a test. A bug fix needs a failing-then-passing test.
- Do not add dependencies. Do not add assets.
- Do not dispatch reviewer sub-agents. The commit is part of the task; never end a task with uncommitted work.
- Do not push. The supervisor merges and pushes.
- No absolute local paths in code, docs or commit messages.
- Implement the frozen contracts exactly as written — creating `nation.ts` and reshaping `protocol.ts` is part of the work. What is frozen is their content: never rename a field, change a type, add a field, or make one optional. If a contract looks wrong, stop and report instead of editing it.
