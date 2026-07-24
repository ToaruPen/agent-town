# Social Facilities and Emergent Trails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn established food institutions into three materially different facilities whose construction, operation, resident traffic, and resulting trails make social causality visible on the local map within ten real-time minutes.

**Architecture:** Add strict spatial-demand, facility, construction, and trail contracts to `packages/shared`; implement each deterministic rule in focused pure modules under `packages/server/src/sim`; then transport the authoritative state through the existing WebSocket update path. The PixiJS client renders and explains that state but never selects sites, changes resources, advances construction, or creates trails.

**Tech Stack:** TypeScript 7, Vitest, PixiJS 8, WebSocket, Vite, Biome, pnpm, just

---

## Scope

This plan implements the approved
`docs/superpowers/specs/2026-07-24-s5-social-facilities-trails-design.md`
as one dependent vertical slice:

```text
established institution
  -> spatial demand
  -> deterministic site
  -> real wood hauling
  -> construction
  -> facility inventory and operation
  -> resident visits
  -> traffic wear
  -> visible trail
  -> desire/support feedback
```

The server must support all three outcomes:

| Institution | Facility | Material effect | Social or resource cost |
|---|---|---|---|
| `communalGranaryStore` | `communalGranary` | protected emergency food with reduced spoilage | highest wood and maintenance requirement |
| `grainMarket` | `grainMarket` | bounded food/wood exchange through inherited trade access | variable reserves and no operation without a route |
| `rationControl` | `rationDepot` | smaller prioritized meals during shortage | resident `rationStrain` and lower support |

The following remain out of scope:

- live demand generators for houses, workshops, temples, walls, or other
  non-food facilities;
- personal money, prices, merchants as agents, carts, and caravan rendering;
- institution repeal, facility demolition, conversion, destruction, or save
  migration;
- paved roads, bridges, gates, planned roads, or player road tools;
- direct player approval or placement;
- LLM decisions, LLM prose, generated names, new dependencies, fonts, or image
  downloads.

The generic source union exists now so later facilities cross the same boundary.
Only `{ kind: "institution" }` is emitted in this slice.

## Frozen Shared Contracts

Create `packages/shared/src/spatial.ts` with these required contracts. Do not
make fields optional to avoid migrating fixtures.

```ts
import type { Provenance } from "./society.js";
import type { Position } from "./world.js";

export type FacilityKind = "communalGranary" | "grainMarket" | "rationDepot";

export type SpatialDemandSource =
  | { kind: "household"; id: string }
  | { kind: "livelihood"; id: string }
  | { kind: "institution"; id: string }
  | { kind: "faith"; id: string }
  | { kind: "externalPressure"; id: string };

export type SpatialDemandStatus =
  | "seekingSite"
  | "awaitingMaterials"
  | "building"
  | "fulfilled"
  | "blocked";

export type SiteFactor =
  | "foodAccess"
  | "residentAccess"
  | "stockpileAccess"
  | "existingTraffic"
  | "settlementEdgeAccess"
  | "openSpace"
  | "accessEquality";

export interface SiteContribution {
  factor: SiteFactor;
  value: number;
  weightedScore: number;
}

export interface SiteRationale {
  score: number;
  contributions: SiteContribution[];
}

export interface SpatialDemand {
  id: string;
  facilityKind: FacilityKind;
  source: SpatialDemandSource;
  supporterIds: string[];
  requiredWood: number;
  requiredLabor: number;
  status: SpatialDemandStatus;
  blockedReason: "noValidSite" | null;
  site: Position | null;
  siteRationale: SiteRationale | null;
  provenance: Provenance;
}

export type FacilityBlockedReason =
  | "unreachable"
  | "full"
  | "noTradeRoute"
  | "maintenanceOverdue";

export interface FacilityDailyStats {
  visits: number;
  foodPreserved: number;
  foodImported: number;
  foodExported: number;
  woodSpent: number;
  woodReceived: number;
  rationMeals: number;
  maintenanceWork: number;
}

export interface Facility {
  kind: FacilityKind;
  id: string;
  demandId: string;
  institutionId: string;
  pos: Position;
  progress: number;
  complete: boolean;
  woodDelivered: number;
  inventory: { wood: number; food: number };
  operation: "inactive" | "active" | "blocked";
  blockedReason: FacilityBlockedReason | null;
  maintenanceDue: number;
  statsToday: FacilityDailyStats;
  lastUsedAtTick: number | null;
  lastTradeTick: number | null;
  siteRationale: SiteRationale;
  provenance: Provenance;
}

export type MovementPurpose =
  | "survival"
  | "gathering"
  | "construction"
  | "facilityService"
  | "wandering";

export type TrailLevel = "none" | "trace" | "trail" | "establishedTrail";

export interface TrailCell {
  wear: number;
  level: TrailLevel;
  passagesToday: number;
  purposeWear: Record<MovementPurpose, number>;
  dominantPurpose: MovementPurpose | null;
  facilityWear: Record<string, number>;
  causedByFacilityIds: string[];
  lastUsedAtTick: number | null;
}
```

Update `packages/shared/src/world.ts`:

```ts
import type { Facility, SpatialDemand, TrailCell } from "./spatial.js";

export type Building = House | Facility;

export function isHouse(building: Building): building is House {
  return building.kind === "house";
}

export function isFacility(building: Building): building is Facility {
  return building.kind !== "house";
}

export type AgentTask =
  | { kind: "moveTo"; dest: Position }
  | { kind: "gather"; resource: ResourceKind; target: Position }
  | { kind: "eat" }
  | { kind: "forage"; target: Position }
  | { kind: "build"; pos: Position }
  | { kind: "transferToFacility"; facilityId: string; resource: ResourceKind }
  | { kind: "buildFacility"; facilityId: string }
  | { kind: "maintainFacility"; facilityId: string }
  | { kind: "rest" }
  | { kind: "deposit" };
```

Add `maintaining` to `AgentActivity`, add `rationStrain: number` and
`lastRationTick: number | null` to `AgentState`, change `buildings` to
`Building[]`, and add:

```ts
spatialDemands: SpatialDemand[];
trailCells: TrailCell[];
```

`trailCells` is row-major and always has `width * height` entries.

## Frozen Constants

All simulation and display thresholds belong in
`packages/shared/src/constants.ts`. Use these initial values; tune only through
the acceptance test in Task 6, and keep every changed value in this file.

```ts
export const FACILITY_KIND_BY_INSTITUTION = {
  communalGranaryStore: "communalGranary",
  grainMarket: "grainMarket",
  rationControl: "rationDepot",
} as const satisfies Readonly<Record<InstitutionKind, FacilityKind>>;

export const FACILITY_NAMES = {
  communalGranary: "共同穀倉",
  grainMarket: "穀物市場",
  rationDepot: "配給所",
} as const satisfies Readonly<Record<FacilityKind, string>>;

export const FACILITY_WOOD_COST = {
  communalGranary: 15,
  grainMarket: 12,
  rationDepot: 10,
} as const satisfies Readonly<Record<FacilityKind, number>>;

export const FACILITY_BUILD_TICKS = {
  communalGranary: 240,
  grainMarket: 200,
  rationDepot: 180,
} as const satisfies Readonly<Record<FacilityKind, number>>;

export const FACILITY_FOOD_CAPACITY = {
  communalGranary: 120,
  grainMarket: 80,
  rationDepot: 80,
} as const satisfies Readonly<Record<FacilityKind, number>>;

export const FACILITY_MAINTENANCE_PER_DAY = {
  communalGranary: 40,
  grainMarket: 30,
  rationDepot: 35,
} as const satisfies Readonly<Record<FacilityKind, number>>;

export const FACILITY_SITE_DISTANCE_CAP = 32;
export const SPATIAL_DEMAND_RETRY_INTERVAL_TICKS = 100;

export const FACILITY_SITE_WEIGHTS = {
  communalGranary: {
    foodAccess: 0.25,
    residentAccess: 0.2,
    stockpileAccess: 0.25,
    existingTraffic: 0.05,
    settlementEdgeAccess: 0,
    openSpace: 0.15,
    accessEquality: 0.1,
  },
  grainMarket: {
    foodAccess: 0.05,
    residentAccess: 0.2,
    stockpileAccess: 0.1,
    existingTraffic: 0.25,
    settlementEdgeAccess: 0.2,
    openSpace: 0.2,
    accessEquality: 0,
  },
  rationDepot: {
    foodAccess: 0.05,
    residentAccess: 0.25,
    stockpileAccess: 0.15,
    existingTraffic: 0.1,
    settlementEdgeAccess: 0,
    openSpace: 0.15,
    accessEquality: 0.3,
  },
} as const satisfies Readonly<
  Record<FacilityKind, Readonly<Record<SiteFactor, number>>>
>;

export const STOCKPILE_FOOD_SPOILAGE_RATE = 0.04;
export const GRANARY_FOOD_SPOILAGE_RATE = 0.01;
export const FACILITY_RESERVE_FOOD_DAYS = 4;
export const MARKET_TRADE_INTERVAL_TICKS = 600;
export const MARKET_IMPORT_WOOD = 5;
export const MARKET_IMPORT_FOOD = 10;
export const MARKET_EXPORT_FOOD = 10;
export const MARKET_EXPORT_WOOD = 4;
export const MARKET_IMPORT_BELOW_FOOD_DAYS = 3;
export const MARKET_EXPORT_ABOVE_FOOD_DAYS = 7;
export const RATION_FOOD_PER_MEAL = 4;
export const RATION_HUNGER_PER_MEAL = 50;
export const RATION_BELOW_FOOD_DAYS = 4;
export const RATION_STRAIN_PER_MEAL = 0.08;
export const RATION_STRAIN_RECOVERY_PER_DAY = 0.03;
export const RATION_SUPPORT_PENALTY = 0.35;

export const TRAIL_LEVEL_WEAR = {
  none: 0,
  trace: 2,
  trail: 8,
  establishedTrail: 24,
} as const satisfies Readonly<Record<TrailLevel, number>>;

export const TRAIL_PURPOSE_WEAR = {
  survival: 0.5,
  gathering: 0.65,
  construction: 1,
  facilityService: 1,
  wandering: 0.05,
} as const satisfies Readonly<Record<MovementPurpose, number>>;

export const TRAIL_DAILY_DECAY = 0.85;
export const TRAIL_MAX_CAUSE_FACILITIES = 3;
export const TRAIL_MOVE_TICK_MULTIPLIER = {
  none: 1,
  trace: 0.95,
  trail: 0.8,
  establishedTrail: 0.65,
} as const satisfies Readonly<Record<TrailLevel, number>>;
```

The client-only colors remain in client files:

```ts
export const TRAIL_COLORS = {
  trace: 0x9a835f,
  trail: 0x876a43,
  establishedTrail: 0x6c5234,
} as const;

export const FACILITY_COLORS = {
  communalGranary: 0xb89152,
  grainMarket: 0xb75f45,
  rationDepot: 0x687b82,
} as const;
```

## Deterministic IDs and Ordering

Use these exact IDs:

```text
demand-<institution id>
facility-<institution id>
```

Stable rules:

