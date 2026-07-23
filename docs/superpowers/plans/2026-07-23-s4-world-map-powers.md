# World Map and Powers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a deterministic Song-of-Syx-style overworld in which old-world polities, cities, trade routes, war-shaped borders, and the player's frontier settlement occupy coherent world-space positions, then expose it through an interactive Japanese world-map tab.

**Architecture:** Add a frozen `WorldMap` contract and all generation constants to `packages/shared`, then build the map in a pure seeded `packages/server/src/sim/worldMapGen.ts` module from the already-generated `WorldHistory`. Attach the immutable map to `WorldHistory`, send it once in welcome while leaving updates unchanged, and render it through tested client view-model functions plus a thin canvas/DOM adapter inside the existing chronicle panel.

**Tech Stack:** TypeScript 7, Vitest, HTML Canvas 2D, WebSocket, Vite, Biome, pnpm, just

---

## Scope

This plan implements the regional-map part of §10.3 and the spatial evidence
required by §5 of
`docs/superpowers/specs/2026-07-23-emergent-fantasy-society-design.md`.

The slice is complete when:

- every generated polity occupies a contiguous, population-proportional
  territory on a `96 × 64` overworld;
- capitals, secondary cities, trade routes, and recorded war border changes
  resolve to real history events;
- the local settlement has one stable world-space position in unclaimed land
  immediately beyond its homeland's territory;
- the same seed produces a deeply identical `WorldHistory.worldMap`, while a
  different seed changes it;
- welcome sends the complete map once and the 10 Hz update shape remains
  byte-for-byte free of `history` and `worldMap`;
- the existing chronicle panel contains Japanese `世界地図` and `年代記` tabs,
  and selecting a polity highlights its cities/routes and reuses the existing
  国柄 card renderer.

The following are explicitly out of scope:

- live territorial expansion, diplomacy, conquest, or trade simulation after
  world creation;
- route pathfinding, road traffic, trade income, or travel-time mechanics;
- overworld zoom, pan, editing, fog of war, or save migration;
- projecting the local `64 × 48` tile map into multiple overworld cells;
- moving existing `HistoricalLandmark.pos` values from local-map coordinates
  onto the overworld or adding new ruin rendering;
- new history event kinds, LLM calls, generated prose, dependencies, images,
  fonts, or other assets.

`HistoricalLandmark` remains the existing local-map trace. This slice adds only
the fixed cities, routes, territory, border-change provenance, and settlement
position requested here.

## Frozen Contracts

Do not rename, make optional, or add fields to these contracts while executing
this plan. The cell contract remains exactly terrain plus polity ownership.
Algorithmic base borders derive from capital founding events and population
effects; war provenance is stored separately in `borderChanges` so rendering
and causal inspection do not pollute every cell.

Create `packages/shared/src/worldMap.ts`:

```ts
import type { Position } from "./world.js";

export type WorldMapTerrain =
  | "sea"
  | "plains"
  | "forest"
  | "hills"
  | "mountains";

export interface WorldMapCell {
  terrain: WorldMapTerrain;
  polityId: string | null;
}

export interface WorldCity {
  id: string;
  name: string;
  pos: Position;
  polityId: string;
  isCapital: boolean;
  foundedByEventId: string;
}

export interface WorldTradeRoute {
  id: string;
  cityIds: [string, string];
  establishedByEventId: string;
}

export interface WorldBorderChange {
  id: string;
  pos: Position;
  formerPolityId: string;
  currentPolityId: string;
  establishedByEventId: string;
}

export interface WorldMap {
  width: number;
  height: number;
  cells: WorldMapCell[];
  cities: WorldCity[];
  tradeRoutes: WorldTradeRoute[];
  borderChanges: WorldBorderChange[];
  settlementFrontierPos: Position;
}
```

`WorldMap.cells` is row-major:

```ts
const index = pos.y * worldMap.width + pos.x;
```

`WorldHistory` gains one required field:

```ts
export interface WorldHistory {
  startYear: number;
  currentYear: number;
  polities: Polity[];
  events: HistoryEvent[];
  landmarks: HistoricalLandmark[];
  settlementOrigin: SettlementOrigin | null;
  worldMap: WorldMap;
}
```

The server generator exposes only this public interface:

```ts
export type WorldMapHistory = Pick<
  WorldHistory,
  "polities" | "events" | "settlementOrigin"
>;

export function generateWorldMap(
  seed: number,
  history: WorldMapHistory,
): WorldMap;
```

All arrays use stable generation order. IDs are deterministic:

```text
city-<polityId>-<1-based slot>
route-<history event id>
border-<history event id>-<1-based changed cell>
```

No date, UUID, array length from mutable live state, or unseeded random source
may contribute to an ID.

## Constants Table

Every number or fixed label that controls generation or canvas sizing belongs
in `packages/shared/src/constants.ts`. Do not inline these rules in
`worldMapGen.ts`, `worldMapView.ts`, or `worldChronicle.ts`.

| Constant | Exact value | Purpose |
|---|---:|---|
| `WORLD_MAP_WIDTH` | `96` | Overworld columns |
| `WORLD_MAP_HEIGHT` | `64` | Overworld rows |
| `WORLD_MAP_RNG_SALT` | `0x9e3779b9` | Independent mulberry32 substream from the WorldHistory seed |
| `WORLD_MAP_NOISE_PASSES` | `3` | Moore-neighbor smoothing passes for elevation/moisture |
| `WORLD_MAP_ELEVATION_NOISE_WEIGHT` | `0.55` | Smoothed random contribution to elevation |
| `WORLD_MAP_CENTER_BIAS_WEIGHT` | `0.45` | Elliptical island-center contribution to elevation |
| `WORLD_MAP_LAND_THRESHOLD` | `0.46` | Below this elevation is sea |
| `WORLD_MAP_HILLS_THRESHOLD` | `0.62` | At or above this elevation is hills |
| `WORLD_MAP_MOUNTAINS_THRESHOLD` | `0.76` | At or above this elevation is mountains |
| `WORLD_MAP_FOREST_MOISTURE_THRESHOLD` | `0.54` | Moist lowland at or above this value is forest |
| `WORLD_MAP_CLAIMED_LAND_RATIO` | `0.70` | Fraction of non-sea cells divided into polity quotas |
| `WORLD_MAP_CAPITAL_MIN_DISTANCE` | `12` | Minimum Manhattan distance between seeded capitals |
| `WORLD_MAP_CITY_MIN_DISTANCE` | `5` | Preferred Manhattan distance between one polity's cities |
| `WORLD_MAP_CITY_COUNT_MIN` | `1` | Minimum cities per polity |
| `WORLD_MAP_CITY_COUNT_MAX` | `3` | Maximum cities per polity |
| `WORLD_MAP_WAR_BORDER_CELLS_PER_EVENT` | `2` | Maximum cells transferred by one war event |
| `WORLD_MAP_CELL_SIZE_PX` | `6` | Canvas backing-store pixels per map cell |
| `WORLD_MAP_CITY_RADIUS_PX` | `2` | Non-capital city marker radius |
| `WORLD_MAP_CAPITAL_RADIUS_PX` | `3` | Capital marker radius |
| `WORLD_MAP_SETTLEMENT_RADIUS_PX` | `4` | Current-settlement marker radius |
| `WORLD_MAP_POLITY_ALPHA` | `0.28` | Normal polity overlay opacity |
| `WORLD_MAP_SELECTED_POLITY_ALPHA` | `0.52` | Selected polity overlay opacity |

