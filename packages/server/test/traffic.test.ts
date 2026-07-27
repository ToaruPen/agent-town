import {
  MOVE_TICKS_PER_TILE,
  type Terrain,
  TRAIL_DAILY_DECAY,
  TRAIL_LEVEL_WEAR,
  TRAIL_MAX_CAUSE_FACILITIES,
  TRAIL_MOVE_TICK_MULTIPLIER,
  TRAIL_PURPOSE_WEAR,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  createTrailCells,
  decayTrails,
  emptyTrailCell,
  moveTicksForTrail,
  pathCostForTrail,
  recordTraversal,
} from "../src/sim/traffic.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

function createWorld(
  width: number,
  height: number,
  terrain: Map<string, Terrain> = new Map(),
): WorldState {
  const tiles = Array.from({ length: width * height }, (_, index) => ({
    terrain: terrain.get(`${index % width},${Math.floor(index / width)}`) ?? ("plains" as Terrain),
    resource: null,
  }));

  return {
    tick: 0,
    width,
    height,
    tiles,
    agents: [],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [],
    trailCells: createTrailCells(width, height),
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
      worldMap: makeWorldMapFixture(),
    },
  } satisfies WorldState;
}

/** Walks the same cell often enough to reach the given wear. */
function wearDown(
  world: WorldState,
  index: number,
  purpose: "gathering" | "wandering",
  to: number,
) {
  const perPassage = TRAIL_PURPOSE_WEAR[purpose];
  const pos = { x: index % world.width, y: Math.floor(index / world.width) };
  const passages = Math.ceil(to / perPassage);
  for (let step = 0; step < passages; step += 1) {
    recordTraversal(world, { pos, purpose, facilityId: null });
  }
}

describe("createTrailCells", () => {
  it("returns independent cells rather than one shared object", () => {
    const cells = createTrailCells(2, 2);
    const first = cells[0];
    if (first !== undefined) first.wear = 5;

    expect(cells).toHaveLength(4);
    expect(cells[1]?.wear).toBe(0);
    expect(cells[0]?.purposeWear).not.toBe(cells[1]?.purposeWear);
  });

  it("matches a freshly created empty cell", () => {
    expect(createTrailCells(1, 1)[0]).toEqual(emptyTrailCell());
  });
});

describe("recordTraversal", () => {
  it("wears the row-major cell it was given and returns its index", () => {
    const world = createWorld(3, 2);

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
  });

  it.each([
    ["trace", TRAIL_LEVEL_WEAR.trace],
    ["trail", TRAIL_LEVEL_WEAR.trail],
    ["establishedTrail", TRAIL_LEVEL_WEAR.establishedTrail],
  ] as const)("becomes a %s exactly at its shared threshold", (level, threshold) => {
    const world = createWorld(2, 1);
    const pos = { x: 0, y: 0 };
    const passages = threshold / TRAIL_PURPOSE_WEAR.construction;

    for (let step = 0; step < passages - 1; step += 1) {
      recordTraversal(world, { pos, purpose: "construction", facilityId: null });
    }
    expect(world.trailCells[0]?.level).not.toBe(level);

    recordTraversal(world, { pos, purpose: "construction", facilityId: null });
    expect(world.trailCells[0]).toMatchObject({ wear: threshold, level, passagesToday: passages });
  });

  it("breaks a purpose tie with the fixed movement-purpose order", () => {
    const world = createWorld(2, 1);
    const pos = { x: 0, y: 0 };

    recordTraversal(world, { pos, purpose: "facilityService", facilityId: null });
    recordTraversal(world, { pos, purpose: "construction", facilityId: null });

    expect(world.trailCells[0]?.purposeWear).toMatchObject({
      construction: TRAIL_PURPOSE_WEAR.construction,
      facilityService: TRAIL_PURPOSE_WEAR.facilityService,
    });
    expect(world.trailCells[0]?.dominantPurpose).toBe("construction");
  });

  it("keeps the strongest purpose as the dominant one", () => {
    const world = createWorld(2, 1);
    const pos = { x: 0, y: 0 };

    recordTraversal(world, { pos, purpose: "wandering", facilityId: null });
    recordTraversal(world, { pos, purpose: "wandering", facilityId: null });
    recordTraversal(world, { pos, purpose: "gathering", facilityId: null });

    expect(world.trailCells[0]?.dominantPurpose).toBe("gathering");
  });

  it("ranks facility causes by contribution, then by id, and caps them", () => {
    const world = createWorld(2, 1);
    const pos = { x: 0, y: 0 };
    const record = (facilityId: string) =>
      recordTraversal(world, { pos, purpose: "facilityService", facilityId });

    record("facility-d");
    record("facility-d");
    record("facility-d");
    record("facility-c");
    record("facility-c");
    record("facility-b");
    record("facility-a");

    expect(world.trailCells[0]?.causedByFacilityIds).toHaveLength(TRAIL_MAX_CAUSE_FACILITIES);
    expect(world.trailCells[0]?.causedByFacilityIds).toEqual([
      "facility-d",
      "facility-c",
      "facility-a",
    ]);
  });

  it.each([
    ["water", { x: 1, y: 0 }],
    ["rock", { x: 2, y: 0 }],
    ["a building", { x: 0, y: 1 }],
  ])("refuses to wear %s", (_label, pos) => {
    const world = createWorld(
      3,
      2,
      new Map<string, Terrain>([
        ["1,0", "water"],
        ["2,0", "rock"],
      ]),
    );
    world.buildings.push({ kind: "house", pos: { x: 0, y: 1 }, progress: 1, complete: true });

    expect(recordTraversal(world, { pos, purpose: "survival", facilityId: null })).toBeNull();
    expect(world.trailCells.every(({ wear }) => wear === 0)).toBe(true);
  });

  it("refuses a position outside the map", () => {
    const world = createWorld(2, 2);

    expect(
      recordTraversal(world, { pos: { x: 5, y: 0 }, purpose: "survival", facilityId: null }),
    ).toBeNull();
  });
});