- institutions are inspected in `INSTITUTION_KINDS` order;
- agents are processed by stable `agent.id`;
- candidate sites are listed row-major before scoring;
- exact top-score ties are selected with the engine's injected seeded RNG from
  the already-stable top-candidate list;
- ration priority is hunger ascending, then health ascending, then last ration
  tick ascending, then `agent.id`;
- facility-cause lists are sorted by contribution descending, then facility ID;
- no ID contains `Date.now`, UUID, random text, mutable array length, or client
  state.

## Simulation Invariants

1. Construction wood exists in exactly one location: stockpile, resident
   carrying state, or `Facility.woodDelivered`.
2. Food changes only through gathering, eating, spoilage, or recorded market
   exchange. Moving between stores preserves the total.
3. An incomplete facility cannot store food, accept maintenance, trade, ration,
   reduce spoilage, or attract service tasks.
4. A market import subtracts all required wood before adding food; an export
   subtracts all food before adding wood.
5. A trail increment occurs only after an agent completes one tile step.
6. A trail never appears on water, rock, or a building-occupied tile.
7. The client receives, renders, filters, and formats authoritative state; it
   never changes simulation fields.

## File Responsibilities

| File | Responsibility |
|---|---|
| `packages/shared/src/spatial.ts` | Frozen demand, facility, movement-purpose, and trail contracts |
| `packages/shared/src/world.ts` | Building union, internal facility tasks, resident strain, required world fields |
| `packages/shared/src/constants.ts` | Every facility, site, operation, ration, market, and trail value |
| `packages/shared/src/time.ts` | Total and accessible stored food calculations |
| `packages/shared/src/protocol.ts` | Required update arrays and sparse changed trail cells |
| `packages/server/src/sim/spatialDemand.ts` | One demand per institution and status transitions |
| `packages/server/src/sim/siteSelection.ts` | Candidate filtering, factor normalization, scoring, tie resolution |
| `packages/server/src/sim/construction.ts` | Facility lookup, material withdrawal/delivery, build and maintenance mutation |
| `packages/server/src/sim/facilityOperation.ts` | Food stores, spoilage, granary reserve, market exchange, ration rules |
| `packages/server/src/sim/traffic.ts` | Empty trail grid, traversal recording, decay, levels, cause ranking |
| `packages/server/src/sim/astar.ts` | Trail-aware deterministic path cost |
| `packages/server/src/sim/fakePlanner.ts` | Survival-first facility hauling, building, maintenance, and stocking choices |
| `packages/server/src/sim/executor.ts` | Movement and action execution; emit completed traversal records |
| `packages/server/src/sim/engine.ts` | Approved update order, dirty trail ownership, daily/interval hooks |
| `packages/server/src/net/wsServer.ts` | Sparse authoritative update transport |
| `packages/client/src/net/wsClient.ts` | Apply changed trail cells and replace full authoritative arrays |
| `packages/client/src/render/trailLayer.ts` | Pure trail visual mapping and PixiJS ground overlay |
| `packages/client/src/render/structureLayer.ts` | Distinct facility and existing house rendering |
| `packages/client/src/ui/spatialViewModel.ts` | Japanese facility/trail causality and milestone view models |
| `packages/client/src/ui/infoBubble.ts` | Facility/trail hit targets and compact summaries |
| `packages/client/src/ui/inspectPanel.ts` | Agent/facility/trail detail union and shared panel controller |
| `packages/client/src/main.ts` | Selection, dirty-layer, overlay, and ticker wiring only |
| `packages/client/index.html` | Overlay button and responsive causal panel styles |

## Task 1: Add Strict Shared Spatial Contracts

**Branch:** `codex/s5-social-facilities-trails` from `main` after this plan is
committed

**Commit:** `feat(shared): define social facility and trail contracts`

**Files:**

- Create: `packages/shared/src/spatial.ts`
- Create: `packages/shared/test/spatial.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/world.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/server/src/sim/worldGen.ts`
- Modify: `packages/server/src/sim/engine.ts`
- Modify: `packages/server/src/sim/executor.ts`
- Modify: `packages/server/src/sim/fakePlanner.ts`
- Modify: `packages/server/src/llm/planPrompt.ts`
- Modify: `packages/server/src/llm/normalizePlan.ts`
- Modify: `packages/server/src/llm/planSchema.ts`
- Modify: `packages/client/src/render/structureLayer.ts`
- Modify: `packages/client/src/ui/infoBubble.ts`
- Modify: `packages/client/src/ui/displayText.ts`
- Modify: every explicit `WorldState` and `AgentState` fixture reported by:

```sh
rg -l 'WorldState\s*=\s*\{|satisfies WorldState|desires:\s*\{\s*foodSecurity' packages --glob '*.ts'
```

**Interfaces:**

- Produces: frozen contracts above, `Building`, internal facility tasks,
  `rationStrain`, empty world arrays, and all shared constants.
- Defers: protocol update transport, demand generation, executor behavior, and
  rendering.

- [ ] **Step 1: Write the failing shared contract test**

Create `packages/shared/test/spatial.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  FACILITY_BUILD_TICKS,
  FACILITY_KIND_BY_INSTITUTION,
  FACILITY_NAMES,
  FACILITY_SITE_WEIGHTS,
  FACILITY_WOOD_COST,
  TRAIL_LEVEL_WEAR,
  TRAIL_PURPOSE_WEAR,
  type Facility,
  type SpatialDemand,
  type TrailCell,
} from "../src/index.js";

describe("spatial contracts", () => {
  it("maps every institution to one configured facility", () => {
    expect(FACILITY_KIND_BY_INSTITUTION).toEqual({
      communalGranaryStore: "communalGranary",
      grainMarket: "grainMarket",
      rationControl: "rationDepot",
    });
    expect(Object.keys(FACILITY_NAMES)).toEqual([
      "communalGranary",
      "grainMarket",
      "rationDepot",
    ]);
    expect(Object.keys(FACILITY_WOOD_COST)).toEqual(Object.keys(FACILITY_BUILD_TICKS));
    expect(Object.keys(FACILITY_SITE_WEIGHTS)).toEqual(Object.keys(FACILITY_NAMES));
  });

  it("keeps trail thresholds ordered and wandering wear weakest", () => {
    expect([
      TRAIL_LEVEL_WEAR.none,
      TRAIL_LEVEL_WEAR.trace,
      TRAIL_LEVEL_WEAR.trail,
      TRAIL_LEVEL_WEAR.establishedTrail,
    ]).toEqual([0, 2, 8, 24]);
    expect(TRAIL_PURPOSE_WEAR.wandering).toBeLessThan(TRAIL_PURPOSE_WEAR.gathering);
  });

  it("accepts complete demand, facility, and trail values", () => {
    const demand = {
      id: "demand-institution-1",
      facilityKind: "communalGranary",
      source: { kind: "institution", id: "institution-1" },
      supporterIds: ["agent-1"],
      requiredWood: 15,
      requiredLabor: 240,
      status: "seekingSite",
      blockedReason: null,
      site: null,
      siteRationale: null,
      provenance: {
        causedByEventIds: [],
        proposedByAgentIds: ["agent-1"],
        supportedByAgentIds: ["agent-1"],
        opposedByAgentIds: [],
        decidedAtTick: 10,
      },
    } satisfies SpatialDemand;
    const facility = {
      kind: "communalGranary",
      id: "facility-institution-1",
      demandId: demand.id,
      institutionId: "institution-1",
      pos: { x: 1, y: 1 },
      progress: 0,
      complete: false,
      woodDelivered: 0,
      inventory: { wood: 0, food: 0 },
      operation: "inactive",
      blockedReason: null,
      maintenanceDue: 0,
      statsToday: {
        visits: 0,
        foodPreserved: 0,
        foodImported: 0,
        foodExported: 0,
        woodSpent: 0,
        woodReceived: 0,
        rationMeals: 0,
        maintenanceWork: 0,
      },
      lastUsedAtTick: null,
      lastTradeTick: null,
      siteRationale: { score: 1, contributions: [] },
      provenance: demand.provenance,
    } satisfies Facility;
    const trail = {
      wear: 0,
      level: "none",
      passagesToday: 0,
      purposeWear: {
        survival: 0,
        gathering: 0,
        construction: 0,
        facilityService: 0,
        wandering: 0,
      },
      dominantPurpose: null,
      facilityWear: {},
      causedByFacilityIds: [],
      lastUsedAtTick: null,
    } satisfies TrailCell;

    expect([demand.id, facility.id, trail.level]).toEqual([
      "demand-institution-1",
      "facility-institution-1",
      "none",
    ]);
  });
});
```

- [ ] **Step 2: Run the focused test to verify Red**

Run:

```sh
pnpm vitest run packages/shared/test/spatial.test.ts
```

Expected: FAIL because `spatial.ts` and the facility/trail constants do not
exist.

- [ ] **Step 3: Add the shared module and exact constants**

Create `packages/shared/src/spatial.ts` with **Frozen Shared Contracts**. Add the
complete **Frozen Constants** block to `packages/shared/src/constants.ts` with
type-only imports:

```ts
import type {
  FacilityKind,
  MovementPurpose,
  SiteFactor,
  TrailLevel,
} from "./spatial.js";
```

Export it from `packages/shared/src/index.ts`:

```ts
export * from "./spatial.js";
```

- [ ] **Step 4: Make the world contract strict and initialize it**

Apply the exact `world.ts` changes under **Frozen Shared Contracts**. In
`packages/server/src/sim/worldGen.ts`, initialize residents and world state:

```ts
rationStrain: 0,
lastRationTick: null,
```

```ts
spatialDemands: [],
trailCells: Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => ({
  wear: 0,
  level: "none",
  passagesToday: 0,
  purposeWear: {
    survival: 0,
    gathering: 0,
    construction: 0,
    facilityService: 0,
    wandering: 0,
  },
  dominantPurpose: null,
  facilityWear: {},
  causedByFacilityIds: [],
  lastUsedAtTick: null,
})),
```

Move the repeated cell construction into `emptyTrailCell()` only when Task 3
creates the traffic module. Until then, keep this one literal in the world
generator so Task 1 compiles independently.

- [ ] **Step 5: Preserve house-only behavior across the building union**

Use `isHouse` in every house-only reader:

```ts
world.buildings.filter(isHouse)
```

Apply it to:

- completed housing capacity in `engine.ts`, `fakePlanner.ts`, and
  `llm/planPrompt.ts`;
- incomplete/new house targeting in `fakePlanner.ts`;
- house lookup and rest targets in `executor.ts`;
- normalization and validation in `llm/normalizePlan.ts` and
  `llm/planSchema.ts`;
- house-only rendering and hit testing in `structureLayer.ts` and
  `infoBubble.ts`.

Keep all-building occupancy tests unchanged. Add exact labels required by the
new task/activity union in `displayText.ts`:

```ts
maintaining: "施設維持中",
```

```ts
buildFacility: "施設建設",
maintainFacility: "施設維持",
transferToFacility: "施設へ搬入",
```

This step is a strict migration, not facility behavior. A facility must not
increase housing capacity, become a rest target, validate as a house build, or
render as a house before Tasks 4 and 8.

- [ ] **Step 6: Migrate explicit test fixtures without casts**

For every `AgentState` fixture, add:

```ts
rationStrain: 0,
lastRationTick: null,
```

For every `WorldState` fixture, add arrays matching its dimensions:

```ts
spatialDemands: [],
trailCells: Array.from({ length: width * height }, () => ({
  wear: 0,
  level: "none" as const,
  passagesToday: 0,
  purposeWear: {
    survival: 0,
    gathering: 0,
    construction: 0,
    facilityService: 0,
    wandering: 0,
  },
  dominantPurpose: null,
  facilityWear: {},
  causedByFacilityIds: [],
  lastUsedAtTick: null,
})),
```

Use each fixture's real width and height. Do not add `as WorldState`, optional
fields, or a runtime compatibility fallback.

- [ ] **Step 7: Run focused and full gates**

Run:

```sh
pnpm vitest run packages/shared/test/spatial.test.ts packages/server/test/worldGen.test.ts
pnpm biome check packages/shared/src/spatial.ts packages/shared/src/world.ts packages/shared/src/constants.ts packages/shared/src/index.ts packages/server/src/sim/worldGen.ts packages/shared/test/spatial.test.ts
pnpm -r exec tsc
rg -n 'rationStrain|spatialDemands|trailCells' packages --glob '*.ts'
rg -n 'world\\.buildings|buildings\\.filter|buildings\\.find' packages/server/src packages/client/src
git diff --check
just check && just test
```

Expected: the focused tests and all existing 459 tests pass, TypeScript reports
no missing strict fields, every house-only reader uses `isHouse`, and the
identifier scan contains no production defaulting of required state.

- [ ] **Step 8: Commit Task 1**

```sh
git add packages/shared/src packages/shared/test/spatial.test.ts packages/server/src/sim packages/server/src/llm packages/client/src/render/structureLayer.ts packages/client/src/ui/infoBubble.ts packages/client/src/ui/displayText.ts packages/server/test packages/client/test
git commit -m "feat(shared): define social facility and trail contracts"
```

## Task 2: Generate One Demand and Select One Causal Site

**Commit:** `feat(sim): turn institutions into spatial demands`

**Files:**

- Create: `packages/server/src/sim/siteSelection.ts`
- Create: `packages/server/src/sim/spatialDemand.ts`
- Create: `packages/server/test/siteSelection.test.ts`
- Create: `packages/server/test/spatialDemand.test.ts`
- Modify: `packages/server/src/sim/engine.ts`

**Interfaces:**

```ts
export function selectFacilitySite(
  world: WorldState,
  kind: FacilityKind,
  rng: () => number,
): { pos: Position; rationale: SiteRationale } | null;

export function advanceSpatialDemands(world: WorldState, rng: () => number): void;
```

- [ ] **Step 1: Write failing site-selection tests**

Create `packages/server/test/siteSelection.test.ts`. Build a `7 × 5` plains
world with residents at `(1, 2)` and `(5, 2)`, stockpile `(3, 2)`, food at
`(0, 2)`, an occupied building, one resource tile, and a high-wear corridor.
Assert:

```ts
expect(selectFacilitySite(world, "communalGranary", () => 0)).toEqual({
  pos: { x: 2, y: 2 },
  rationale: expect.objectContaining({
    contributions: expect.arrayContaining([
      expect.objectContaining({ factor: "foodAccess" }),
      expect.objectContaining({ factor: "stockpileAccess" }),
    ]),
  }),
});

expect(selectFacilitySite(world, "grainMarket", () => 0)).toEqual(
  expect.objectContaining({
    rationale: expect.objectContaining({
      contributions: expect.arrayContaining([
        expect.objectContaining({ factor: "existingTraffic" }),
        expect.objectContaining({ factor: "settlementEdgeAccess" }),
      ]),
    }),
  }),
);

expect(selectFacilitySite(world, "rationDepot", () => 0)).toEqual(
  expect.objectContaining({
    rationale: expect.objectContaining({
      contributions: expect.arrayContaining([
        expect.objectContaining({ factor: "accessEquality" }),
      ]),
    }),
  }),
);
```

Add cases proving water, rock, resources, stockpile, agents, buildings, and
unreachable cells are excluded; no candidate returns `null`; and an exact tie
uses the injected RNG on a row-major candidate list.

- [ ] **Step 2: Write failing demand lifecycle tests**

Create `packages/server/test/spatialDemand.test.ts` and seed one established
institution with known provenance. Assert:

```ts
advanceSpatialDemands(world, () => 0);
advanceSpatialDemands(world, () => 0);

expect(world.spatialDemands).toHaveLength(1);
expect(world.spatialDemands[0]).toMatchObject({
  id: `demand-${institution.id}`,
  facilityKind: "communalGranary",
  source: { kind: "institution", id: institution.id },
  supporterIds: institution.supporterIds,
  requiredWood: FACILITY_WOOD_COST.communalGranary,
  requiredLabor: FACILITY_BUILD_TICKS.communalGranary,
  status: "awaitingMaterials",
  blockedReason: null,
});
expect(world.buildings).toContainEqual(
  expect.objectContaining({
    id: `facility-${institution.id}`,
    demandId: `demand-${institution.id}`,
    institutionId: institution.id,
    complete: false,
    woodDelivered: 0,
  }),
);
```

Add three table cases for institution-to-facility mapping and one fully blocked
map case that retains one demand with `blockedReason: "noValidSite"` and creates
no facility. Make one site walkable, advance to the exact
`SPATIAL_DEMAND_RETRY_INTERVAL_TICKS` boundary, call again, and assert the same
demand ID gains a site and one facility. Before that boundary, it must remain
blocked without rescanning.

- [ ] **Step 3: Run both suites to verify Red**

Run:

```sh
pnpm vitest run packages/server/test/siteSelection.test.ts packages/server/test/spatialDemand.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement pure candidate filtering and scoring**

In `siteSelection.ts`, keep these helpers private and bounded:

```ts
function proximity(distance: number): number {
  return 1 - Math.min(distance, FACILITY_SITE_DISTANCE_CAP) / FACILITY_SITE_DISTANCE_CAP;
}

function siteIndex(world: WorldState, pos: Position): number {
  return pos.y * world.width + pos.x;
}

function scoreSite(
  world: WorldState,
  kind: FacilityKind,
  pos: Position,
): SiteRationale {
  const values: Readonly<Record<SiteFactor, number>> = {
    foodAccess: proximity(nearestFoodDistance(world, pos)),
    residentAccess: proximity(meanResidentDistance(world, pos)),
    stockpileAccess: proximity(manhattanDistance(pos, world.stockpile.pos)),
    existingTraffic: Math.min(
      1,
      (world.trailCells[siteIndex(world, pos)]?.wear ?? 0) /
        TRAIL_LEVEL_WEAR.establishedTrail,
    ),
    settlementEdgeAccess: proximity(distanceToMapEdge(world, pos)),
    openSpace: cardinalOpenSpace(world, pos) / 4,
    accessEquality: proximity(residentDistanceSpread(world, pos)),
  };
  const weights = FACILITY_SITE_WEIGHTS[kind];
  const contributions = SITE_FACTORS.filter((factor) => weights[factor] > 0)
    .map((factor) => ({
      factor,
      value: values[factor],
      weightedScore: values[factor] * weights[factor],
    }))
    .toSorted(
      (left, right) =>
        right.weightedScore - left.weightedScore || left.factor.localeCompare(right.factor),
    );
  return {
    score: contributions.reduce((sum, contribution) => sum + contribution.weightedScore, 0),
    contributions,
  };
}
```

Use actual path reachability from `filterReachable`, not Manhattan reachability.
Return fresh positions/rationales without mutating the world.

- [ ] **Step 5: Implement idempotent demand and facility creation**

In `spatialDemand.ts`, use:

```ts
function demandId(institutionId: string): string {
  return `demand-${institutionId}`;
}

function facilityId(institutionId: string): string {
  return `facility-${institutionId}`;
}
```

For each institution in `INSTITUTION_KINDS` order:

1. create one `SpatialDemand` from the institution and shared constants when
   its stable demand ID does not exist;
2. skip fulfilled, building, and awaiting-material demands;
3. retry a blocked demand only on the shared retry interval;
4. select a site for a new or retry-eligible demand;
5. retain a blocked demand if selection is null;
6. otherwise create one incomplete `Facility` with zero inventory/stats,
   `lastUsedAtTick: null`, and `lastTradeTick: null`, then set demand status to
   `awaitingMaterials`.

Never infer provenance from current client text. Copy the institution's frozen
provenance object and arrays.

- [ ] **Step 6: Call demand advancement at the approved engine boundary**

In `createEngine`, remove `void rng` and call:

```ts
updateFoodSecurityDesires(world);
advanceSociety(world, societyMemory);
advanceSpatialDemands(world, rng);
```

Keep agent execution and daily hooks otherwise unchanged until Task 6 performs
the complete order refactor.

- [ ] **Step 7: Run focused and full gates**

Run:

```sh
pnpm vitest run packages/server/test/siteSelection.test.ts packages/server/test/spatialDemand.test.ts packages/server/test/engine.test.ts
pnpm biome check packages/server/src/sim/siteSelection.ts packages/server/src/sim/spatialDemand.ts packages/server/src/sim/engine.ts packages/server/test/siteSelection.test.ts packages/server/test/spatialDemand.test.ts
rg -n 'FACILITY_SITE_|FACILITY_WOOD_COST|FACILITY_BUILD_TICKS|SPATIAL_DEMAND_RETRY_INTERVAL_TICKS' packages/server/src packages/shared/src
git diff --check
just check && just test
```

Expected: both new suites pass, existing engine determinism remains green, and
the scan shows constants owned only by shared.

- [ ] **Step 8: Commit Task 2**

```sh
git add packages/server/src/sim/siteSelection.ts packages/server/src/sim/spatialDemand.ts packages/server/src/sim/engine.ts packages/server/test/siteSelection.test.ts packages/server/test/spatialDemand.test.ts
git commit -m "feat(sim): turn institutions into spatial demands"
```

## Task 3: Record Real Traffic and Make Trails Affect Paths

**Commit:** `feat(sim): grow trails from resident traffic`

**Files:**

- Create: `packages/server/src/sim/traffic.ts`
- Create: `packages/server/test/traffic.test.ts`
- Modify: `packages/server/src/sim/astar.ts`
- Modify: `packages/server/test/astar.test.ts`
- Modify: `packages/server/src/sim/executor.ts`
- Modify: `packages/server/test/executor.test.ts`
- Modify: `packages/server/src/sim/worldGen.ts`

**Interfaces:**

```ts
export interface Traversal {
  pos: Position;
  purpose: MovementPurpose;
  facilityId: string | null;
}

export function emptyTrailCell(): TrailCell;
export function createTrailCells(width: number, height: number): TrailCell[];
export function recordTraversal(world: WorldState, traversal: Traversal): number | null;
export function decayTrails(world: WorldState): number[];
export function moveTicksForTrail(level: TrailLevel): number;
export function pathCostForTrail(level: TrailLevel): number;
```

- [ ] **Step 1: Write failing traffic-state tests**

Create `packages/server/test/traffic.test.ts` and assert:

```ts
const index = recordTraversal(world, {
  pos: { x: 1, y: 0 },
  purpose: "facilityService",
  facilityId: "facility-1",
});