Add these exact fixed tables:

```ts
export const WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS: Readonly<
  Record<WorldMapTerrain, number>
> = {
  sea: 0,
  plains: 1,
  forest: 0.8,
  hills: 0.55,
  mountains: 0.2,
};

export const WORLD_CITY_NAME_SUFFIXES = [
  "府",
  "市",
  "砦",
] as const;
```

`WORLD_CITY_NAME_SUFFIXES.length` must equal
`WORLD_MAP_CITY_COUNT_MAX`. A city's visible name is:

```ts
`${polity.adjective}${WORLD_CITY_NAME_SUFFIXES[slot]}`
```

The existing polity adjectives are Japanese. Tests must reject visible Latin
letters rather than relying on that assumption silently.

## Deterministic Generation Rules

### Seed and terrain

`generateWorldMap` uses the same numeric seed that was passed to
`generateWorldHistory`, but opens a separate existing mulberry32 stream:

```ts
const rng = createRng(seed ^ WORLD_MAP_RNG_SALT);
```

It never receives or mutates the history generator's RNG closure. Therefore
adding a map draw cannot perturb polity/event generation.

Generate terrain in these phases:

1. Fill elevation and moisture arrays with seeded `rng()` values.
2. Run exactly `WORLD_MAP_NOISE_PASSES` smoothing passes. Each output is the
   arithmetic mean of the cell and its in-bounds eight neighbors.
3. Calculate elliptical center bias from normalized `x`/`y` distance and clamp
   it to `0..1`.
4. Combine smoothed elevation with the two configured weights.
5. Classify sea, mountains, hills, forest, and plains using the constants table
   in that order.
6. Keep the largest four-connected non-sea component. Convert every smaller
   component to sea. Break equal component-size ties by the lowest row-major
   cell index.

No `Math.random`, `Date`, I/O, `net/`, `llm/`, DOM, or Node API is allowed in
`packages/server/src/sim/worldMapGen.ts`.

### Population and territories

The final implied population for each current polity is the sum of all
`HistoryEffect` records where `kind === "population"` and
`targetId === polity.id`. The founding event already contributes the initial
population, so no hidden population table is introduced.

Territory quotas are calculated from:

```text
claimable cells =
  floor(non-sea cell count * WORLD_MAP_CLAIMED_LAND_RATIO)

raw polity quota =
  claimable cells * max(1, implied population) / total positive population
```

Floor every raw quota, then distribute the remainder by descending fractional
part, descending implied population, and ascending polity ID. This preserves
the invariant that a strictly larger implied population never receives fewer
base territory cells.

Choose one capital cell per polity from the largest landmass. Seeded candidate
order is stable; prefer plains, then forest, hills, and mountains, and enforce
`WORLD_MAP_CAPITAL_MIN_DISTANCE`. If the preferred set cannot place all
capitals, relax only the distance one cell at a time; never place a capital on
sea.

Grow territories from capitals with four-neighbor frontier expansion. On each
turn, choose the polity with the lowest `claimed / quota` ratio, breaking ties
by polity ID, then choose one of its sorted frontier candidates with weighted
seeded selection using `WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS`. Stop a polity at
its quota. If a polity is enclosed before its quota, transfer the
lowest-priority non-capital boundary cell from an adjacent over-quota polity
whose territory remains four-connected. Continue until every quota is met or
throw a deterministic error; do not silently return an underfilled map.

### War border changes

Process war events in ascending `year`, then ascending event ID. A war is
eligible only when it names two distinct existing polities and has population
effects for both. Sum each participant's population delta inside that event;
the less-damaged polity is the winner. Use one seeded draw only when the net
deltas tie, then consider loser-owned cells adjacent to the winner. This makes
the direction come from the war's recorded effects whenever history
distinguishes the outcome.

Move at most `WORLD_MAP_WAR_BORDER_CELLS_PER_EVENT` candidates. A candidate is
accepted only when:

- it is not a capital;
- removing it keeps the former polity four-connected;
- assigning it to the winner does not invert the final population/territory
  ordering invariant.

Record each accepted move as `WorldBorderChange`, and require its
`establishedByEventId` to resolve to that `war` event. A war between
non-adjacent territories may produce no change; no synthetic event is created.

### Frontier settlement

After war adjustments, collect non-sea, unclaimed cells with a four-neighbor
owned by `SettlementOrigin.homelandPolityId`. Pick one with the seeded RNG
after sorting row-major.

If that set is empty, release the lowest-priority non-capital homeland boundary
cell that:

- retains at least one homeland four-neighbor after release;
- leaves the homeland four-connected;
- preserves population/territory ordering.

The resulting cell is `settlementFrontierPos`. It must be non-sea, unclaimed,
and adjacent to homeland territory. Its historical cause is the existing
`SettlementOrigin.departureEventId`; do not duplicate that ID on `WorldMap`.
Generation throws if `settlementOrigin` is absent or its homeland cannot be
resolved, because a frontier position cannot then satisfy the frozen contract.

### Cities and routes

Calculate each polity's city count by linearly normalizing implied population
between the current minimum and maximum populations, rounding to the nearest
integer in `WORLD_MAP_CITY_COUNT_MIN..WORLD_MAP_CITY_COUNT_MAX`. If every
population is equal, use `WORLD_MAP_CITY_COUNT_MIN`.

