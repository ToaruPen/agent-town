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
- per-season directive upkeep — no N1 directive has one, so the `directiveUpkeep` ledger reason is frozen now and stays unused;
- a distinct wealth-production field on `NationState` — `openMine` yields materials and trade income is the wealth source (spec §4.5);
- LLM rulers, generated prose, nation naming by LLM (N4);
- crisis events, plagues, magical anomalies (N5);
- victory conditions, replay, save/load;
- reviving or rendering the resident-scale simulation;
- new dependencies, new assets, fonts or images.

## Frozen Contracts

Do not rename these, make fields optional, or add fields while executing this plan. If a task appears to need a change, stop and raise it with the supervisor.

**One known divergence, deliberate.** `ActiveDirective.totalSeasons` and the `orders` message were added to these blocks after Tasks 1–3 were dispatched, so `packages/shared/src/nation.ts` and `protocol.ts` do not match them yet. Task 4 brings `nation.ts` into line and Task 5 brings `protocol.ts`. Until then, a byte-for-byte check against these blocks will differ by exactly those two items and nothing else.

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
  totalSeasons: number; // so progress is self-describing without the candidate list
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
  DirectiveBlockedReason,
  DirectiveId,
  DirectiveKind,
  DirectiveOption,
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
    }
  | {
      type: "orders";
      tick: number;
      nationId: NationId; // always the receiving client's own nation
      autoPilot: boolean;
      options: DirectiveOption[];
      queued: { id: DirectiveId; kind: DirectiveKind; targetCityId: string | null } | null;
      chancellorChoice: { kind: DirectiveKind; targetCityId: string | null } | null;
      rejected: DirectiveBlockedReason | "notYourNation" | "unknownNation" | null;
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

`orders` is the client's own order desk, and it exists because the earlier wire could not deliver the game's only verb. `DirectiveOption` was defined and never transmitted: `NationState.activeDirectives` says what is *running*, never what is *offered*, so the directive panel that spec §7.2 requires — candidates, costs, durations, cultural fit, blocked reasons — had no source. `orders` carries that list, and because nation state changes only at boundaries the list is a stable snapshot the player can deliberate over for the whole season, including indefinitely at speed 0.

It is also the only acknowledgement that survives a pause. `clock` carries no nation state and `season` never fires at speed 0, so without `orders` a paused player issuing a directive would see nothing, and a rejected order would be indistinguishable from an accepted one. `orders` is therefore emitted on an accepted `selectNation`, on **every** `issueDirective`, `cancelDirective` and `setAutoPilot` whatever the outcome, and once after each `season`. Nothing else. `setSpeed` needs no entry: `clock` already echoes `speed` at roughly 1 Hz at every speed including 0.

The server mints the `DirectiveId` when it accepts the order, not at the boundary where the directive becomes active. That makes `cancelDirective` work uniformly on queued and active directives — a queued order with no id yet would be uncancellable — and lets the client tell its own directives from the chancellor's by remembering the ids it queued, with no contract change.

`chancellorChoice` is what the chancellor would pick right now. It is exact rather than a guess: the chancellor is pure and nation state does not change mid-season. It is what lets the HUD always answer "what commits at the next boundary", which is the question a real-time game with a 30-second decision interval has to keep answered. In N4 the LLM ruler must receive the same value in its prompt context, or the player holds an information edge over the agents.

Rival redaction is **not** solved in N1 and this is deliberate. `season` ships `NationState[]` in full, so a player with devtools open can read rival stocks, active directives and reports. The frozen `NationState` has no public-only variant, and inventing one now would ripple through every task. The client renders only the public set for rivals — name, colour, `controller`, `prosperity` and its components, `population`, `territoryCellCount`, `cities[]`, and the `Polity` prose the chronicle already shows — and server-side redaction of the `season` payload belongs to N3, where diplomacy makes hidden information matter.

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
| 2 | Population scaling from history effects, capital population weighting, value-driven starting-stock coefficients, terrain production coefficients |
| 3 | Directive costs, durations, completion-effect magnitudes, city development cap, the **signed** kind → cultural-value affinity table, the taboo affinity threshold, the chancellor deficit bonus, the chancellor low-stability threshold |
| 4 | Per-capita food production and consumption, trade-route income, city growth and capacity rates, famine population loss, stability drift bounds, culture gain, **initial stability and initial culture**, prosperity weights (population 0.30, production 0.25, wealth 0.20, stability 0.15, culture 0.10) and the fixed normalisation reference per component |
| 7 | No new constants — tunes the values above |

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
| 6 | Claude | Client — moved to its own plan, `2026-07-27-c1-nation-client.md` | see C1 | C1's own gates |
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

Files this task may touch: `packages/server/src/sim/nation/directives.ts` (new), `packages/server/src/sim/nation/chancellor.ts` (new), `packages/shared/src/constants.ts` (append only), and its own new test files. No others. The frozen contracts do not change — this task needs no amendment to them.

**Candidate listing.** `listDirectiveOptions(nation, polity, worldMap): DirectiveOption[]` returns options every season. Every `DirectiveKind` is represented every season: an unavailable one carries a non-null `blockedReason` rather than being omitted, so the UI can explain it. `growCity` yields one option **per owned city**, each with its own `targetCityId` and its own blocked reason; every other kind yields exactly one option with `targetCityId: null`. Nothing downstream may choose or apply a blocked option.

**Preconditions**, evaluated in this fixed order so the reported reason is deterministic when more than one applies:

1. `taboo` — the kind's affinity for this polity is at or below `NATION_DIRECTIVE_TABOO_AFFINITY`.
2. `missingTerrain` — `openMine` needs an owned `hills` or `mountains` cell; `developTimber` needs an owned `forest` cell.
3. `cityAtMaxDevelopment` — this option's city is at `NATION_CITY_DEVELOPMENT_CAP`.
4. `alreadyActive` — an `ActiveDirective` with the same kind and the same `targetCityId` exists.
5. `insufficientFood`, then `insufficientMaterials`, then `insufficientWealth` — the cost exceeds the matching stock.

**Affinity.** A constant table maps each `DirectiveKind` to **signed** coefficients over `CulturalValue`. The signs carry the meaning: felling marked timber and clearing old-growth land run against `stewardship`, so those entries are negative, while a festival expresses `faith` and `kinship` positively. `affinity` is the sum of each coefficient times the polity's weight for that value — zero when the polity has no weight for it — clamped to -1..1. A polity with no weighted value in a kind's table gets affinity 0.

Note that `Polity.values` weights are only ever positive (0.35 when an event introduces a value, 0.65 and 0.8 at founding, capped at 1). Affinity can therefore only go negative through negative coefficients in this table. A table of positive coefficients would make the `taboo` reason unreachable.

**Taboo.** `Polity.taboo` is free-form prose about moral conduct toward people, and of the eight polity templates only one has any structural link to an economic directive, so the `taboo` reason is derived from the affinity table rather than parsed from the string — see spec §4.5. A kind at or below the threshold is refused outright: the nation will not do it at any price. Choose the coefficients and the threshold so at least one generated polity refuses at least one kind; a threshold that blocks nothing makes the reason decorative.

**Effects.** Two shapes only, both expressible in the frozen `NationState`.

*On completion*, applied once when `seasonsRemaining` reaches zero:

| kind | effect |
|---|---|
| `clearFarmland` | `foodProduction` += constant |
| `developTimber` | `materialProduction` += constant |
| `openMine` | `materialProduction` += a larger constant |
| `growCity` | target city `developmentLevel` += 1, never past the cap |
| `encourageStores` | `stocks.food` += constant |
| `holdFestival` | `stability` += constant and `culture` += constant |

*While active*, read from `activeDirectives` by the season pipeline with no field of its own: only `encourageStores` has one, reducing famine loss. Task 4 owns that reduction and its constant.

`openMine` yields materials, not wealth: the frozen `NationState` has no wealth-production field, and Task 4's trade income already gives wealth a source. Spec §4.5 was changed to match the contract rather than the contract being amended.

**Cost** is charged once, at the season boundary where the directive becomes active, and Task 4 logs it as a `directiveCost` entry. No directive has a per-season upkeep in N1, so the `directiveUpkeep` ledger reason stays unused this slice, like `changedCells`.

**Applying effects.** Export a descriptor, not a mutator, so Task 4 owns every state transition and can write the matching ledger entries:

```ts
export interface DirectiveCompletion {
  foodProductionDelta: number;
  materialProductionDelta: number;
  stockDeltas: NationStocks;
  stabilityDelta: number;
  cultureDelta: number;
  cityDevelopment: { cityId: string; delta: number } | null;
}

export function completeDirective(
  directive: ActiveDirective,
  nation: NationState,
): DirectiveCompletion;
```

Nothing in `directives.ts` mutates a `NationState`.

**Chancellor.** `chancellor.ts` exports `chooseDirective(nation, polity, options, lastReport): DirectiveOption | null`.

- Unblocked options only; `null` when none remain.
- Score is `affinity` plus deficit bonuses:
  - the `lastReport` entries for metric `food` sum to a negative number → `NATION_CHANCELLOR_DEFICIT_BONUS` for `clearFarmland` and `encourageStores`;
  - the same test on metric `materials` → the same bonus for `developTimber` and `openMine`;
  - `nation.stability` below `NATION_CHANCELLOR_LOW_STABILITY` → the same bonus for `holdFestival`. This reads the absolute stability, not a delta, because `SeasonReport` carries only deltas.
  - `lastReport === null`, the first season, adds no bonus.
- Highest score wins; ties break by the declaration order of `DirectiveKind`, then by ascending `targetCityId`.
- No RNG at all, no mutation of any input, no import from `net/` or `llm/`.

**Constants this task owns:** per-kind cost, per-kind duration in seasons, per-kind completion-effect magnitudes, the city development cap, the signed kind → cultural-value affinity table, the taboo affinity threshold, the chancellor deficit bonus, and the chancellor low-stability threshold. Nothing else — in particular, do not touch Task 2's starting values or add anything Task 4 owns.

- Tests: each blocked reason fires for the right state, and wins the precedence order when two apply at once; every `DirectiveKind` appears every season; `growCity` yields one option per owned city; at least one generated polity refuses at least one kind through `taboo`; two polities with opposing value weights choose different directives from the same state; repeated `chooseDirective` calls on the same input are identical; a nation with empty stocks gets `null`; `completeDirective` is pure and its deltas match the constants; `growCity` never carries a city past the cap.

### Task 4 — Season pipeline and prosperity

- `season.ts` exports `resolveSeason(nations, polities, worldMap, tick): { nations: NationState[]; reports: Map<NationId, SeasonReport> }`, pure and snapshot-based.
- Pipeline order is exactly §4.3 of the spec: directives → production → consumption → population → stability → territory/cities → prosperity → report.
- Every mutation of a `SeasonMetric` appends a `SeasonLedgerEntry` with its reason. Summing the entries for a metric must equal the observed change in that metric — assert this in tests.
- Famine: food stock reaching zero with unmet demand reduces population and stability by constant rates and logs `famine` entries.
- `prosperity.ts` exports `computeProsperity(nation): ProsperityScore`, normalising each component against its fixed reference constant and clamping to 0..1000.
- Add `totalSeasons: number` to `ActiveDirective` in `packages/shared/src/nation.ts` so it matches the frozen block, set it from the option's `seasons` wherever a directive becomes active, and update any Task 3 test fixture that builds an `ActiveDirective` literal. This is a supervisor-authorised amendment made after Task 3 was dispatched — the reason is under the frozen protocol: a HUD cannot show a directive's progress from `seasonsRemaining` alone, and the total lives on `DirectiveOption`, which the client never receives for rival nations.
- **The five components are the normalised 0..1 ratio against their reference constant, not raw metrics.** The contract documents only `total`, which leaves the components ambiguous, and the client is forbidden from reconstructing the normalisation itself — so pin it here and assert it in the tests. `total` is the weighted sum times 1000. The client renders each component's contribution as `weight × component × 1000` and displays `total` verbatim; it never sums contributions into a total of its own.
- Tests: pipeline order observable through the ledger; ledger sums match state deltas; reordering the input array does not change any nation's result; removing a rival nation does not change another nation's score; a full famine cycle behaves as specified.
- Replace bootstrap's placeholder starting values for `stability` and `culture`. Task 2 had no owned constant for either and left `stability` as the history population points clamped to 0..100, which saturates near 100 for most nations, and `culture` as the raw sum of cultural-value weights. Both need a named constant and a derivation that leaves headroom in **both** directions from the start, so the stability and culture components of the prosperity score can actually move. `developmentLevel` starting at `0` is correct and stays.
- Tests: no bootstrapped nation starts with `stability` at either bound; two nations with different histories start with different stability and different culture.

### Task 5 — Real-time engine, protocol, server

- `engine.ts` owns tick advance and season-boundary detection; it calls `resolveSeason` and returns the new state plus the reports. No wall-clock inside.
- `wsServer.ts` drives the loop, applies `SPEED_MULTIPLIERS` to pacing only, broadcasts `clock` on a `CLOCK_BROADCAST_MS` wall-clock interval — never on a tick count, which would scale the heartbeat with speed — and `season` at boundaries, and sends `welcome` on connect.
- Client messages are validated server-side: an unknown nation, an unaffordable or blocked directive, a directive for another nation, or an out-of-range speed is rejected and never mutates state.
- Player directives queue and take effect at the next season boundary. When a nation is on auto-pilot (or is an agent nation), the chancellor's choice is applied at the boundary instead.
- Emit `orders` exactly on the triggers listed under the frozen protocol: an accepted `selectNation`, every `issueDirective` / `cancelDirective` / `setAutoPilot` regardless of outcome, and once after each `season`. Mint the `DirectiveId` at accept time, not at the boundary. A rejected order returns `rejected` non-null with `queued` unchanged, and mutates no state.
- `ActiveDirective.totalSeasons` is set from the option's `seasons` when the directive becomes active, and never changes as `seasonsRemaining` counts down.
- **A newly activated directive must reach `resolveSeason` with `seasonsRemaining === totalSeasons`, and Task 5 must not decrement it at activation.** Task 4 charges a directive's cost exactly when those two are equal (`season.ts` `chargeDirective`), which is how "this is its first season" is detected without a flag on the contract. Decrementing at activation would make every directive free, and no test on either side would catch it — Task 4's tests build their own directives and Task 5's would see a plausible-looking ledger with no `directiveCost` entries. Add a test that issuing a directive produces exactly one `directiveCost` entry for it across its whole lifetime.
- World generation calls `generateWorldHistory(seed)` with no resident surface, so `history.landmarks` is empty in N1 — `createLandmarks` returns `[]` when its map argument is undefined (`historyGen.ts:581`), and landmark positions are expressed in the 64×48 resident frame anyway. This is correct, not a bug: nothing in N1 renders landmarks. Do not generate a resident surface to populate them.
- `index.ts` accepts a `SEED` env var (positive integer) and keeps the time-based default when unset. Determinism tests use `SEED`.
- The old resident-sim wiring is removed from `wsServer.ts`. Its modules and tests stay untouched in the tree.
- Update the protocol tests to the new shapes; do not delete them.
- **A scoped, supervisor-authorised exception to the ownership split.** Reshaping `protocol.ts` breaks the client, because `packages/client/src/net/wsClient.ts` switches on `"update"` and assigns `welcome.state` to a `WorldState`. Every commit must be green, so the migration cannot straddle two tasks, and `AGENTS.md` says not to keep backward compatibility — a dual wire format would leave a fake protocol in the tree for someone to remember to remove. So Task 5 may edit exactly three client files and no others:
  - `packages/client/src/net/wsClient.ts` — decode the new messages, hold `NationWorldState`.
  - `packages/client/test/wsClient.test.ts` — update to the new shapes. Do not delete a test. If one cannot be expressed against the new protocol, stop and report.
  - `packages/client/src/main.ts` — reduce to a shell.

  The shell has hard requirements, because the client plan builds on it and two of them are easy to lose:
  - **Keep the Pixi `Application` alive**, along with `TextureStyle.defaultOptions.scaleMode = "nearest"` and the `Assets.load([...SPRITE_PATHS])` preload. It renders nothing for now and becomes the local city view's renderer. Deleting it would mean a second WebGL context later for no reason.
  - Unmount the resident stack; delete no render module, no view model and no test. They stay in the tree, green, and the city view drives several of them unchanged.
  - The page must boot without throwing.
  - **No design decisions.** No HUD, no layout, no panel, no new UI file. C1-3 builds all of that against this shell. If the shell seems to need a UI decision to compile, that is the signal to stop and report.
- Tests: welcome shape; `clock` carries no nation state; `season` fires exactly on boundaries; identical state at tick N under speeds 1, 4 and a pause/resume cycle; every invalid client message rejected; a headless run of `NATION_TICKS_PER_YEAR * 20` ticks completes with no thrown error, no negative stock and no spawned process.

### Task 6 — Client (moved)

Client work has its own plan and its own owner: `docs/superpowers/plans/2026-07-27-c1-nation-client.md`. It grew past a single task once the owner asked for the world ↔ local traversal, and it belongs to the client worker under the ownership split. N1 is demonstrable in a browser when C1-1 through C1-5 have landed.

Two consequences for the simulation worker, because they are easy to break from this side:

- The Pixi `Application` in `packages/client/src/main.ts` must stay alive when the resident stack is unmounted. It becomes the local city view's renderer, and it is the only Pixi consumer left, so re-creating it later would mean a second WebGL context for no reason.
- The resident and local-terrain layers (`agentLayer`, `deathLayer`, `hudLayer`, `tickerLayer`, `structureLayer`, `trailLayer`, `terrainDecor`, `shadow`, `motion`, `mapLayer`, `sprites`, and the survival/society view models) stay in the tree with their tests green. The local city view drives several of them unchanged.

### Task 7 — Balance

- Add a headless smoke script (not a server) that runs 20 game years at a fixed seed with every nation on auto-pilot and prints per-nation prosperity every 5 years.
- Tune only `packages/shared/src/constants.ts` until: no nation collapses to zero population by year 20 under auto-pilot; the ranking changes hands at least once; the top and bottom prosperity totals differ by at least 15%; no stock goes negative or unbounded.
- Record the final constants and the resulting 20-year table in the commit body.
- **The taboo threshold sits on a knife edge and the constants alone do not show it.** At Task 3's first values the moss-keeper polity (`stewardship` 0.8) lands at affinity −0.8 for `developTimber`, just past the −0.75 threshold, and −0.735 for `clearFarmland`, just short of it. So it refuses to fell timber but will grudgingly clear land, and a small change to either the threshold or a `stewardship` coefficient flips that. Any tuning here must re-check that at least one generated polity still refuses at least one kind — the reachability test guards it, but read what it actually asserts before changing a coefficient.
- `chooseDirective` takes a `polity` it does not use, because affinity is precomputed into each option. Leave the parameter: N4's LLM ruler and any future scoring that reads `ambition` or the taboo prose will want it, and removing it would be a contract change for no gain.

## Completion Criteria

- `just check && just test` pass at every commit.
- Two runs with the same `SEED` produce identical nation state at the same tick; different seeds differ.
- Opening the browser shows live nations, a moving ranking, a working directive panel and a working speed control, with no LLM process ever spawned.
- A nation that is never given an order still develops under its chancellor, and its choices reflect its cultural values.
- The ledger explains every change it can carry: for each of the six `SeasonMetric` values in any season, the report's entries sum to the observed delta. `foodProduction`, `materialProduction` and `developmentLevel` are production capacity, not `SeasonMetric` values, so directive completions change them without a ledger entry; `completedDirectiveIds` is what explains those.
- Frozen resident-scale modules and their tests remain in the tree and green.

## Worker Rules

- TDD: failing test → implement → green → commit. Conventional Commits.
- Never delete or disable a test. A bug fix needs a failing-then-passing test.
- Do not add dependencies. Do not add assets.
- Do not dispatch reviewer sub-agents. The commit is part of the task; never end a task with uncommitted work.
- Do not push. The supervisor merges and pushes.
- No absolute local paths in code, docs or commit messages.
- Implement the frozen contracts exactly as written — creating `nation.ts` and reshaping `protocol.ts` is part of the work. What is frozen is their content: never rename a field, change a type, add a field, or make one optional. If a contract looks wrong, stop and report instead of editing it.