expect(index).toBe(1);
expect(world.trailCells[1]).toMatchObject({
  wear: TRAIL_PURPOSE_WEAR.facilityService,
  passagesToday: 1,
  dominantPurpose: "facilityService",
  causedByFacilityIds: ["facility-1"],
  lastUsedAtTick: world.tick,
});
```

Add cases for:

- repeated steps crossing `trace`, `trail`, and `establishedTrail` exactly at
  shared thresholds;
- purpose contribution ties resolved by the fixed `MovementPurpose` order;
- facility causes ranked by contribution then ID and capped at three;
- water, rock, and building positions returning `null`;
- daily decay reducing wear and level, resetting `passagesToday`, and removing
  exhausted purpose/facility contributions;
- `createTrailCells(width, height)` returning independent cells, not references
  to one shared object.

- [ ] **Step 2: Write failing trail-aware A* tests**

Extend `packages/server/test/astar.test.ts` with a `5 × 3` world where the direct
route is four plain steps and the alternate route is six established-trail
steps. Assert:

```ts
expect(findPath(world, { x: 0, y: 1 }, { x: 4, y: 1 })).toContainEqual({
  x: 0,
  y: 0,
});
```

Also assert that an excessively long trail still loses to a short plain route,
and row-major ties remain deterministic.

- [ ] **Step 3: Run focused tests to verify Red**

Run:

```sh
pnpm vitest run packages/server/test/traffic.test.ts packages/server/test/astar.test.ts
```

Expected: FAIL because `traffic.ts` is missing and A* still uses unit costs.

- [ ] **Step 4: Implement trail cells, traversal mutation, and decay**

Create `traffic.ts` using this level selection:

```ts
function trailLevel(wear: number): TrailLevel {
  if (wear >= TRAIL_LEVEL_WEAR.establishedTrail) return "establishedTrail";
  if (wear >= TRAIL_LEVEL_WEAR.trail) return "trail";
  if (wear >= TRAIL_LEVEL_WEAR.trace) return "trace";
  return "none";
}
```

`recordTraversal` mutates exactly one row-major cell, recalculates level,
dominant purpose, and cause IDs, and returns the changed index. `decayTrails`
runs only at a day boundary, returns every index whose public value changed,
multiplies wear and contribution values by `TRAIL_DAILY_DECAY`, removes values
below `Number.EPSILON`, and resets passages.

Replace the literal initialization in `worldGen.ts` with:

```ts
trailCells: createTrailCells(MAP_WIDTH, MAP_HEIGHT),
```

Define the two cost helpers once and use them from both the executor and A*:

```ts
const BASE_PATH_COST = 100;

export function moveTicksForTrail(level: TrailLevel): number {
  return MOVE_TICKS_PER_TILE * TRAIL_MOVE_TICK_MULTIPLIER[level];
}

export function pathCostForTrail(level: TrailLevel): number {
  return Math.round(BASE_PATH_COST * TRAIL_MOVE_TICK_MULTIPLIER[level]);
}
```

The movement threshold may be fractional; compare accumulated progress against
it directly so the configured trail and established-trail multipliers remain
distinct at the current base movement duration.

- [ ] **Step 5: Make A* use an admissible weighted cost**

Use integer hundredths to avoid floating comparison drift:

```ts
const MIN_PATH_COST = pathCostForTrail("establishedTrail");

function stepCost(world: WorldState, pos: Position): number {
  const level = world.trailCells[pos.y * world.width + pos.x]?.level ?? "none";
  return pathCostForTrail(level);
}
```

Change neighbor distance to `current.distance + stepCost(world, next)` and the
heuristic to Manhattan distance times `MIN_PATH_COST`. Keep node tie ordering
estimated total, distance, y, x.

- [ ] **Step 6: Emit traffic only after completed movement steps**

Add an optional recorder to `stepAgent`:

```ts
export type TraversalRecorder = (traversal: Traversal) => void;

export function stepAgent(
  world: WorldState,
  agent: AgentState,
  speed = 1,
  record: TraversalRecorder = () => undefined,
): void;
```

Whenever `agent.pos = next` occurs, call the recorder after assignment. Derive
purpose from the active or following task:

```ts
function movementPurpose(tasks: AgentTask[]): MovementPurpose {
  const task = tasks[0]?.kind === "moveTo" ? tasks[1] : tasks[0];
  if (task?.kind === "build" || task?.kind === "buildFacility") return "construction";
  if (
    task?.kind === "transferToFacility" ||
    task?.kind === "maintainFacility"
  ) {
    return "facilityService";
  }
  if (task?.kind === "gather") return "gathering";
  if (task?.kind === "eat" || task?.kind === "forage" || task?.kind === "rest") {
    return "survival";
  }
  return "wandering";
}
```

Facility tasks do not execute until Task 4, but their movement purpose is frozen
here. Set `facilityId` only for those three facility task kinds.

Use `moveTicksForTrail` for each next tile instead of comparing only with
`MOVE_TICKS_PER_TILE`. Preserve fatigue speed and never complete more than one
tile per engine tick.

- [ ] **Step 7: Prove attempted and partial moves do not create wear**

Add executor tests that call `stepAgent` for
`MOVE_TICKS_PER_TILE - 1` ticks and observe no recorder calls, then complete the
step and expect one exact traversal. Add blocked and zero-length path cases with
zero calls.

- [ ] **Step 8: Run focused and full gates**

Run:

```sh
pnpm vitest run packages/server/test/traffic.test.ts packages/server/test/astar.test.ts packages/server/test/executor.test.ts
pnpm biome check packages/server/src/sim/traffic.ts packages/server/src/sim/astar.ts packages/server/src/sim/executor.ts packages/server/src/sim/worldGen.ts packages/server/test/traffic.test.ts packages/server/test/astar.test.ts packages/server/test/executor.test.ts
rg -n 'TRAIL_|recordTraversal|agent\\.pos = next' packages/server/src packages/shared/src
git diff --check
just check && just test
```

Expected: actual completed steps are the sole wear source, weighted A* tests
pass, and all repository gates stay green.

- [ ] **Step 9: Commit Task 3**

```sh
git add packages/server/src/sim/traffic.ts packages/server/src/sim/astar.ts packages/server/src/sim/executor.ts packages/server/src/sim/worldGen.ts packages/server/test/traffic.test.ts packages/server/test/astar.test.ts packages/server/test/executor.test.ts
git commit -m "feat(sim): grow trails from resident traffic"
```

## Task 4: Haul Real Wood and Construct Facilities

**Commit:** `feat(sim): let residents build institution facilities`

**Files:**

- Create: `packages/server/src/sim/construction.ts`
- Create: `packages/server/test/construction.test.ts`
- Modify: `packages/server/src/sim/executor.ts`
- Modify: `packages/server/test/executor.test.ts`
- Modify: `packages/server/src/sim/fakePlanner.ts`
- Modify: `packages/server/test/fakePlanner.test.ts`
- Modify: `packages/server/src/llm/planSchema.ts`
- Modify: `packages/server/test/planSchema.test.ts`

**Interfaces:**

```ts
export function findFacility(world: WorldState, facilityId: string): Facility | null;
export function facilityWoodRemaining(world: WorldState, facility: Facility): number;
export function withdrawFacilityTransfer(
  world: WorldState,
  facility: Facility,
  resource: ResourceKind,
): number;
export function deliverFacilityTransfer(
  world: WorldState,
  facility: Facility,
  resource: ResourceKind,
  amount: number,
): number;
export function applyFacilityBuild(
  world: WorldState,
  facility: Facility,
  work: number,
): boolean;
export function applyFacilityMaintenance(facility: Facility, work: number): number;
export function planFacilityTasks(world: WorldState, agent: AgentState): AgentTask[] | null;
```

- [ ] **Step 1: Write failing conservation and state-transition tests**

Create `packages/server/test/construction.test.ts`. Start with a facility needing
15 wood, a stockpile containing 10, and one resident. Assert:

```ts
const withdrawn = withdrawFacilityTransfer(world, facility, "wood");
expect(withdrawn).toBe(CARRY_CAPACITY);
expect(world.stockpile.wood).toBe(5);

const remainder = deliverFacilityTransfer(world, facility, "wood", withdrawn);
expect(remainder).toBe(0);
expect(facility.woodDelivered).toBe(CARRY_CAPACITY);
expect(totalConstructionWood(world, facility, remainder)).toBe(10);
```

Add cases proving:

- withdrawal is zero without stock or for an invalid destination need;
- delivery clamps to remaining wood and returns overflow;
- food cannot enter an incomplete facility;
- `applyFacilityBuild` does not advance before all wood arrives;
- progress advances by supplied work, clamps to configured labor, marks complete,
  activates the facility, and changes its demand to `fulfilled`;
- maintenance work clamps at zero due and records only applied work.

- [ ] **Step 2: Write failing executor action tests**

Extend `packages/server/test/executor.test.ts` with:

```ts
const agent = createAgent({
  pos: { x: 0, y: 0 },
  tasks: [
    {
      kind: "transferToFacility",
      facilityId: facility.id,
      resource: "wood",
    },
  ],
});
```

Assert that the agent:

1. walks beside the stockpile;
2. withdraws exactly one carry load;
3. remains on the same task;
4. walks beside the facility;
5. transfers wood into `woodDelivered`;
6. finishes the task with no duplicated or lost wood.

Add tests for `buildFacility` and `maintainFacility`, missing facility IDs,
unreachable targets, wrong carried resource, overflow returned in carrying
state, and survival movement still using the traversal recorder.

- [ ] **Step 3: Write failing planner priority tests**

Extend `packages/server/test/fakePlanner.test.ts` with exact expectations:

```ts
expect(planner.plan(world, agent)).toEqual([
  {
    kind: "transferToFacility",
    facilityId: facility.id,
    resource: "wood",
  },
]);
```

when an incomplete facility needs delivered wood and the stockpile has wood.
Expect `buildFacility` after all wood arrives and `maintainFacility` for a
complete facility with positive `maintenanceDue`.

Prove the order:

```text
carried-resource deposit
  > hunger
  > fatigue
  > facility transfer/build/maintenance
  > incomplete house
  > new house
  > survival resource targets
  > wandering
```

When construction needs wood but the stockpile is empty, the existing resource
planner must gather wood. It must not create a transfer task that immediately
fails.

- [ ] **Step 4: Run the focused suites to verify Red**

Run:

```sh
pnpm vitest run packages/server/test/construction.test.ts packages/server/test/executor.test.ts packages/server/test/fakePlanner.test.ts
```

Expected: FAIL because construction helpers and facility action execution do
not exist.

- [ ] **Step 5: Implement pure construction mutations**

Create `construction.ts`. Use:

```ts
function demandForFacility(world: WorldState, facility: Facility): SpatialDemand {
  const demand = world.spatialDemands.find(({ id }) => id === facility.demandId);
  if (demand === undefined) {
    throw new Error(`facility ${facility.id} has no demand ${facility.demandId}`);
  }
  return demand;
}
```

`withdrawFacilityTransfer` subtracts from the stockpile only when it returns a
positive amount. For incomplete facilities, wood delivery goes to
`woodDelivered`; for complete facilities, food/wood goes to `inventory`.
Capacity applies to food. Any unaccepted amount stays with the resident.

`applyFacilityBuild` updates demand status to `building` when wood is complete,
uses `FACILITY_BUILD_TICKS[facility.kind]`, and on completion sets:

```ts
facility.complete = true;
facility.operation = "active";
facility.blockedReason = null;
demand.status = "fulfilled";
```

- [ ] **Step 6: Execute facility actions without duplicating movement logic**

In `executor.ts`, extend `stepToward` call sites rather than adding a second path
walker. Implement:

```ts
function stepTransferToFacility(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "transferToFacility" }>,
  speed: number,
  record: TraversalRecorder,
): void;