The capital is slot `0`, occupies the capital seed, and uses the polity's
`founding` event as `foundedByEventId`. Secondary city source events are the
most recent distinct positive population events for that polity, sorted by
descending year then descending event ID. If too few exist, use the most
recent remaining population events, then the founding event. Place secondary
cities on final owned non-sea cells, preferring plains/forest and
`WORLD_MAP_CITY_MIN_DISTANCE`; relax only the distance when required.

For every eligible `trade` event naming two distinct current polities, choose
the closest city pair between those polities, breaking equal distance by
ascending city IDs. `cityIds[0]` belongs to `event.polityIds[0]` and
`cityIds[1]` belongs to `event.polityIds[1]`. Create exactly one route with
`establishedByEventId === event.id`. A repeated historical trade event may
therefore create a repeated geometric line with a distinct causal ID.

## Causal and Structural Invariants

Every generated map must satisfy all of these before it enters
`WorldHistory`:

- `width === WORLD_MAP_WIDTH`, `height === WORLD_MAP_HEIGHT`, and
  `cells.length === width * height`;
- every non-null cell `polityId` resolves in `WorldHistory.polities`;
- every polity has exactly one capital and between one and three total cities;
- every city lies on a cell owned by its polity, has a Japanese name, and has a
  `foundedByEventId` resolving in `WorldHistory.events`;
- every capital source is a founding event for the same polity;
- every route references two existing cities from the two polities named by
  its resolved trade event;
- every border change resolves to a war event naming both
  `formerPolityId` and `currentPolityId`, and its final cell is owned by
  `currentPolityId`;
- every unadjusted territory boundary remains traceable to the two capital
  founding events and the population-effect quotas that produced its cells;
- `settlementFrontierPos` is in bounds, non-sea, unclaimed, and four-neighbor
  adjacent to the homeland;
- strictly larger implied polity population never has fewer final territory
  cells;
- all city, route, and border IDs are unique.

Validate these invariants in tests. Do not add a production schema library or
a second runtime validator.

## Transport and Rendering Rules

`WorldHistory.worldMap` is immutable after world creation. The existing welcome
message already carries the complete `WorldState`; update its runtime
required-key check and fixtures so a welcome without `history.worldMap` is
rejected.

The update variant must not gain `history`, `worldMap`, cities, routes, or
territory deltas. `packages/client/src/net/wsClient.ts` continues to spread the
previous state and replace only authoritative update fields, preserving the
welcome history.

The client canvas draws in this order:

1. terrain-shade rectangles;
2. polity-color rectangles at low alpha;
3. route lines;
4. city dots, with capitals larger;
5. a distinct diamond/cross plus the exact label `現在地`.

Selecting an owned cell highlights that polity's territory, cities, and every
route touching one of its cities. Selecting sea or unclaimed land clears the
selection. The selected polity's existing 国柄 card appears below the map;
do not create a second card format.

All visible labels introduced by this slice are Japanese. The terrain legend
uses `海`, `平地`, `森`, `丘陵`, and `山地`; the symbol legend uses `首都`,
`都市`, `交易路`, and `現在地`.

## File Responsibilities

| File | Responsibility |
|---|---|
| `packages/shared/src/worldMap.ts` | Frozen overworld terrain, cell, city, route, border-change, and map contracts |
| `packages/shared/src/history.ts` | Required `WorldHistory.worldMap` ownership |
| `packages/shared/src/constants.ts` | Every generation threshold, expansion weight, count, name suffix, alpha, and drawing size |
| `packages/shared/src/index.ts` | Public export of `worldMap.ts` |
| `packages/shared/src/protocol.ts` | Welcome-only runtime presence check for `history.worldMap`; unchanged update contract |
| `packages/server/src/sim/worldMapGen.ts` | Pure seeded terrain, territory, city, route, border, and settlement generation |
| `packages/server/src/sim/historyGen.ts` | Attach one generated map to the completed causal history |
| `packages/server/src/net/wsServer.ts` | Existing full welcome and map-free update boundary; no simulation logic |
| `packages/client/src/net/wsClient.ts` | Existing preservation of welcome-only history across updates |
| `packages/client/src/ui/worldMapView.ts` | Pure world-map view model, pointer mapping, and thin canvas drawing |
| `packages/client/src/ui/worldChronicle.ts` | Accessible map/chronicle tabs and reuse of the existing polity card |
| `packages/client/src/main.ts` | Existing panel wiring and Japanese open announcement |
| `packages/client/index.html` | Responsive canvas, legend, tabs, selected-card, and focus styles |

## Task 1: Define Shared World-Map Contracts and Constants

**Branch:** `s4-world-map-01-contracts` from `main`

**Commit:** `feat(shared): define world map contracts`

**Files:**

- Create: `packages/shared/src/worldMap.ts`
- Create: `packages/shared/test/worldMap.test.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: existing `Position` from `packages/shared/src/world.ts`
- Produces: all frozen `WorldMap*` types, every `WORLD_MAP_*` constant, and
  `WORLD_CITY_NAME_SUFFIXES`
- Defers: adding required `WorldHistory.worldMap` until Task 3, when a real
  generator exists; no nullable or placeholder map is introduced

- [ ] **Step 1: Write the failing shared contract/constants test**

Create `packages/shared/test/worldMap.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  WORLD_CITY_NAME_SUFFIXES,
  WORLD_MAP_CITY_COUNT_MAX,
  WORLD_MAP_CITY_COUNT_MIN,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS,
  WORLD_MAP_WIDTH,
  type WorldMap,
} from "../src/index.js";

