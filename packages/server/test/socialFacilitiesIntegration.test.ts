import {
  CARRY_CAPACITY,
  type CulturalValue,
  FACILITY_BUILD_TICKS,
  FACILITY_FOOD_CAPACITY,
  type Facility,
  type FacilityKind,
  HOUSE_BUILD_TICKS,
  type InstitutionKind,
  isFacility,
  type Position,
  storedFoodTotal,
  TICK_RATE,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { isWalkable } from "../src/sim/astar.js";
import { createEngine } from "../src/sim/engine.js";
import { marketHasTradeAccess } from "../src/sim/facilityOperation.js";
import { FakePlanner } from "../src/sim/fakePlanner.js";
import { createRng } from "../src/sim/rng.js";
import { generateWorld } from "../src/sim/worldGen.js";

const SEED = 42;
const TEN_MINUTE_TICK_BOUND = TICK_RATE * 60 * 10;
/** Below institution pressure yet far above the four days that would end starvation. */
const SCARCE_START_FOOD = 40;
const START_WOOD = 40;
/** Full invariant sweeps walk every cell, so the costly ones run on a fixed cadence. */
const SCAN_INTERVAL_TICKS = 25;

interface Scenario {
  culturalValue: CulturalValue;
  institution: InstitutionKind;
  facility: FacilityKind;
}

function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function facilitiesOf(world: WorldState): Facility[] {
  return world.buildings.filter(isFacility);
}

function allAgentsOnWalkableTiles(world: WorldState): boolean {
  return world.agents.every(({ pos }) => isWalkable(world, pos));
}

function noDuplicateStableIds(world: WorldState): boolean {
  const ids = [
    ...world.agents.map(({ id }) => id),
    ...facilitiesOf(world).map(({ id }) => id),
    ...world.institutions.map(({ id }) => id),
    ...world.collectives.map(({ id }) => id),
    ...world.spatialDemands.map(({ id }) => id),
  ];
  return new Set(ids).size === ids.length;
}

function noNegativeResources(world: WorldState): boolean {
  if (world.stockpile.wood < 0 || world.stockpile.food < 0) return false;
  if (world.agents.some(({ carrying }) => (carrying?.amount ?? 0) < 0)) return false;
  return facilitiesOf(world).every(({ inventory }) => inventory.wood >= 0 && inventory.food >= 0);
}

function noOverlappingBuildings(world: WorldState): boolean {
  const keys = world.buildings.map(({ pos }) => `${pos.x},${pos.y}`);
  if (new Set(keys).size !== keys.length) return false;
  return !world.buildings.some(({ pos }) => positionsEqual(pos, world.stockpile.pos));
}

/** Wear only ever marks ground a resident could cross; a later building may stand on it. */
function noTrailOnBlockedTiles(world: WorldState): boolean {
  return world.trailCells.every((cell, index) => {
    if (cell.wear === 0) return true;
    return isWalkable(world, { x: index % world.width, y: Math.floor(index / world.width) });
  });
}

/** Construction wood is delivered, never conjured, and never beyond what the site asked for. */
function constructionWoodIsAccounted(world: WorldState): boolean {
  return facilitiesOf(world).every((facility) => {
    const demand = world.spatialDemands.find(({ id }) => id === facility.demandId);
    if (demand === undefined) return false;
    if (facility.woodDelivered < 0 || facility.woodDelivered > demand.requiredWood) return false;
    return facility.progress >= 0 && facility.progress <= FACILITY_BUILD_TICKS[facility.kind];
  });
}

function storedFoodIsInBounds(world: WorldState): boolean {
  return facilitiesOf(world).every(
    ({ kind, inventory }) => inventory.food <= FACILITY_FOOD_CAPACITY[kind],
  );
}

function carriedFood(world: WorldState): number {
  return world.agents.reduce(
    (total, { carrying }) => total + (carrying?.kind === "food" ? carrying.amount : 0),
    0,
  );
}

function scanCheapInvariants(world: WorldState): void {
  expect(world.trailCells).toHaveLength(world.width * world.height);
  expect(allAgentsOnWalkableTiles(world)).toBe(true);
  expect(noNegativeResources(world)).toBe(true);
  expect(noOverlappingBuildings(world)).toBe(true);
  expect(constructionWoodIsAccounted(world)).toBe(true);
  expect(storedFoodIsInBounds(world)).toBe(true);
}

function scanSampledInvariants(world: WorldState): void {
  expect(noDuplicateStableIds(world)).toBe(true);
  expect(noTrailOnBlockedTiles(world)).toBe(true);
}

/**
 * A step can hand out at most one meal and take in at most one load per resident,
 * so any wider swing in the settlement's food means it was minted or lost.
 */
function expectFoodStep(world: WorldState, before: number): void {
  const after = storedFoodTotal(world) + carriedFood(world);
  const headroom = world.agents.length * CARRY_CAPACITY;
  expect(after - before).toBeLessThanOrEqual(headroom);
  expect(before - after).toBeLessThanOrEqual(headroom);
  expect(after).toBeGreaterThanOrEqual(0);
}

/** What each institution was built to do, and what it costs the settlement to do it. */
function hasRecordedEffectAndCost(world: WorldState, facility: Facility): boolean {
  const stats = facility.statsToday;
  if (facility.kind === "communalGranary") {
    return stats.foodPreserved > 0 && stats.maintenanceWork > 0;
  }
  if (facility.kind === "grainMarket") {
    return stats.foodImported > 0 && stats.woodSpent > 0;
  }
  return stats.rationMeals > 0 && world.agents.some(({ rationStrain }) => rationStrain > 0);
}

function hasWornTrail(world: WorldState): boolean {
  return world.trailCells.some(({ level }) => level === "trail" || level === "establishedTrail");
}

function servingFacility(world: WorldState, kind: FacilityKind): Facility | undefined {
  return facilitiesOf(world).find(
    (facility) => facility.kind === kind && facility.complete && facility.operation === "active",
  );
}

function isLoopClosed(world: WorldState, kind: FacilityKind): boolean {
  const facility = servingFacility(world, kind);
  if (facility === undefined || facility.lastUsedAtTick === null) return false;
  return hasRecordedEffectAndCost(world, facility) && hasWornTrail(world);
}

/** Keeps this social scenario's one-house workload without leaving a second house in demand. */
function addRemoteCompletedHouse(world: WorldState): void {
  for (let index = world.tiles.length - 1; index >= 0; index -= 1) {
    const pos = { x: index % world.width, y: Math.floor(index / world.width) };
    const tile = world.tiles[index];
    if (tile?.resource !== null || !isWalkable(world, pos)) continue;
    if (positionsEqual(pos, world.stockpile.pos)) continue;
    if (world.agents.some((agent) => positionsEqual(agent.pos, pos))) continue;
    world.buildings.push({
      kind: "house",
      pos,
      progress: HOUSE_BUILD_TICKS,
      complete: true,
    });
    return;
  }
  throw new Error("missing remote housing site");
}

function scenarioWorld(culturalValue: CulturalValue): WorldState {
  const world = generateWorld(SEED);
  const homelandId = world.history.settlementOrigin?.homelandPolityId;
  const homeland = world.history.polities.find(({ id }) => id === homelandId);
  if (homeland === undefined) throw new Error("missing homeland polity");
  homeland.values = [{ value: culturalValue, weight: 1, changedByEventIds: [] }];
  world.tiles = world.tiles.map((tile) =>
    tile.resource?.kind === "food" ? { ...tile, resource: null } : tile,
  );
  world.stockpile.wood = START_WOOD;
  world.stockpile.food = SCARCE_START_FOOD;
  addRemoteCompletedHouse(world);
  return world;
}

function runScenario(scenario: Scenario): WorldState {
  const world = scenarioWorld(scenario.culturalValue);
  expect(marketHasTradeAccess(world)).toBe(true);
  const rng = createRng(SEED);
  const engine = createEngine(world, new FakePlanner(rng), rng);

  while (world.tick < TEN_MINUTE_TICK_BOUND) {
    const foodBefore = storedFoodTotal(world) + carriedFood(world);
    engine.step();
    scanCheapInvariants(world);
    expectFoodStep(world, foodBefore);
    if (world.tick % SCAN_INTERVAL_TICKS === 0) scanSampledInvariants(world);
    if (isLoopClosed(world, scenario.facility)) break;
  }
  scanSampledInvariants(world);
  return world;
}

const SCENARIOS = [
  {
    culturalValue: "mutualAid",
    institution: "communalGranaryStore",
    facility: "communalGranary",
  },
  { culturalValue: "commerce", institution: "grainMarket", facility: "grainMarket" },
  { culturalValue: "order", institution: "rationControl", facility: "rationDepot" },
] as const satisfies readonly Scenario[];

describe("social facilities emerge from culture under food pressure", () => {
  it.each(SCENARIOS)(
    "$institution completes, is used, and wears a trail before the ten-minute bound",
    ({ culturalValue, institution, facility }) => {
      const first = runScenario({ culturalValue, institution, facility });
      const second = runScenario({ culturalValue, institution, facility });

      expect(first.tick).toBeLessThan(TEN_MINUTE_TICK_BOUND);
      expect(first.institutions).toContainEqual(expect.objectContaining({ kind: institution }));
      expect(first.buildings).toContainEqual(
        expect.objectContaining({ kind: facility, complete: true, operation: "active" }),
      );
      expect(hasWornTrail(first)).toBe(true);
      expect(first.deaths).toEqual([]);

      const site = servingFacility(first, facility);
      if (site === undefined) throw new Error(`${facility} never opened`);
      expect(site.lastUsedAtTick).not.toBeNull();
      expect(hasRecordedEffectAndCost(first, site)).toBe(true);

      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    },
    120_000,
  );
});