function stepBuildFacility(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "buildFacility" }>,
  speed: number,
  record: TraversalRecorder,
): void;

function stepMaintainFacility(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "maintainFacility" }>,
  speed: number,
  record: TraversalRecorder,
): void;
```

Use the existing adjacent approach-position helper. A transfer with no carried
resource first approaches the stockpile and withdraws. A resident carrying the
requested resource approaches the facility and delivers. Construction and
maintenance set `building` and new `maintaining` activities respectively.
Task 1 already added the exhaustive Japanese labels required for these strict
union variants.

- [ ] **Step 7: Add facility priorities without exposing them to LLM output**

Implement and call `planFacilityTasks` from `FakePlanner`. Keep the three new
tasks valid internal `AgentTask` variants, but do not parse them in
`planSchema.ts`. Update its invalid-kind test to prove a response containing:

```json
{"reasoning":"x","plan":[{"kind":"buildFacility","facilityId":"facility-1"}]}
```

returns `ok: false`. The deterministic server, not an LLM response, owns
facility construction.

- [ ] **Step 8: Run focused and full gates**

Run:

```sh
pnpm vitest run packages/server/test/construction.test.ts packages/server/test/executor.test.ts packages/server/test/fakePlanner.test.ts packages/server/test/planSchema.test.ts
pnpm biome check packages/server/src/sim/construction.ts packages/server/src/sim/executor.ts packages/server/src/sim/fakePlanner.ts packages/server/src/llm/planSchema.ts
rg -n 'transferToFacility|buildFacility|maintainFacility' packages
git diff --check
just check && just test
```

Expected: all construction transitions and conservation tests pass, LLM plans
cannot issue privileged facility tasks, and full gates remain green.

- [ ] **Step 9: Commit Task 4**

```sh
git add packages/server/src/sim/construction.ts packages/server/src/sim/executor.ts packages/server/src/sim/fakePlanner.ts packages/server/src/llm/planSchema.ts packages/server/test/construction.test.ts packages/server/test/executor.test.ts packages/server/test/fakePlanner.test.ts packages/server/test/planSchema.test.ts
git commit -m "feat(sim): let residents build institution facilities"
```

## Task 5: Operate Granary, Market, and Ration Depot

**Commit:** `feat(sim): give institution facilities material effects`

**Files:**

- Create: `packages/server/src/sim/facilityOperation.ts`
- Create: `packages/server/test/facilityOperation.test.ts`
- Modify: `packages/shared/src/time.ts`
- Modify: `packages/shared/test/time.test.ts`
- Modify: `packages/server/src/sim/fakePlanner.ts`
- Modify: `packages/server/test/fakePlanner.test.ts`
- Modify: `packages/server/src/sim/executor.ts`
- Modify: `packages/server/test/executor.test.ts`
- Modify: `packages/server/src/sim/foodAnxiety.ts`
- Modify: `packages/server/test/foodAnxiety.test.ts`
- Modify: `packages/server/src/sim/engine.ts`
- Modify: `packages/server/test/engine.test.ts`

**Shared interfaces from `@agent-town/shared`:**

```ts
export function storedFoodTotal(world: WorldState): number;
export function accessibleFoodTotal(world: WorldState): number;
```

**Server interfaces:**

```ts
export type FoodStore =
  | { kind: "stockpile"; pos: Position }
  | { kind: "facility"; facility: Facility };

export function chooseFoodStore(world: WorldState, agent: AgentState): FoodStore | null;
export function applyMealFromStore(
  world: WorldState,
  agent: AgentState,
  store: FoodStore,
): boolean;
export function runFacilityInterval(world: WorldState): void;
export function runFacilityDay(world: WorldState): void;
export function marketHasTradeAccess(world: WorldState): boolean;
export function refreshFacilityAvailability(world: WorldState): void;
```

- [ ] **Step 1: Write failing total-food and food-days tests**

Extend `packages/shared/test/time.test.ts` with a completed active granary
holding 20 food, a blocked market holding 10, and stockpile food 5. Assert:

```ts
expect(storedFoodTotal(world)).toBe(35);
expect(accessibleFoodTotal(world)).toBe(25);
expect(foodDaysRemaining(world)).toBeCloseTo(
  25 / (world.agents.length * FOOD_PER_MEAL * (HUNGER_DECAY_PER_DAY / HUNGER_PER_MEAL)),
);
```

Move `storedFoodTotal` and `accessibleFoodTotal` to
`packages/shared/src/time.ts`, where they can inspect the strict building union
without importing server logic. Incomplete and blocked facilities remain part
of conservation totals but not accessible food.

- [ ] **Step 2: Write failing facility operation tests**

Create `packages/server/test/facilityOperation.test.ts` with separate describes:

**Granary**

```ts
runFacilityDay(world);
expect(granary.inventory.food).toBeCloseTo(
  initialFood * (1 - GRANARY_FOOD_SPOILAGE_RATE),
);
expect(granary.statsToday.foodPreserved).toBeCloseTo(
  initialFood *
    (STOCKPILE_FOOD_SPOILAGE_RATE - GRANARY_FOOD_SPOILAGE_RATE),
);
```

When `maintenanceDue > FACILITY_MAINTENANCE_PER_DAY.communalGranary`, expect
baseline spoilage, `operation: "blocked"`, and
`blockedReason: "maintenanceOverdue"`.

**Market**

- derive trade access only when a homeland polity city participates in a
  `WorldTradeRoute`;
- below three food days, subtract exactly five market wood and add exactly ten
  food;
- above seven food days, subtract at most ten market food and add four wood;
- without a route or payment resource, keep resources unchanged and expose the
  exact blocked reason;
- never run twice at the same interval tick.

**Ration depot**

- select eligible residents by hunger, health, last ration tick, then ID;
- consume `RATION_FOOD_PER_MEAL`, restore `RATION_HUNGER_PER_MEAL`, increment
  `rationStrain`, visits, and ration meal count;
- use normal meal values above the ration threshold;
- recover strain by the daily constant without going below zero.

**Conservation**

For every operation, assert:

```ts
const expectedDelta =
  gathered + imported - eaten - spoiled - exported;
expect(storedFoodTotal(world) - before).toBeCloseTo(expectedDelta);
```

**Availability**

- a complete facility unreachable from every living resident becomes
  `operation: "blocked"` with `blockedReason: "unreachable"`;
- restoring reachability reactivates it at the next interval;
- a full facility remains available for withdrawal but exposes
  `blockedReason: "full"` until space exists;
- a market without inherited trade access uses `blockedReason: "noTradeRoute"`;
- a maintained, reachable, non-market facility returns to
  `operation: "active"` and clears its reason.

- [ ] **Step 3: Write failing meal-routing and support tests**

Extend executor tests so a hungry resident walks to:

1. an active ration depot during shortage;
2. an active granary when the stockpile is empty and the reserve is releasable;
3. the stockpile when protected granary reserve must remain closed;
4. a reachable store instead of a closer blocked store.

Extend `foodAnxiety.test.ts`:

```ts
const baseline = institutionSupportForAgent(world, {
  ...agent,
  rationStrain: 0,
});
const strained = institutionSupportForAgent(world, {
  ...agent,
  rationStrain: 1,
});

expect(scoreFor(strained, "rationControl")).toBeCloseTo(
  Math.max(0, scoreFor(baseline, "rationControl") - RATION_SUPPORT_PENALTY),
);
expect(scoreFor(strained, "communalGranaryStore")).toBe(
  scoreFor(baseline, "communalGranaryStore"),
);
```

- [ ] **Step 4: Run focused tests to verify Red**

Run:

```sh
pnpm vitest run packages/shared/test/time.test.ts packages/server/test/facilityOperation.test.ts packages/server/test/executor.test.ts packages/server/test/foodAnxiety.test.ts
```

Expected: FAIL because food totals ignore facilities and operation functions do
not exist.

- [ ] **Step 5: Implement store selection and real meals**

In `facilityOperation.ts`, make `chooseFoodStore` return only reachable stores
with enough food for the applicable meal. Granary reserve is accessible only
when `foodDaysRemaining(world) < FACILITY_RESERVE_FOOD_DAYS`. Ration depots
become the preferred store below `RATION_BELOW_FOOD_DAYS`.

Refactor executor `stepEat` to use `FoodStore.pos` and then call
`applyMealFromStore`. The application function, not the client, subtracts food,
restores hunger, records facility visits/last-use tick, and applies ration
strain.

- [ ] **Step 6: Implement spoilage, maintenance, and market exchange**

`runFacilityDay` must:

1. reset every `statsToday` field;
2. apply stockpile baseline spoilage;
3. apply facility spoilage using granary protection only when maintained;
4. increment `maintenanceDue` by the configured daily amount;
5. recover ration strain;
6. leave market exchange to the interval hook.

Use:

```ts
function spoil(amount: number, rate: number): number {
  return Math.min(amount, Math.max(0, amount * rate));
}
```

Subtract the returned amount and record it. Never round resource state for
display convenience.

`runFacilityInterval` returns immediately unless:

```ts
world.tick > 0 && world.tick % MARKET_TRADE_INTERVAL_TICKS === 0
```

Track the last completed exchange in `lastTradeTick`; return without mutation
when it already equals `world.tick`. A successful market trade updates
`lastTradeTick`, `lastUsedAtTick`, inventory, and stats atomically. Resident
visits may update `lastUsedAtTick` but never `lastTradeTick`.

Call `refreshFacilityAvailability` before store selection and on every facility
interval. Resolve reasons in this precedence order:

```text
unreachable > noTradeRoute > maintenanceOverdue > full > active
```

`full` is a partial deposit block: the facility may still serve food. Store
selection treats only `unreachable`, `noTradeRoute`, and
`maintenanceOverdue` as inaccessible. A full facility therefore keeps
`operation: "active"` while carrying `blockedReason: "full"`; all three
inaccessible reasons use `operation: "blocked"`.

- [ ] **Step 7: Add facility stocking and maintenance planner work**

After construction work, `planFacilityTasks` assigns:

- overdue maintenance;
- food transfer from stockpile to a completed facility with free capacity when
  the stockpile exceeds `STOCKPILE_TARGET_FOOD * population`;
- wood transfer to an active market when it has less than
  `MARKET_IMPORT_WOOD`;
- no facility task when survival needs or construction work is pending.

Use the existing `transferToFacility` executor for completed-facility
inventories; do not add a second hauling task.

- [ ] **Step 8: Apply only ration-specific support feedback**

In `institutionSupportForAgent`, preserve the existing base score and subtract:

```ts
const strainPenalty =
  kind === "rationControl"
    ? clampUnit(agent.rationStrain) * RATION_SUPPORT_PENALTY
    : 0;