describe("world-map contracts", () => {
  it("defines the frozen grid, city range, and terrain weights", () => {
    const map: WorldMap = {
      width: WORLD_MAP_WIDTH,
      height: WORLD_MAP_HEIGHT,
      cells: Array.from(
        { length: WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT },
        () => ({ terrain: "sea", polityId: null }) as const,
      ),
      cities: [],
      tradeRoutes: [],
      borderChanges: [],
      settlementFrontierPos: { x: 0, y: 0 },
    };

    expect([map.width, map.height, map.cells.length]).toEqual([96, 64, 96 * 64]);
    expect([WORLD_MAP_CITY_COUNT_MIN, WORLD_MAP_CITY_COUNT_MAX]).toEqual([1, 3]);
    expect(WORLD_CITY_NAME_SUFFIXES).toEqual(["府", "市", "砦"]);
    expect(WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS).toEqual({
      sea: 0,
      plains: 1,
      forest: 0.8,
      hills: 0.55,
      mountains: 0.2,
    });
  });
});
```

- [ ] **Step 2: Run the focused test to verify Red**

Run:

```sh
pnpm vitest run packages/shared/test/worldMap.test.ts
```

Expected: FAIL because `WorldMap`, `WORLD_MAP_WIDTH`, and the other frozen
exports do not exist.

- [ ] **Step 3: Add the frozen shared map contracts**

Create `packages/shared/src/worldMap.ts` with the exact declarations in
**Frozen Contracts**. Keep `Position` as a type-only import. Do not reuse the
local-map `Terrain` type: `water`/`rock` and `sea`/`hills`/`mountains` are
different domains.

- [ ] **Step 4: Add every exact shared constant**

Add the complete **Constants Table** and both fixed tables to
`packages/shared/src/constants.ts`. Add:

```ts
import type { WorldMapTerrain } from "./worldMap.js";
```

Keep the existing history, survival, and institution constants unchanged. Do
not add a dependency or duplicate values in the client.

- [ ] **Step 5: Export the shared contract**

Add to `packages/shared/src/index.ts`:

```ts
export * from "./worldMap.js";
```

Do not add `worldMap` to `WorldHistory` in this task. That field becomes
required atomically with real generation in Task 3.

- [ ] **Step 6: Run focused checks and the full independent gate**

Run:

```sh
pnpm vitest run packages/shared/test/worldMap.test.ts
pnpm biome check packages/shared/src/worldMap.ts packages/shared/src/constants.ts packages/shared/src/index.ts packages/shared/test/worldMap.test.ts
pnpm -r exec tsc
rg -n 'WORLD_MAP_|WORLD_CITY_NAME_SUFFIXES' packages/shared/src packages/shared/test
git diff --check
just check && just test
```

Expected: the focused test passes, TypeScript and Biome report zero errors,
the identifier scan shows one shared owner for every value, no whitespace
errors are present, and both repository gates pass.

- [ ] **Step 7: Commit Task 1**

```sh
git add packages/shared/src/worldMap.ts packages/shared/src/constants.ts packages/shared/src/index.ts packages/shared/test/worldMap.test.ts
git commit -m "feat(shared): define world map contracts"
```

## Task 2: Generate History-Shaped Terrain, Territories, and Powers

**Branch:** `s4-world-map-02-generation` from the Task 1 commit

**Commit:** `feat(sim): generate history-shaped world map`

**Files:**

- Create: `packages/server/src/sim/worldMapGen.ts`
- Create: `packages/server/test/worldMapGen.test.ts`

**Interfaces:**

- Consumes: `createRng`, frozen map contracts/constants, and
  `Pick<WorldHistory, "polities" | "events" | "settlementOrigin">`
- Produces:
  `generateWorldMap(seed: number, history: WorldMapHistory): WorldMap`
- Does not modify: `WorldHistory`, `generateWorldHistory`, `WorldState`,
  protocol, networking, or client files

- [ ] **Step 1: Write failing determinism, dimension, and terrain tests**

Create `packages/server/test/worldMapGen.test.ts`. Start from real history:

```ts
function generated(seed: number) {
  const history = generateWorldHistory(seed);
  return { history, map: generateWorldMap(seed, history) };
}
```

Cover these exact expectations:

```ts
it("replays the identical world map from the same seed and history", () => {
  expect(generated(42).map).toEqual(generated(42).map);
});

it("changes the world map for a different seed", () => {
  expect(generated(42).map).not.toEqual(generated(43).map);
});

it("builds the frozen row-major grid from valid terrain values", () => {
  const { map } = generated(42);
  const terrain = new Set(map.cells.map(({ terrain }) => terrain));

  expect([map.width, map.height, map.cells.length]).toEqual([
    WORLD_MAP_WIDTH,
    WORLD_MAP_HEIGHT,
    WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT,
  ]);
  expect([...terrain].every((value) =>
    ["sea", "plains", "forest", "hills", "mountains"].includes(value),
  )).toBe(true);
  expect(terrain.has("sea")).toBe(true);
  expect(map.cells.some(({ terrain }) => terrain !== "sea")).toBe(true);
});
```

The same-seed test must create two independent history/map objects. Do not
compare a value with itself.

- [ ] **Step 2: Write failing causal-integrity tests**

Build maps for seeds `0..19`, collect event, polity, and city indexes, and
assert:

```ts
for (const city of map.cities) {
  expect(polityIds.has(city.polityId)).toBe(true);
  expect(eventIds.has(city.foundedByEventId)).toBe(true);
  expect(cellAt(map, city.pos)?.polityId).toBe(city.polityId);
  expect(city.name).not.toMatch(/[A-Za-z]/);
}

for (const route of map.tradeRoutes) {
  const event = eventsById.get(route.establishedByEventId);
  const endpoints = route.cityIds.map((id) => citiesById.get(id));
  expect(event?.kind).toBe("trade");
  expect(endpoints.every(Boolean)).toBe(true);
  expect(endpoints.map((city) => city?.polityId)).toEqual(event?.polityIds);
}

for (const change of map.borderChanges) {
  const event = eventsById.get(change.establishedByEventId);
  expect(event?.kind).toBe("war");
  expect(event?.polityIds).toEqual(
    expect.arrayContaining([change.formerPolityId, change.currentPolityId]),
  );
  expect(cellAt(map, change.pos)?.polityId).toBe(change.currentPolityId);
}
```

Also assert unique city/route/border IDs, exactly one capital per polity,
`WORLD_MAP_CITY_COUNT_MIN..WORLD_MAP_CITY_COUNT_MAX` cities per polity, and
capital provenance from the same polity's founding event. Across the twenty
seeds, require at least one border change so an always-empty implementation
cannot satisfy the causal test.

- [ ] **Step 3: Write failing frontier and population-order tests**

Fold implied population directly from real history effects in the test:

```ts
function populationFor(history: WorldMapHistory, polityId: string): number {
  return history.events.flatMap(({ effects }) => effects).reduce(
    (total, effect) =>
      effect.kind === "population" && effect.targetId === polityId
        ? total + effect.delta
        : total,
    0,
  );
}
```

For seeds `0..19`, assert the settlement cell is non-sea, unclaimed, and has a
four-neighbor owned by `settlementOrigin.homelandPolityId`.

Count final territory cells by polity. For every pair with strictly different
implied populations, assert:

```ts
if (leftPopulation > rightPopulation) {
  expect(territoryCount(left.id)).toBeGreaterThanOrEqual(territoryCount(right.id));
}
```

Assert every polity owns at least one cell so an empty-ownership map cannot
pass.

- [ ] **Step 4: Run the new suite to verify Red**

Run:

```sh
pnpm vitest run packages/server/test/worldMapGen.test.ts
```

Expected: FAIL because `packages/server/src/sim/worldMapGen.ts` does not exist.

- [ ] **Step 5: Implement seeded fields, landmass classification, and populations**

Create `packages/server/src/sim/worldMapGen.ts` with the exact public interface
from **Frozen Contracts**:

```ts
export type WorldMapHistory = Pick<
  WorldHistory,
  "polities" | "events" | "settlementOrigin"
