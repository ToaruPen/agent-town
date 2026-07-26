import {
  type AgentState,
  type Building,
  type Position,
  type Terrain,
  type Tile,
  TRAIL_LEVEL_WEAR,
  type TrailCell,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { selectFacilitySite } from "../src/sim/siteSelection.js";
import { makeTrailCellsFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

interface WorldOptions {
  width: number;
  height: number;
  terrain?: Map<string, Terrain>;
  food?: Position[];
  wood?: Position[];
  agents?: Position[];
  stockpile?: Position;
  buildings?: Position[];
  wear?: Map<string, number>;
}

function makeHouse(pos: Position): Building {
  return { kind: "house", pos, progress: 1, complete: true };
}

function includes(positions: Position[], pos: Position): boolean {
  return positions.some(({ x, y }) => x === pos.x && y === pos.y);
}

function makeTile(pos: Position, options: WorldOptions): Tile {
  const terrain = options.terrain?.get(`${pos.x},${pos.y}`) ?? "plains";
  if (includes(options.food ?? [], pos)) return { terrain, resource: { kind: "food", amount: 10 } };
  if (includes(options.wood ?? [], pos)) return { terrain, resource: { kind: "wood", amount: 10 } };
  return { terrain, resource: null };
}

function makeWornTrailCells(options: WorldOptions): TrailCell[] {
  const cells = makeTrailCellsFixture(options.width, options.height);
  for (const [key, amount] of options.wear ?? new Map<string, number>()) {
    const [x = 0, y = 0] = key.split(",").map(Number);
    const cell = cells[y * options.width + x];
    if (cell !== undefined) cell.wear = amount;
  }
  return cells;
}

function makeResident(pos: Position, index: number): AgentState {
  return {
    id: `agent-${index + 1}`,
    name: `住民${index + 1}`,
    pos,
    carrying: null,
    activity: { kind: "idle" },
    tasks: [],
    planSource: "fake",
    llmProvider: null,
    thinking: false,
    lastThought: null,
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    rationStrain: 0,
    lastRationTick: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
  };
}

function createWorld(options: WorldOptions): WorldState {
  const { width, height } = options;
  const tiles = Array.from({ length: width * height }, (_, index) =>
    makeTile({ x: index % width, y: Math.floor(index / width) }, options),
  );

  return {
    tick: 0,
    width,
    height,
    tiles,
    agents: (options.agents ?? []).map(makeResident),
    stockpile: { pos: options.stockpile ?? { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: (options.buildings ?? []).map(makeHouse),
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [],
    trailCells: makeWornTrailCells(options),
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

/**
 * The canonical settlement: two residents facing each other across the
 * stockpile, berries to the west, and a worn corridor along the south edge.
 */
function createSettlement(): WorldState {
  return createWorld({
    width: 7,
    height: 5,
    terrain: new Map<string, Terrain>([
      ["0,0", "water"],
      ["6,0", "forest"],
      ["0,3", "water"],
      ["1,4", "water"],
      ["6,4", "rock"],
    ]),
    food: [{ x: 0, y: 2 }],
    wood: [{ x: 6, y: 0 }],
    agents: [
      { x: 1, y: 2 },
      { x: 5, y: 2 },
    ],
    stockpile: { x: 3, y: 2 },
    buildings: [{ x: 3, y: 0 }],
    wear: new Map([
      ["2,4", TRAIL_LEVEL_WEAR.establishedTrail],
      ["3,4", TRAIL_LEVEL_WEAR.establishedTrail],
      ["4,4", TRAIL_LEVEL_WEAR.establishedTrail],
    ]),
  });
}

describe("selectFacilitySite", () => {
  it("puts the granary between the berries and the stockpile", () => {
    const world = createSettlement();

    expect(selectFacilitySite(world, "communalGranary", () => 0)).toEqual({
      pos: { x: 2, y: 2 },
      rationale: expect.objectContaining({
        contributions: expect.arrayContaining([
          expect.objectContaining({ factor: "foodAccess" }),
          expect.objectContaining({ factor: "stockpileAccess" }),
        ]),
      }),
    });
  });

  it("weighs traffic and the settlement edge for the market", () => {
    const world = createSettlement();

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
  });

  it("weighs equal resident access for the ration depot", () => {
    const world = createSettlement();

    expect(selectFacilitySite(world, "rationDepot", () => 0)).toEqual(
      expect.objectContaining({
        rationale: expect.objectContaining({
          contributions: expect.arrayContaining([
            expect.objectContaining({ factor: "accessEquality" }),
          ]),
        }),
      }),
    );
  });

  it("scores only the factors the facility kind actually weighs", () => {
    const world = createSettlement();

    const granary = selectFacilitySite(world, "communalGranary", () => 0);
    const market = selectFacilitySite(world, "grainMarket", () => 0);

    expect(granary?.rationale.contributions.map(({ factor }) => factor)).not.toContain(
      "settlementEdgeAccess",
    );
    expect(market?.rationale.contributions.map(({ factor }) => factor)).not.toContain(
      "accessEquality",
    );
  });

  it("reports a score that is the sum of its weighted contributions", () => {
    const world = createSettlement();

    const rationale = selectFacilitySite(world, "communalGranary", () => 0)?.rationale;
    const total = rationale?.contributions.reduce(
      (sum, { weightedScore }) => sum + weightedScore,
      0,
    );

    expect(rationale?.score).toBeCloseTo(total ?? Number.NaN, 10);
  });

  it("orders contributions by descending weighted score", () => {
    const world = createSettlement();

    const rationale = selectFacilitySite(world, "rationDepot", () => 0)?.rationale;
    const weighted = rationale?.contributions.map(({ weightedScore }) => weightedScore);

    expect(weighted).toEqual([...(weighted ?? [])].sort((left, right) => right - left));
  });

  it.each([
    ["water", { x: 0, y: 0 }],
    ["rock", { x: 6, y: 4 }],
    ["a resource tile", { x: 0, y: 2 }],
    ["the stockpile", { x: 3, y: 2 }],
    ["a resident", { x: 1, y: 2 }],
    ["a building", { x: 3, y: 0 }],
    ["an unreachable cell", { x: 0, y: 4 }],
  ])("never selects %s", (_label, blocked) => {
    const world = createSettlement();

    for (const kind of ["communalGranary", "grainMarket", "rationDepot"] as const) {
      expect(selectFacilitySite(world, kind, () => 0)?.pos).not.toEqual(blocked);
    }
  });

  it("returns null when no candidate cell exists", () => {
    const world = createWorld({
      width: 2,
      height: 1,
      terrain: new Map<string, Terrain>([["1,0", "water"]]),
      stockpile: { x: 0, y: 0 },
    });

    expect(selectFacilitySite(world, "communalGranary", () => 0)).toBeNull();
  });

  it("breaks an exact tie with the injected rng over a row-major candidate list", () => {
    const tied = () =>
      createWorld({
        width: 3,
        height: 3,
        food: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
        ],
        agents: [
          { x: 1, y: 0 },
          { x: 1, y: 2 },
        ],
        stockpile: { x: 1, y: 1 },
      });

    expect(selectFacilitySite(tied(), "communalGranary", () => 0)?.pos).toEqual({ x: 0, y: 1 });
    expect(selectFacilitySite(tied(), "communalGranary", () => 0.99)?.pos).toEqual({ x: 2, y: 1 });
  });

  it("leaves the world untouched", () => {
    const world = createSettlement();
    const before = JSON.stringify(world);

    selectFacilitySite(world, "communalGranary", () => 0);

    expect(JSON.stringify(world)).toBe(before);
  });
});