const score = clampUnit(
  institutionSupportScore(kind, culture, agent.desires) - strainPenalty,
);
```

Do not change support for the other two institutions, their affinities, or
formation streak rules.

- [ ] **Step 9: Attach interval and day hooks**

In `engine.ts`, call `runFacilityInterval(world)` after agent execution. At a
positive day boundary call `runFacilityDay(world)` before resource regrowth,
winter wood, and immigration so food-days decisions see post-spoilage stores.
Task 6 will freeze the complete ordering.

- [ ] **Step 10: Run focused and full gates**

Run:

```sh
pnpm vitest run packages/shared/test/time.test.ts packages/server/test/facilityOperation.test.ts packages/server/test/executor.test.ts packages/server/test/fakePlanner.test.ts packages/server/test/foodAnxiety.test.ts packages/server/test/engine.test.ts
pnpm biome check packages/shared/src/time.ts packages/server/src/sim/facilityOperation.ts packages/server/src/sim/executor.ts packages/server/src/sim/fakePlanner.ts packages/server/src/sim/foodAnxiety.ts packages/server/src/sim/engine.ts
rg -n 'SPOILAGE|MARKET_|RATION_|foodPreserved|rationStrain' packages/shared/src packages/server/src
git diff --check
just check && just test
```

Expected: all three facilities have a tested material effect and tested cost,
resource conservation passes, and full gates remain green.

- [ ] **Step 11: Commit Task 5**

```sh
git add packages/shared/src/time.ts packages/shared/test/time.test.ts packages/server/src/sim/facilityOperation.ts packages/server/src/sim/executor.ts packages/server/src/sim/fakePlanner.ts packages/server/src/sim/foodAnxiety.ts packages/server/src/sim/engine.ts packages/server/test/facilityOperation.test.ts packages/server/test/executor.test.ts packages/server/test/fakePlanner.test.ts packages/server/test/foodAnxiety.test.ts packages/server/test/engine.test.ts
git commit -m "feat(sim): give institution facilities material effects"
```

## Task 6: Freeze Engine Ordering and Prove the Ten-Minute Causal Loop

**Commit:** `test(sim): prove social facilities emerge on schedule`

**Files:**

- Create: `packages/server/test/socialFacilitiesIntegration.test.ts`
- Modify: `packages/server/src/sim/engine.ts`
- Modify: `packages/server/test/engine.test.ts`
- Modify: `packages/server/src/sim/traffic.ts`

**Approved tick order:**

```text
survival state / desire / support
  -> institution
  -> spatial demand / site
  -> planner
  -> executor / completed traversal
  -> facility interval
  -> tick increment
  -> positive-day hooks: spoilage, maintenance, trail decay, regrowth, winter, immigration
```

- [ ] **Step 1: Write a failing update-order test**

In `engine.test.ts`, create a world with one pre-existing majority collective,
food pressure, and no institution, then step once. Assert the same step:

1. establishes the institution;
2. creates the demand and facility before planner invocation;
3. lets the planner observe the incomplete facility;
4. records no facility effect before completion.

Use a recording `Planner` whose `plan` callback inspects
`world.spatialDemands` and `world.buildings`; do not inspect private engine
closures.

- [ ] **Step 2: Write three failing bounded integration cases**

Create `packages/server/test/socialFacilitiesIntegration.test.ts` with one
fixture per culture:

```ts
it.each([
  {
    culturalValue: "mutualAid",
    institution: "communalGranaryStore",
    facility: "communalGranary",
  },
  {
    culturalValue: "commerce",
    institution: "grainMarket",
    facility: "grainMarket",
  },
  {
    culturalValue: "order",
    institution: "rationControl",
    facility: "rationDepot",
  },
] as const)(
  "$institution completes and creates a trail before the ten-minute bound",
  ({ culturalValue, institution, facility }) => {
    const first = runScenario(culturalValue);
    const second = runScenario(culturalValue);

    expect(first.tick).toBeLessThanOrEqual(TICK_RATE * 60 * 10);
    expect(first.institutions).toContainEqual(expect.objectContaining({ kind: institution }));
    expect(first.buildings).toContainEqual(
      expect.objectContaining({ kind: facility, complete: true, operation: "active" }),
    );
    expect(first.trailCells.some(({ level }) => level === "trail" || level === "establishedTrail"))
      .toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  },
);
```

Each fixture must:

- use `generateWorld(seed)` as the base;
- give the homeland one dominant cultural value and neutralize competing
  values;
- keep food below institution pressure while preventing immediate deaths;
- give enough initial wood or nearby forest to preserve real hauling;
- add a homeland city and route for the market case;
- run the real `FakePlanner`, executor, society, facility, and traffic code;
- stop at the first tick satisfying complete facility + one facility use + one
  `trail` cell;
- assert the corresponding effect and cost: preserved food/maintenance, market
  exchange/payment, or ration meal/strain.

- [ ] **Step 3: Run integration tests to verify Red**

Run:

```sh
pnpm vitest run packages/server/test/engine.test.ts packages/server/test/socialFacilitiesIntegration.test.ts
```

Expected: FAIL until engine ordering, dirty trail ownership, and tuning satisfy
the complete loop.

- [ ] **Step 4: Refactor `createEngine` into named bounded phases**

Keep `Engine.step()` readable by extracting:

```ts
function advanceSocialState(
  world: WorldState,
  memory: SocietyMemory,
  rng: () => number,
): void {
  updateFoodSecurityDesires(world);
  advanceSociety(world, memory);
  advanceSpatialDemands(world, rng);
}

function advanceResidents(
  world: WorldState,
  planner: Planner,
  dirtyTrails: Set<number>,
): void {
  for (const agent of stableLivingAgents(world)) {
    advanceAgent(world, agent, planner, (traversal) => {
      const index = recordTraversal(world, traversal);
      if (index !== null) dirtyTrails.add(index);
    });
  }
}
```

Add `drainDirtyTrails(): number[]` to `Engine`. At a day boundary, merge every
index returned by `decayTrails` into the same dirty set.

Do not expose society memory, add I/O, or import `net/`.

- [ ] **Step 5: Tune only shared constants until the real bound passes**

Run the three-case integration suite after each change. Allowed tuning:

- `FACILITY_WOOD_COST`;
- `FACILITY_BUILD_TICKS`;
- `FACILITY_MAINTENANCE_PER_DAY`;
- `TRAIL_LEVEL_WEAR`;
- `TRAIL_PURPOSE_WEAR`;
- existing `COLLECTIVE_FORMATION_TICKS` only if all existing society boundary
  tests are updated to preserve their exact threshold assertions.

Do not seed a completed institution, inject a facility, increment wear from a
plan, grant free resources, skip travel, or run the test at a faster virtual
speed.

- [ ] **Step 6: Add invariant scans to the integration suite**

On every simulated step, assert:

```ts
expect(world.trailCells).toHaveLength(world.width * world.height);
expect(allAgentsOnWalkableTiles(world)).toBe(true);
expect(noDuplicateStableIds(world)).toBe(true);
expect(noNegativeResources(world)).toBe(true);
expect(noOverlappingBuildings(world)).toBe(true);
expect(noTrailOnBlockedTiles(world)).toBe(true);
```

Snapshot total construction wood while a facility is incomplete and total food
around each operation event. Permit only the explicit source/sink deltas from
the spec.

- [ ] **Step 7: Run performance and full gates**

Run:

```sh
time pnpm vitest run packages/server/test/socialFacilitiesIntegration.test.ts
pnpm vitest run packages/server/test/engine.test.ts packages/server/test/society.test.ts packages/server/test/facilityOperation.test.ts packages/server/test/traffic.test.ts
pnpm biome check packages/server/src/sim/engine.ts packages/server/src/sim/traffic.ts packages/server/test/engine.test.ts packages/server/test/socialFacilitiesIntegration.test.ts
rg -n 'Date\\.now|Math\\.random|from .*net/' packages/server/src/sim
git diff --check
just check && just test
```

Expected: the focused integration suite completes in CI-appropriate time, all
three scenarios finish within 6,000 ticks, forbidden-source scan is empty, and
both full gates pass.

- [ ] **Step 8: Commit Task 6**

```sh
git add packages/server/src/sim/engine.ts packages/server/src/sim/traffic.ts packages/server/test/engine.test.ts packages/server/test/socialFacilitiesIntegration.test.ts packages/shared/src/constants.ts
git commit -m "test(sim): prove social facilities emerge on schedule"
```

## Task 7: Transport Facilities, Demands, and Sparse Trail Changes

**Commit:** `feat(net): stream social facilities and trail changes`

**Files:**

- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/test/protocol.test.ts`
- Modify: `packages/server/src/net/wsServer.ts`
- Modify: `packages/server/test/wsServer.test.ts`
- Modify: `packages/client/src/net/wsClient.ts`
- Modify: `packages/client/test/wsClient.test.ts`

**Update contract:**

```ts
export type ServerMessage =
  | { type: "welcome"; state: WorldState }
  | {
      type: "update";
      tick: number;
      agents: AgentState[];
      stockpile: { pos: Position; wood: number; food: number };
      buildings: WorldState["buildings"];
      deaths: WorldState["deaths"];
      collectives: WorldState["collectives"];
      institutions: WorldState["institutions"];
      spatialDemands: WorldState["spatialDemands"];
      changedTiles: { index: number; tile: Tile }[];
      changedTrailCells: { index: number; cell: TrailCell }[];
    };
```

Full facilities travel in `buildings` because that array is already replaced
authoritatively every update. Demands remain small and travel as a full array.
Only trail cells are sparse.

- [ ] **Step 1: Write failing shared round-trip tests**

Extend `packages/shared/test/protocol.test.ts` so its welcome fixture contains
one demand, one incomplete granary, and a full trail grid. Its update contains:

```ts
spatialDemands: [demand],
changedTrailCells: [
  {
    index: 1,
    cell: {
      ...emptyTrail,
      wear: TRAIL_LEVEL_WEAR.trail,
      level: "trail",
      passagesToday: 8,
      dominantPurpose: "facilityService",
      causedByFacilityIds: ["facility-institution-1"],
      lastUsedAtTick: 200,
    },
  },
],
```

Assert exact encode/decode equality. Add rejection tests for updates missing
`spatialDemands` or `changedTrailCells`.

- [ ] **Step 2: Write failing server update tests**

Extend `wsServer.test.ts`:

```ts
const first = createUpdateMessage(engine);
const second = createUpdateMessage(engine);

expect(first.type === "update" ? first.changedTrailCells : []).toEqual([
  { index: changedIndex, cell: engine.world.trailCells[changedIndex] },
]);
expect(second.type === "update" ? second.changedTrailCells : []).toEqual([]);
```

Also assert demands are present, facilities remain in buildings, and update
still excludes `history` and `worldMap`.

- [ ] **Step 3: Write failing client sparse-application tests**

Extend `wsClient.test.ts` with a two-cell trail grid. After one update, assert:

```ts
expect(updatedState.trailCells[0]).toBe(welcomedState.trailCells[0]);
expect(updatedState.trailCells[1]).toEqual(changedCell);
expect(updatedState.spatialDemands).toBe(message.spatialDemands);
expect(updatedState.history).toBe(welcomedState.history);
```

An empty `changedTrailCells` array must preserve the previous trail array
reference so `main.ts` can avoid unnecessary rendering.

- [ ] **Step 4: Run focused tests to verify Red**

Run:

```sh
pnpm vitest run packages/shared/test/protocol.test.ts packages/server/test/wsServer.test.ts packages/client/test/wsClient.test.ts
```

Expected: FAIL because the new required update keys are absent.

- [ ] **Step 5: Implement strict protocol and server drainage**

Add `spatialDemands` and `changedTrailCells` to the update type and
`hasRequiredKeys`. In `createUpdateMessage`:

```ts
const changedTrailCells = engine.drainDirtyTrails().map((index) => {
  const cell = engine.world.trailCells[index];
  if (cell === undefined) throw new Error(`dirty trail index out of bounds: ${index}`);
  return { index, cell };
});
```

Return both required fields. Do not serialize history on updates.

- [ ] **Step 6: Apply sparse cells in the client**

In `applyUpdate`:

```ts
const trailCells =
  message.changedTrailCells.length === 0 ? state.trailCells : [...state.trailCells];
for (const change of message.changedTrailCells) {
  trailCells[change.index] = change.cell;
}
```

Return authoritative `spatialDemands` and `trailCells` beside the existing
fields. Reject out-of-range cell indexes only at decode/server invariant tests;
do not silently grow the client array.

- [ ] **Step 7: Run focused and full gates**

Run:

```sh
pnpm vitest run packages/shared/test/protocol.test.ts packages/server/test/wsServer.test.ts packages/client/test/wsClient.test.ts
pnpm biome check packages/shared/src/protocol.ts packages/server/src/net/wsServer.ts packages/client/src/net/wsClient.ts packages/shared/test/protocol.test.ts packages/server/test/wsServer.test.ts packages/client/test/wsClient.test.ts
rg -n 'spatialDemands|changedTrailCells' packages/shared/src packages/server/src packages/client/src
git diff --check
just check && just test
```

Expected: strict decoding, single-drain server updates, sparse client identity,
and all full gates pass.

- [ ] **Step 8: Commit Task 7**

```sh
git add packages/shared/src/protocol.ts packages/shared/test/protocol.test.ts packages/server/src/net/wsServer.ts packages/server/test/wsServer.test.ts packages/client/src/net/wsClient.ts packages/client/test/wsClient.test.ts
git commit -m "feat(net): stream social facilities and trail changes"
```

## Task 8: Render Distinct Facilities and Emergent Trails

**Commit:** `feat(client): render social facilities and trails`

**Files:**

- Create: `packages/client/src/render/trailLayer.ts`
- Create: `packages/client/test/trailLayer.test.ts`
- Create: `packages/client/test/structureLayer.test.ts`
- Modify: `packages/client/src/render/structureLayer.ts`
- Modify: `packages/client/src/render/sprites.ts`
- Modify: `packages/client/test/sprites.test.ts`
- Modify: `packages/client/src/main.ts`

**Pure presentation contracts:**

```ts
export interface TrailVisual {
  color: number;
  alpha: number;
  width: number;
}

export function trailVisual(level: Exclude<TrailLevel, "none">): TrailVisual;

export interface FacilityVisual {
  bodyColor: number;
  roofColor: number;
  emblem: "grain" | "awning" | "scales";
}

export function facilityVisual(kind: FacilityKind): FacilityVisual;
```

- [ ] **Step 1: Write failing pure visual tests**

Create `trailLayer.test.ts`:

```ts
expect(trailVisual("trace")).toEqual({
  color: TRAIL_COLORS.trace,
  alpha: 0.45,
  width: 4,
});
expect(trailVisual("trail")).toEqual({
  color: TRAIL_COLORS.trail,
  alpha: 0.72,
  width: 7,
});
expect(trailVisual("establishedTrail")).toEqual({
  color: TRAIL_COLORS.establishedTrail,
  alpha: 0.9,
  width: 10,
});
```

Create `structureLayer.test.ts` and assert the three exact colors/emblems, that
houses keep the existing sprite path, and incomplete buildings receive
`CONSTRUCTION_ALPHA`.

- [ ] **Step 2: Run pure client tests to verify Red**

Run:

```sh
pnpm vitest run packages/client/test/trailLayer.test.ts packages/client/test/structureLayer.test.ts
```

Expected: FAIL because the trail module and facility visual mapping do not
exist.

- [ ] **Step 3: Implement a ground-level trail layer**

Create `trailLayer.ts`. `renderTrailLayer` must clear only children labelled
`trail-object`, iterate row-major, skip `none`, water, rock, and building
positions, then draw one centered rounded segment per visible cell:

```ts
graphic
  .roundRect(
    x + (TILE_SIZE - visual.width) / 2,
    y,
    visual.width,
    TILE_SIZE,
    visual.width / 2,
  )
  .fill({ color: visual.color, alpha: visual.alpha });
```

Add small horizontal joins when an adjacent visible trail exists so the result
does not look like disconnected dots. Rendering reads state only.

- [ ] **Step 4: Render facilities without new assets**

Change `renderStructureLayer` to accept `Building[]`. Keep the existing house
sprite. Render each facility with PixiJS `Graphics`:

- communal granary: ochre body, dark pitched roof, three grain dots;
- grain market: rust awning with three alternating canopy stripes;
- ration depot: slate rectangular body with a centered balance-bar emblem.

Use one-tile bounds, `objectDepth(y, "facility")`, and the same construction
alpha for all incomplete buildings. Add `"facility"` between house and
landmark in `WorldObjectKind` depth.

Do not recolor the house sprite, fetch images, introduce filters, or animate
idle buildings.

- [ ] **Step 5: Insert the layer at the correct depth**

In `main.ts`, create:

```ts
const trailLayer = new Container();
```

Add it after the base ground layer and before resources/structures. Track
`trailsDirty` separately:

```ts
trailsDirty = trailsDirty || next.trailCells !== state.trailCells;
```

Render:

```ts
if (trailsDirty) {
  renderTrailLayer(trailLayer, currentState);
  trailsDirty = false;
}
```

Full welcome replacement marks it dirty. Facility changes continue through the
existing `structuresDirty` identity comparison.

- [ ] **Step 6: Extend depth and lifecycle tests**

Update `sprites.test.ts` to prove:

```ts
expect(objectDepth(4, "house")).toBeLessThan(objectDepth(4, "facility"));
expect(objectDepth(4, "facility")).toBeLessThan(objectDepth(4, "landmark"));
expect(objectDepth(4, "agent")).toBeLessThan(objectDepth(5, "resource"));
```

Use mocked PixiJS containers in the two new tests to verify rerendering destroys
only its own labelled children and does not remove map resources, history
objects, agents, or death markers.

- [ ] **Step 7: Run focused tests, build, and full gates**

Run:

```sh
pnpm vitest run packages/client/test/trailLayer.test.ts packages/client/test/structureLayer.test.ts packages/client/test/sprites.test.ts
pnpm --filter @agent-town/client build
pnpm biome check packages/client/src/render/trailLayer.ts packages/client/src/render/structureLayer.ts packages/client/src/render/sprites.ts packages/client/src/main.ts packages/client/test/trailLayer.test.ts packages/client/test/structureLayer.test.ts packages/client/test/sprites.test.ts
rg -n 'FACILITY_COLORS|TRAIL_COLORS|trail-object|facility' packages/client/src/render packages/client/test
git diff --check
just check && just test
```

Expected: distinct pure visual mappings, clean layer ownership, a successful
Vite build, and all gates pass.

- [ ] **Step 8: Commit Task 8**

```sh
git add packages/client/src/render/trailLayer.ts packages/client/src/render/structureLayer.ts packages/client/src/render/sprites.ts packages/client/src/main.ts packages/client/test/trailLayer.test.ts packages/client/test/structureLayer.test.ts packages/client/test/sprites.test.ts
git commit -m "feat(client): render social facilities and trails"
```

## Task 9: Expose the Full Causal Chain in Japanese

**Commit:** `feat(client): explain facilities and trail causes`

**Files:**

- Create: `packages/client/src/ui/spatialViewModel.ts`
- Create: `packages/client/test/spatialViewModel.test.ts`
- Modify: `packages/client/src/ui/infoBubble.ts`
- Modify: `packages/client/test/infoBubble.test.ts`
- Modify: `packages/client/src/ui/inspectPanel.ts`
- Modify: `packages/client/test/inspectPanel.test.ts`
- Modify: `packages/client/src/ui/societyViewModel.ts`
- Modify: `packages/client/test/societyViewModel.test.ts`
- Modify: `packages/client/src/main.ts`
- Modify: `packages/client/index.html`

**Selection contract:**

```ts
export type InspectTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "facility"; facilityId: string }
  | { kind: "trail"; tileIndex: number };

export type InspectPanelViewModel =
  | AgentInspectPanelViewModel
  | FacilityInspectPanelViewModel
  | TrailInspectPanelViewModel;
```

**Spatial milestone kinds:**

```ts
export type SpatialMilestoneKind =
  | "demand"
  | "construction"
  | "facility"
  | "blocked"
  | "trail";
```

- [ ] **Step 1: Write failing facility and trail view-model tests**

Create `spatialViewModel.test.ts`. Build one completed granary linked to an
institution and demand. Assert:

```ts
expect(buildFacilityViewModel(world, granary.id)).toEqual(
  expect.objectContaining({
    name: "共同穀倉",
    status: "稼働中",
    inventory: "食料34 / 120",
    foundedBy: "共同備蓄",
    supporters: ["トネリコ", "シラカバ"],
    siteReasons: expect.arrayContaining([
      expect.stringContaining("食料採集地"),
      expect.stringContaining("開拓時備蓄"),
    ]),
    effects: expect.arrayContaining([expect.stringContaining("腐敗を防いだ")]),
    costs: expect.arrayContaining([expect.stringContaining("維持労働")]),
  }),
);
```

For one trail cell assert Japanese level, today's passages, dominant purpose,
linked facility names, speed change, and last-use day. Missing referenced IDs
must produce `不明` labels without throwing or exposing raw IDs.

- [ ] **Step 2: Write failing milestone tests**

Extend or create schedule tests that compare previous/next state and emit each
event once:

```ts
expect(schedule.events.map(({ text }) => text)).toEqual([
  "施設需要：共同穀倉の建設地を探し始めた",
  "着工：共同穀倉へ木材が届いた",
  "完成：共同穀倉が稼働を始めた",
  "小道形成：共同穀倉への往来が地面に刻まれた",
]);
```

Blocked states use:

```text
建設停滞：共同穀倉を建てられる土地がない
運用停止：穀物市場につながる交易路がない
```

Do not emit per-step, per-meal, daily spoilage, or repeated trail-level events.

- [ ] **Step 3: Write failing hit-target and inspect tests**

Extend `InfoBubbleTarget` and priority tests so:

```text
agent > tombstone > facility > house > landmark > stockpile > resource > trail > terrain
```