>;

export function generateWorldMap(
  seed: number,
  history: WorldMapHistory,
): WorldMap;
```

Use focused private helpers for:

- row-major index/position conversion and in-bounds four/eight neighbors;
- finite `0..1` clamping;
- scalar-field creation and smoothing;
- elliptical center bias and terrain classification;
- largest four-connected land component;
- implied population folding.

Follow **Seed and terrain** exactly. Keep each phase in a separate helper so
Biome cognitive complexity remains at most 10.

- [ ] **Step 6: Implement quota-based weighted territory growth**

Add private helpers for:

```ts
interface PolityQuota {
  polityId: string;
  population: number;
  targetCells: number;
}

interface CapitalSeed {
  polityId: string;
  pos: Position;
  foundedByEventId: string;
}
```

Implement Hamilton-style remainder allocation, stable seeded capital
placement, ratio-ordered frontier turns, terrain-weighted candidate selection,
and the connectivity-preserving quota repair described in
**Population and territories**.

Sort `Set`/`Map` materializations before consuming RNG. JavaScript insertion
order must not become an undocumented tie breaker.

- [ ] **Step 7: Apply wars, reserve the settlement frontier, and derive cities/routes**

Implement the remaining phases in this exact order:

```text
base territory quotas
  -> war border changes
  -> guaranteed unclaimed homeland frontier
  -> capitals and secondary cities
  -> trade routes
  -> final invariant assertions
```

Use only real history IDs. Skip an ineligible bilateral event rather than
inventing an entity, city, polity, or event. Throw on a broken frozen
invariant rather than returning a partially valid `WorldMap`.

The final private assertion helper checks every item in
**Causal and Structural Invariants** and is exercised through the public
generator tests; do not export a second validation API.

- [ ] **Step 8: Run focused generation checks and forbidden-source scans**

Run:

```sh
pnpm vitest run packages/server/test/worldMapGen.test.ts packages/server/test/historyGen.test.ts
pnpm biome check packages/server/src/sim/worldMapGen.ts packages/server/test/worldMapGen.test.ts
rg -n 'Math\\.random|Date|crypto|randomUUID|from .*net/|from .*llm/|node:' packages/server/src/sim/worldMapGen.ts
rg -n '0\\.46|0\\.62|0\\.76|0\\.54|0\\.70|0\\.8|0\\.55|0\\.2' packages/server/src/sim/worldMapGen.ts
git diff --check
```

Expected: generation and existing history tests pass; both scans print no
forbidden API or inlined configured numeric rule; Biome and whitespace checks
report zero errors.

- [ ] **Step 9: Run the full independent gate and commit Task 2**

Run:

```sh
just check && just test
git status --short
```

Expected: both gates pass and only the two Task 2 files are new.

Then commit:

```sh
git add packages/server/src/sim/worldMapGen.ts packages/server/test/worldMapGen.test.ts
git commit -m "feat(sim): generate history-shaped world map"
```

## Task 3: Attach the Map and Keep It Welcome-Only

**Branch:** `s4-world-map-03-transport` from the Task 2 commit

**Commit:** `feat(net): send world map in welcome`

**Files:**

- Modify: `packages/shared/src/history.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/server/src/sim/historyGen.ts`
- Modify: `packages/server/test/historyGen.test.ts`
- Modify: `packages/server/test/worldGen.test.ts`
- Modify: `packages/shared/test/protocol.test.ts`
- Modify transport tests: `packages/server/test/wsServer.test.ts`,
  `packages/client/test/wsClient.test.ts`
- Create test helpers: `packages/shared/test/worldMapFixture.ts`,
  `packages/server/test/worldMapFixture.ts`,
  `packages/client/test/worldMapFixture.ts`
- Modify other inline `WorldHistory` fixtures:
  `packages/shared/test/time.test.ts`,
  `packages/server/test/astar.test.ts`,
  `packages/server/test/executor.test.ts`,
  `packages/server/test/fakePlanner.test.ts`,
  `packages/server/test/llmPlanner.test.ts`,
  `packages/server/test/normalizePlan.test.ts`,
  `packages/server/test/planPrompt.test.ts`,
  `packages/server/test/planSchema.test.ts`,
  `packages/client/test/infoBubble.test.ts`,
  `packages/client/test/inspectPanel.test.ts`,
  `packages/client/test/keyboardNavigation.test.ts`,
  `packages/client/test/societyViewModel.test.ts`,
  `packages/client/test/survivalViewModel.test.ts`,
  `packages/client/test/worldChronicle.test.ts`
- Verify unchanged: `packages/server/src/net/wsServer.ts`,
  `packages/client/src/net/wsClient.ts`

**Interfaces:**

- Consumes: Task 2 `generateWorldMap(seed, history)`
- Produces: required `WorldHistory.worldMap`, welcome runtime presence
  validation, and fixture-complete shared/server/client transport tests
- Preserves: the existing `ServerMessage` update fields and
  `wsClient.applyUpdate` behavior

- [ ] **Step 1: Add failing welcome/map protocol expectations**

In `packages/shared/test/protocol.test.ts`, put a non-empty map in the welcome
fixture:

```ts
worldMap: {
  width: 96,
  height: 64,
  cells: Array.from({ length: 96 * 64 }, (_, index) => ({
    terrain: index === 97 ? "plains" : "sea",
    polityId: null,
  })),
  cities: [],
  tradeRoutes: [],
  borderChanges: [],
  settlementFrontierPos: { x: 1, y: 1 },
},
```

After round-trip, assert:

```ts
expect(
  decoded.type === "welcome"
    ? decoded.state.history.worldMap.settlementFrontierPos
    : null,
).toEqual({ x: 1, y: 1 });
```

Add a rejection test which starts from the valid encoded welcome, deletes only
`state.history.worldMap`, and expects `decodeServerMessage` to throw
`"invalid server message"`.

Do not add any map field to the update fixture.

- [ ] **Step 2: Add failing generator-integration tests**

In `packages/server/test/historyGen.test.ts`:

```ts
it("attaches the same seeded world map to the completed history", () => {
  const first = generateWorldHistory(42);
  const second = generateWorldHistory(42);

  expect(first.worldMap).toEqual(second.worldMap);
  expect(first.worldMap.cells).toHaveLength(WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT);
});
```

In `packages/server/test/worldGen.test.ts`, extend the existing different-seed
and referential-integrity coverage:

```ts
expect(generateWorld(42).history.worldMap).not.toEqual(
  generateWorld(43).history.worldMap,
);
```

Add every city `foundedByEventId`, route `establishedByEventId`, and border
`establishedByEventId` to the existing `historicalReferenceIds` helper.

- [ ] **Step 3: Run focused tests to verify Red**

Run:

```sh
pnpm vitest run packages/shared/test/protocol.test.ts packages/server/test/historyGen.test.ts packages/server/test/worldGen.test.ts
```

Expected: FAIL because `WorldHistory.worldMap` is not required, history
generation does not attach it, and welcome validation accepts a missing map.

- [ ] **Step 4: Make `WorldHistory.worldMap` required and attach real generation**

In `packages/shared/src/history.ts`, add a type-only `WorldMap` import and the
required field shown in **Frozen Contracts**.

In `packages/server/src/sim/historyGen.ts`, construct the core history before
the final return:

```ts
const history = {
  startYear: -WORLD_HISTORY_YEARS,
  currentYear: 0,
  polities: polities.map(publicPolity),
  events,
  landmarks,
  settlementOrigin,
} satisfies Omit<WorldHistory, "worldMap">;