describe("decayTrails", () => {
  it("reduces wear, drops the level, and resets the daily passage count", () => {
    const world = createWorld(2, 1);
    wearDown(world, 0, "gathering", TRAIL_LEVEL_WEAR.establishedTrail);
    const wornWear = world.trailCells[0]?.wear ?? 0;

    const changed = decayTrails(world);

    expect(changed).toEqual([0]);
    expect(world.trailCells[0]).toMatchObject({
      wear: wornWear * TRAIL_DAILY_DECAY,
      level: "trail",
      passagesToday: 0,
    });
  });

  it("removes exhausted purpose and facility contributions", () => {
    const world = createWorld(2, 1);
    recordTraversal(world, {
      pos: { x: 0, y: 0 },
      purpose: "wandering",
      facilityId: "facility-1",
    });
    for (let day = 0; day < 400; day += 1) decayTrails(world);

    expect(world.trailCells[0]).toMatchObject({
      wear: 0,
      level: "none",
      dominantPurpose: null,
      causedByFacilityIds: [],
    });
    expect(world.trailCells[0]?.purposeWear.wandering).toBe(0);
    expect(world.trailCells[0]?.facilityWear).toEqual({});
  });

  it("reports only the cells whose public values changed", () => {
    const world = createWorld(3, 1);
    wearDown(world, 2, "gathering", TRAIL_LEVEL_WEAR.trail);

    expect(decayTrails(world)).toEqual([2]);
    expect(decayTrails(createWorld(3, 1))).toEqual([]);
  });
});

describe("trail movement costs", () => {
  it("keeps a trail and an established trail distinct at the base movement duration", () => {
    expect(moveTicksForTrail("none")).toBe(MOVE_TICKS_PER_TILE);
    expect(Math.ceil(moveTicksForTrail("trail"))).not.toBe(
      Math.ceil(moveTicksForTrail("establishedTrail")),
    );
  });

  it.each(["none", "trace", "trail", "establishedTrail"] as const)(
    "derives the %s move duration from the shared multiplier",
    (level) => {
      expect(moveTicksForTrail(level)).toBe(
        MOVE_TICKS_PER_TILE * TRAIL_MOVE_TICK_MULTIPLIER[level],
      );
    },
  );

  it("gives worn ground a strictly cheaper integer path cost", () => {
    const costs = (["none", "trace", "trail", "establishedTrail"] as const).map(pathCostForTrail);

    expect(costs).toEqual([100, 95, 80, 65]);
    expect(costs.every(Number.isInteger)).toBe(true);
  });
});