Clicking a facility returns a compact bubble with its Japanese name, status,
inventory, and an `InspectTarget`. Clicking a visible trail tile returns its
level and passage count. A `none` trail does not displace terrain.

Refactor inspect tests to call:

```ts
controller.show({ kind: "facility", facilityId: granary.id }, world);
controller.show({ kind: "trail", tileIndex: 3 }, world);
controller.show({ kind: "agent", agentId: "agent-1" }, world);
```

Assert headings and causal content, close behavior, missing targets, and the
agent panel's existing provider/survival/society content.

- [ ] **Step 4: Run focused UI tests to verify Red**

Run:

```sh
pnpm vitest run packages/client/test/spatialViewModel.test.ts packages/client/test/infoBubble.test.ts packages/client/test/inspectPanel.test.ts packages/client/test/societyViewModel.test.ts
```

Expected: FAIL because spatial view models and generic inspection do not exist.

- [ ] **Step 5: Implement pure Japanese spatial view models**

Create `spatialViewModel.ts` with fixed label tables:

```ts
const SITE_FACTOR_LABELS = {
  foodAccess: "食料採集地への近さ",
  residentAccess: "住民の暮らしへの近さ",
  stockpileAccess: "開拓時備蓄への近さ",
  existingTraffic: "既存の往来",
  settlementEdgeAccess: "集落入口への近さ",
  openSpace: "周囲の空地",
  accessEquality: "住民間の到達しやすさ",
} as const satisfies Readonly<Record<SiteFactor, string>>;

const PURPOSE_LABELS = {
  survival: "生存",
  gathering: "採集",
  construction: "建設",
  facilityService: "施設利用",
  wandering: "徘徊",
} as const satisfies Readonly<Record<MovementPurpose, string>>;

const TRAIL_LEVEL_LABELS = {
  none: "草地",
  trace: "踏み跡",
  trail: "小道",
  establishedTrail: "定着した小道",
} as const satisfies Readonly<Record<TrailLevel, string>>;
```

Format values from authoritative numeric state. Do not infer effects from
facility kind when recorded daily stats or operation state disagree.

- [ ] **Step 6: Generalize the existing panel without a second root**

Keep the existing `#inspect-panel`. Refactor its controller:

```ts
export interface InspectPanelController {
  show(target: InspectTarget, world: WorldState): void;
  close(): void;
}
```

Resolve the target into the tagged view-model union, then render one header and
close button with variant-specific sections. The facility panel includes:

- institution and supporters/opponents;
- status and block reason;
- inventory/capacity;
- construction wood/labor;
- site reasons;
- today's effects, costs, visits, and maintenance;
- provenance event titles and proposer names;
- linked trail count.

The trail panel includes level, wear, passages, purpose, linked facilities,
movement reduction, and last use. The agent panel adds `配給疲弊` but otherwise
retains its current ordering and provider badge.

- [ ] **Step 7: Wire info bubbles and stable selection**

Replace `selectedAgentId` in `main.ts` with:

```ts
let selectedInspectTarget: InspectTarget | null = null;
```

`syncInspectPanel` re-renders the current target after each authoritative
update and closes only when its target no longer exists. Agent hover remains
agent-only. Bubble activation passes the target union to the same panel.

Do not close a selected facility panel when its inventory changes; update it in
place from the next state.

- [ ] **Step 8: Add spatial milestones to the existing ticker queue**

Create `createSpatialMilestoneSchedule` and
`updateSpatialMilestoneSchedule` beside the view models. Merge the current
social and spatial queues by `visibleFromTick`, then stable milestone kind/ID.
Keep the existing death fallback. The ticker displays one message at a time and
never drops an already-visible message when an update arrives.

- [ ] **Step 9: Add an accessible traffic overlay toggle**

In `packages/client/index.html`, add:

```html
<button
  id="traffic-overlay-toggle"
  class="traffic-overlay-toggle"
  type="button"
  aria-pressed="false"
>
  通行量を表示
</button>
```

Use the existing peat/parchment/verdigris palette, a 44 px minimum target,
safe-area offsets, focus-visible outline, and mobile placement above the ticker.

In `main.ts`, toggle a local presentation-only boolean and set
`trailsDirty = true`. `renderTrailLayer` receives that boolean; when true it
increases alpha in proportion to `wear / TRAIL_LEVEL_WEAR.establishedTrail`
without altering simulation state.

- [ ] **Step 10: Run focused tests, build, and full gates**

Run:

```sh
pnpm vitest run packages/client/test/spatialViewModel.test.ts packages/client/test/infoBubble.test.ts packages/client/test/inspectPanel.test.ts packages/client/test/societyViewModel.test.ts
pnpm --filter @agent-town/client build
pnpm biome check packages/client/src/ui/spatialViewModel.ts packages/client/src/ui/infoBubble.ts packages/client/src/ui/inspectPanel.ts packages/client/src/ui/societyViewModel.ts packages/client/src/main.ts packages/client/test
rg -n '共同穀倉|穀物市場|配給所|踏み跡|小道|通行量|配給疲弊' packages/client/src packages/client/test packages/client/index.html
git diff --check
just check && just test
```

Expected: all causal strings have tested Japanese owners, the client build
passes, inspection remains accessible, and all full gates pass.

- [ ] **Step 11: Commit Task 9**

```sh
git add packages/client/src/ui/spatialViewModel.ts packages/client/src/ui/infoBubble.ts packages/client/src/ui/inspectPanel.ts packages/client/src/ui/societyViewModel.ts packages/client/src/main.ts packages/client/index.html packages/client/test/spatialViewModel.test.ts packages/client/test/infoBubble.test.ts packages/client/test/inspectPanel.test.ts packages/client/test/societyViewModel.test.ts
git commit -m "feat(client): explain facilities and trail causes"
```

## Task 10: Polish, Remove AI Slop, and Verify the Public Build

**Commit when changed:** `refactor: polish social facilities slice`

**Files:**

- Review: every file changed since `8cc5696`
- Modify: only files with concrete findings from the required passes
- Verify: public preview at `https://agent-town.toarupen.org`

- [ ] **Step 1: Establish a clean functional baseline**

Run:

```sh
just check
just test
pnpm --filter @agent-town/client build
git diff --check
git status --short
```

Expected: checks, all tests, and build pass before cleanup; only intentional
task changes exist.

- [ ] **Step 2: Run `polishment` first**

Invoke the repository `polishment` skill exactly as requested by the owner.
Limit the pass to the diff since `8cc5696`. Inspect:

- causal readability in the live game;
- visual hierarchy among houses, facilities, trails, residents, and landmarks;
- keyboard/touch/focus behavior;
- Japanese labels and empty/blocked states;
- duplicated rules, overgrown functions, and avoidable rerenders.

For every accepted finding, add or adjust a failing test when behavior changes,
make the smallest fix, and rerun the focused test. Do not add features outside
this spec.

- [ ] **Step 3: Run `ai-slop-cleaner` second**

Invoke the repository `ai-slop-cleaner` skill on the resulting working code,
again limited to the diff since `8cc5696`. Remove only concrete defects such as:

- comments that narrate obvious code;
- redundant helpers or wrappers;
- repeated defensive branches already guaranteed by strict contracts;
- generic names hiding domain meaning;
- duplicated literals that belong in shared constants;
- tests that assert implementation noise instead of behavior.

Do not collapse the focused simulation modules back into `engine.ts`,
`executor.ts`, or `main.ts`. Preserve every approved invariant and all tests.

- [ ] **Step 4: Re-run focused and full verification after both passes**

Run:

```sh
pnpm vitest run packages/server/test/socialFacilitiesIntegration.test.ts packages/server/test/facilityOperation.test.ts packages/server/test/traffic.test.ts packages/client/test/spatialViewModel.test.ts packages/client/test/infoBubble.test.ts packages/client/test/inspectPanel.test.ts
just check
just test
pnpm --filter @agent-town/client build
rg -n 'Date\\.now|Math\\.random|from .*net/' packages/server/src/sim
rg -n 'FACILITY_|TRAIL_|MARKET_|RATION_' packages/server/src packages/client/src packages/shared/src
git diff --check
```

Expected: all focused suites and full gates pass; sim forbidden-source scan is
empty; tuning constants have one shared owner; no whitespace errors exist.

- [ ] **Step 5: Commit cleanup only when it changed tracked files**

If the two passes changed files:

```sh
git add packages/shared packages/server packages/client
git commit -m "refactor: polish social facilities slice"
```

If they found no concrete change, record that result in the execution notes and
do not create an empty commit.

- [ ] **Step 6: Start a non-LLM public preview safely**

Use the `stale-process-cleanup` skill before process management. Resolve exact
existing `just serve`, server, Vite, and tunnel processes with read-only checks.
Stop only the superseded non-LLM game server; do not stop the Cloudflare tunnel
and do not start `just serve-llm`.

Run the completed branch with:

```sh
just serve
```

Expected: the built client and server listen on the existing configured port,
the Cloudflare tunnel continues to route the public domain, and no `claude`,
`codex`, or LLM planner child process appears.

- [ ] **Step 7: Verify the live causal loop and responsive UI**

Use a browser at desktop `1440 × 900` and mobile `390 × 844`. Verify:

1. the current game loads with no console or WebSocket errors;
2. a food institution forms without player input;
3. the matching facility chooses a site and visibly receives wood;
4. construction completion changes its appearance and operation state;
5. residents visit the facility and a repeated route becomes a trail before
   the ten-minute bound;
6. the facility panel explains problem, supporters, site, cost, effect, and
   related path;
7. the trail panel explains traffic, purpose, facility cause, and speed;
8. the traffic overlay toggles with mouse, keyboard, and touch;
9. world map, chronicle, agent inspection, survival HUD, and death markers
   still work;
10. server process inspection confirms LLM planning remains disabled.

Then verify:

```sh
curl --fail --silent --show-error https://agent-town.toarupen.org >/dev/null
just check
just test
git status --short --branch
```

Expected: public HTTP succeeds, all gates remain green, and the worktree is
clean.

## Completion Criteria

- Every established food institution produces exactly one causal demand and
  one corresponding facility.
- Wood is physically removed, carried, delivered, and worked without
  duplication.
- Granary, market, and ration depot alter real resource/resident state and have
  tested costs.
- Actual completed resident steps are the only source of traffic wear.
- Trails grow, decay, affect movement time and A* choice, and retain bounded
  causal links.
- The same seed and fixture produce deeply identical important state.
- All three real scenarios complete facility + use + trail within 6,000 ticks.
- Welcome/update protocol, client sparse application, PixiJS rendering,
  inspect panels, ticker, keyboard/touch, and responsive layout are tested.
- `polishment` runs before `ai-slop-cleaner`.
- `just check`, `just test`, client build, public HTTP, and non-LLM process
  verification all pass.

## Task List

1. Add strict shared spatial contracts.
2. Generate one demand and select one causal site.
3. Record real traffic and make trails affect paths.
4. Haul real wood and construct facilities.
5. Operate granary, market, and ration depot.
6. Freeze engine ordering and prove the ten-minute causal loop.
7. Transport facilities, demands, and sparse trail changes.
8. Render distinct facilities and emergent trails.
9. Expose the full causal chain in Japanese.
10. Polish, remove AI slop, and verify the public build.