return {
  ...history,
  worldMap: generateWorldMap(seed, history),
};
```

Import `generateWorldMap` from `./worldMapGen.js`. Do not pass the history RNG
closure into the map generator, and do not generate the map before departure
or landmark effects have been finalized.

- [ ] **Step 5: Migrate every explicit history fixture without casts**

Create `worldMapFixture.ts` in each of the three listed test directories with
this package-local helper:

```ts
import {
  WORLD_MAP_HEIGHT,
  WORLD_MAP_WIDTH,
  type WorldMap,
} from "@agent-town/shared";

export function makeWorldMapFixture(): WorldMap {
  const cells: WorldMap["cells"] = Array.from(
    { length: WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT },
    () => ({ terrain: "sea", polityId: null }),
  );
  const settlementFrontierPos = { x: 1, y: 1 };
  cells[settlementFrontierPos.y * WORLD_MAP_WIDTH + settlementFrontierPos.x] = {
    terrain: "plains",
    polityId: null,
  };
  return {
    width: WORLD_MAP_WIDTH,
    height: WORLD_MAP_HEIGHT,
    cells,
    cities: [],
    tradeRoutes: [],
    borderChanges: [],
    settlementFrontierPos,
  };
}
```

For `packages/shared/test/worldMapFixture.ts`, import from `../src/index.js`
instead of the package name. In every listed inline history fixture, import
the package-local helper and add:

```ts
worldMap: makeWorldMapFixture(),
```

Do not make the production field optional, use `as WorldHistory`, use
`@ts-expect-error`, or insert empty arrays with the wrong `96 × 64` length.

- [ ] **Step 6: Require the nested map in welcome decoding**

In `packages/shared/src/protocol.ts`, add:

```ts
function hasWorldMap(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasRequiredKeys(value, [
      "width",
      "height",
      "cells",
      "cities",
      "tradeRoutes",
      "borderChanges",
      "settlementFrontierPos",
    ])
  );
}

function hasWorldHistory(value: unknown): boolean {
  return isRecord(value) && hasWorldMap(value.worldMap);
}
```

The welcome branch becomes:

```ts
return (
  isRecord(value.state) &&
  hasRequiredKeys(value.state, ["history", "collectives", "institutions"]) &&
  hasWorldHistory(value.state.history)
);
```

Keep the update union and update required-key list exactly unchanged.

- [ ] **Step 7: Prove welcome-only transport at server and client boundaries**

In the real-socket test in `packages/server/test/wsServer.test.ts`, assert:

```ts
expect(welcome.state.history.worldMap.cells).toHaveLength(
  WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT,
);
expect("history" in update).toBe(false);
expect("worldMap" in update).toBe(false);
```

The second assertion documents the top-level wire shape; the first ensures the
complete nested map reached the client.

In `packages/client/test/wsClient.test.ts`, keep a reference to the decoded
welcome history and assert after an update:

```ts
const welcomedState = onWelcome.mock.calls[0]?.[0];
const updatedState = onUpdate.mock.calls[0]?.[0];
expect(updatedState?.history).toBe(welcomedState?.history);
expect(updatedState?.history.worldMap).toEqual(makeWorld().history.worldMap);
```

Do not edit `createUpdateMessage` or `applyUpdate`; their current omission and
spread behavior are the intended implementation.

- [ ] **Step 8: Run transport, fixture, and full independent gates**

Run:

```sh
pnpm vitest run packages/shared/test/protocol.test.ts packages/server/test/historyGen.test.ts packages/server/test/worldMapGen.test.ts packages/server/test/worldGen.test.ts packages/client/test/wsClient.test.ts packages/server/test/wsServer.test.ts
pnpm -r exec tsc
pnpm biome check packages/shared/src/history.ts packages/shared/src/protocol.ts packages/server/src/sim/historyGen.ts packages/shared/test packages/server/test packages/client/test
rg -n 'worldMap:' packages --glob '*.ts'
git diff --check
just check && just test
```

Expected: generation, nested welcome validation, welcome-only transport, and
all migrated fixtures pass; update has no history/map payload; TypeScript and
Biome report zero errors; no whitespace errors are present; both full gates
pass.

- [ ] **Step 9: Commit Task 3**

```sh
git add packages/shared/src/history.ts packages/shared/src/protocol.ts packages/shared/test packages/server/src/sim/historyGen.ts packages/server/test packages/client/test
git commit -m "feat(net): send world map in welcome"
```

## Task 4: Add the Interactive Japanese World-Map Tab

**Branch:** `s4-world-map-04-client` from the Task 3 commit

**Commit:** `feat(client): show interactive world map`

**Files:**

- Create: `packages/client/src/ui/worldMapView.ts`
- Create: `packages/client/test/worldMapView.test.ts`
- Modify: `packages/client/src/ui/worldChronicle.ts`
- Modify: `packages/client/test/worldChronicle.test.ts`
- Modify: `packages/client/test/worldChronicleShell.test.ts`
- Modify: `packages/client/src/main.ts`
- Modify: `packages/client/index.html`

**Interfaces:**

- Consumes: immutable `WorldHistory.worldMap`, polity names/colors/cards, and
  the shared drawing constants
- Produces:

```ts
export interface WorldMapViewModel {
  width: number;
  height: number;
  cells: WorldMapCellViewModel[];
  cities: WorldMapCityViewModel[];
  tradeRoutes: WorldMapRouteViewModel[];
  settlement: {
    pos: Position;
    label: "現在地";
  };
  selectedPolityId: string | null;
}

export function buildWorldMapViewModel(
  history: WorldHistory,
  selectedPolityId: string | null,
): WorldMapViewModel;

export function worldMapPositionFromPointer(
  view: WorldMapViewModel,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  clientX: number,
  clientY: number,
): Position | null;

export function polityIdAtWorldMapPosition(
  view: WorldMapViewModel,
  pos: Position,
): string | null;

export function renderWorldMapCanvas(
  canvas: HTMLCanvasElement,
  view: WorldMapViewModel,
): void;
```

- Preserves: `WorldChronicleController.show(history)`, `close()`, and
  `isOpen()` so `packages/client/src/main.ts` does not gain map state

- [ ] **Step 1: Write failing pure view-model formatting tests**

Create `packages/client/test/worldMapView.test.ts` with two Japanese polities,
owned cells, a capital and city, one trade route, one border change, and an
unclaimed settlement cell.

Assert exact formatting and selection:

```ts
const view = buildWorldMapViewModel(historyFixture(), "polity-1");

expect(view.settlement).toEqual({
  pos: { x: 3, y: 2 },
  label: "現在地",
});
expect(view.cells.find(({ pos }) => pos.x === 1 && pos.y === 1)).toMatchObject({
  terrainLabel: "平地",
  polityColor: "#6f7f88",
  polityAlpha: WORLD_MAP_SELECTED_POLITY_ALPHA,
});
expect(view.cities).toEqual([
  expect.objectContaining({
    name: "黒貂府",
    isCapital: true,
    isHighlighted: true,
  }),
  expect.objectContaining({
    name: "金環府",
    isCapital: true,
    isHighlighted: false,
  }),
]);
expect(view.tradeRoutes[0]?.isHighlighted).toBe(true);
```

Add tests for:

- unselected polity overlays using `WORLD_MAP_POLITY_ALPHA`;
- selecting sea/unclaimed land returning `null`;
- pointer mapping at the top-left, bottom-right, and outside bounds;
- unresolved route city IDs being omitted rather than exposing raw IDs;
- terrain labels exactly `海`, `平地`, `森`, `丘陵`, `山地`.

- [ ] **Step 2: Run the pure client test to verify Red**

Run:

```sh
pnpm vitest run packages/client/test/worldMapView.test.ts
```

Expected: FAIL because `packages/client/src/ui/worldMapView.ts` does not exist.

- [ ] **Step 3: Implement the pure map view model**

Create `packages/client/src/ui/worldMapView.ts`. Use these internal view-model
shapes:

```ts
export interface WorldMapCellViewModel {
  pos: Position;
  terrain: WorldMapTerrain;
  terrainLabel: string;
  terrainColor: string;
  polityId: string | null;
  polityColor: string | null;
  polityAlpha: number;
}

export interface WorldMapCityViewModel {
  id: string;
  name: string;
  pos: Position;
  polityId: string;
  isCapital: boolean;
  isHighlighted: boolean;
}

export interface WorldMapRouteViewModel {
  id: string;
  from: Position;
  to: Position;
  isHighlighted: boolean;
}
```

Use this presentation-only terrain table in the client module:

```ts
const TERRAIN_VIEW = {
  sea: { label: "海", color: "#1b3442" },
  plains: { label: "平地", color: "#7d8c62" },
  forest: { label: "森", color: "#465f4d" },
  hills: { label: "丘陵", color: "#80745e" },
  mountains: { label: "山地", color: "#aaa08d" },
} as const satisfies Readonly<
  Record<WorldMapTerrain, { label: string; color: string }>
>;
```

Convert polity numbers with:

```ts
`#${color.toString(16).padStart(6, "0")}`
```

A cell without a polity has `polityColor: null` and `polityAlpha: 0`.
A route is highlighted when either endpoint city belongs to the selected
polity. Do not calculate territory, infer history, mutate the world map, or
make random choices in the client.

- [ ] **Step 4: Implement thin canvas drawing and pointer mapping**

Implement `renderWorldMapCanvas` with backing dimensions:

```ts
canvas.width = view.width * WORLD_MAP_CELL_SIZE_PX;
canvas.height = view.height * WORLD_MAP_CELL_SIZE_PX;
```

Draw in the order specified by **Transport and Rendering Rules**. Use
`globalAlpha` only around polity overlays and restore it before routes/markers.
Capital and city radii come from shared constants. Draw the settlement as a
diamond plus crossed strokes and render the exact text `現在地`; it must remain
distinct without relying on color alone.

`worldMapPositionFromPointer` converts CSS-scaled coordinates back into map
coordinates using the supplied bounds, returns `null` outside the canvas, and
does not read global window state.

- [ ] **Step 5: Add accessible `世界地図` and `年代記` tabs**

In `packages/client/src/ui/worldChronicle.ts`, keep the existing chronicle
view model and polity card implementation. Refactor only enough to call the
same `polityCard` function from both the old polity grid and the new selected
map detail.

Render:

```text
[世界地図] [年代記]
```

as buttons in a `role="tablist"`. Each button has Japanese text,
`aria-selected`, `aria-controls`, and a minimum 44 px target. The world-map tab
is selected when the panel first opens.

The map panel contains:

- a canvas with `aria-label="現存国家、都市、交易路、現在地を示す世界地図"`;
- a non-color-only legend labelled `首都`, `都市`, `交易路`, `現在地`;
- a prompt `地図上の勢力を選択してください。`;
- the existing polity card after an owned cell is selected.

On canvas pointer selection:

1. call `worldMapPositionFromPointer`;
2. call `polityIdAtWorldMapPosition`;
3. rebuild and redraw the map view model with that selection;
4. replace the selected-card container with the existing `polityCard`, or the
   Japanese prompt when selection is cleared.

Keep `show`, `close`, focus return, and Escape behavior. Do not add a second
floating panel or map state to `main.ts`.

- [ ] **Step 6: Extend controller tests for tabs, selection, and card reuse**

Update the fake DOM/canvas in `packages/client/test/worldChronicle.test.ts` so
it records button listeners, canvas dimensions, and minimal 2D context calls.

Add a test that:

1. opens the chronicle;
2. sees `世界地図`, `年代記`, `現在地`, and no Latin visible labels;
3. confirms the map tab begins selected;
4. invokes a pointer event on a `polity-1` cell;
5. sees the same `黒貂辺境国`, `建国譚`, `統治`, `禁忌`, `悲願`, and
   `刻まれた傷` content used by the existing polity grid;
6. switches to `年代記` and sees the existing origin and event timeline;
7. closes with Escape and returns focus to the toggle.

Keep the existing `buildWorldChronicleViewModel` causal tests unchanged.

- [ ] **Step 7: Add responsive styles and Japanese shell text**

In `packages/client/index.html`, add styles for:

- the two-button tab list and selected/focus-visible state;
- a responsive canvas wrapper with `width: 100%`, preserved aspect ratio, and
  pixel-sharp rendering;
- symbol/terrain legends that combine shape/text with color;
- the selected polity card below the map;
- the existing desktop side panel and mobile bottom-sheet behavior;
- no animation beyond the current panel transition and no new dependency.

Update `packages/client/test/worldChronicleShell.test.ts` to assert the map
canvas/tab class names, 44 px targets, and the existing reduced-motion rule.

Change the visible toggle text from `年代記を開く` to `旧世界を見る`. In
`packages/client/src/main.ts`, change only the open announcement to:

```ts
announce("世界地図を開きました。");
```

All other state replacement, welcome handling, and panel closing behavior
remain unchanged.

- [ ] **Step 8: Run focused tests, client build, and full independent gates**

Run:

```sh
pnpm vitest run packages/client/test/worldMapView.test.ts packages/client/test/worldChronicle.test.ts packages/client/test/worldChronicleShell.test.ts packages/client/test/wsClient.test.ts
pnpm --filter @agent-town/client build
pnpm biome check packages/client/src/ui/worldMapView.ts packages/client/src/ui/worldChronicle.ts packages/client/src/main.ts packages/client/test/worldMapView.test.ts packages/client/test/worldChronicle.test.ts
rg -n '世界地図|年代記|現在地|首都|都市|交易路|地図上の勢力' packages/client/src packages/client/test packages/client/index.html
git diff --check
just check && just test
```

Expected: pure formatting/pointer tests, chronicle interaction tests, preserved
welcome map, and client build pass; Japanese label scan shows the intended
owners; Biome and whitespace checks report zero errors; both full gates pass.

- [ ] **Step 9: Verify desktop/mobile behavior in a browser**

Run:

```sh
just serve
```

With LLM planning disabled, verify:

1. `旧世界を見る` opens directly to `世界地図`;
2. terrain, low-alpha polity overlays, differently sized capital/city dots,
   trade lines, and the `現在地` marker are visible;
3. selecting each polity highlights its cells, cities, and touching routes and
   shows the existing 国柄 card;
4. selecting sea or unclaimed frontier clears the card;
5. `年代記` still shows origin, polity cards, and causal events;
6. the panel and map are usable at `1440 × 900` and `390 × 844`;
7. close/Escape focus return works, no LLM process starts, and the browser
   console has no errors.

Stop the server and confirm port `8790` is no longer listening. Then rerun:

```sh
just check && just test
git status --short
```

Expected: both gates pass and only Task 4 files are modified.

- [ ] **Step 10: Commit Task 4**

```sh
git add packages/client/src/ui/worldMapView.ts packages/client/src/ui/worldChronicle.ts packages/client/src/main.ts packages/client/index.html packages/client/test/worldMapView.test.ts packages/client/test/worldChronicle.test.ts packages/client/test/worldChronicleShell.test.ts
git commit -m "feat(client): show interactive world map"
```

## Completion Criteria

- `WorldHistory.worldMap` is required and uses a `96 × 64` row-major grid with
  the exact five terrain values and `string | null` polity ownership.
- Map generation uses the existing mulberry32 RNG, the same numeric seed as
  WorldHistory, no LLM, no new dependency, no wall clock, and no I/O.
- Same-seed generation is deeply identical; different-seed generation differs.
- Polity quotas are derived by folding real population effects and final
  territory counts preserve implied population ordering.
- Every polity has one capital and one to three Japanese-named cities on owned
  cells, each with resolvable founding provenance.
- Every trade event creates a route between existing cities of its participating
  current polities, with a resolvable `establishedByEventId`.
- Every recorded border change is caused by a resolvable war event and its
  final cell belongs to the recorded current polity.
- The settlement position is non-sea, unclaimed, and four-neighbor adjacent to
  the homeland polity selected by `SettlementOrigin`.
- Welcome carries the complete map exactly once; the update contract and
  update payload remain free of history/map fields.
- The client uses pure tested view models, a thin canvas/DOM adapter, Japanese
  labels, low-alpha polity overlays, larger capitals, route lines, and a
  distinct `現在地` marker.
- Selecting a polity highlights its cities/routes and renders the existing
  国柄 card rather than a duplicate format.
- `just check && just test` passes before every task commit.

## Task List

| Order | One-worker assignment | Branch | Depends on | Independent gate |
|---|---|---|---|---|
| 1 | Frozen `WorldMap` contracts, generation/drawing constants, exports | `s4-world-map-01-contracts` | `main` | Shared contract test, type/Biome checks, `just check && just test`, local commit |
| 2 | Pure seeded terrain, territories, war borders, frontier, cities, routes | `s4-world-map-02-generation` | Task 1 commit | Determinism/causality/population/frontier tests, forbidden-source scans, `just check && just test`, local commit |
| 3 | Required `WorldHistory.worldMap`, generator integration, welcome-only protocol and fixtures | `s4-world-map-03-transport` | Task 2 commit | History/protocol/server/client transport tests, unchanged update assertion, `just check && just test`, local commit |
| 4 | Japanese canvas view model, map/chronicle tabs, polity highlight/card reuse, responsive verification | `s4-world-map-04-client` | Task 3 commit | Client view-model/controller tests, build/browser check, `just check && just test`, local commit |
