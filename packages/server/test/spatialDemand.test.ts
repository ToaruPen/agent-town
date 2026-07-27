import {
  FACILITY_BUILD_TICKS,
  FACILITY_WOOD_COST,
  type Institution,
  type InstitutionKind,
  isFacility,
  type Position,
  SPATIAL_DEMAND_RETRY_INTERVAL_TICKS,
  type Terrain,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { advanceSpatialDemands } from "../src/sim/spatialDemand.js";
import { makeWorldFixture } from "./worldFixture.js";

function createWorld(
  width: number,
  height: number,
  terrain: Map<string, Terrain> = new Map(),
  stockpile: Position = { x: 0, y: 0 },
): WorldState {
  const tiles = Array.from({ length: width * height }, (_, index) => ({
    terrain: terrain.get(`${index % width},${Math.floor(index / width)}`) ?? ("plains" as Terrain),
    resource: null,
  }));

  return makeWorldFixture({
    width,
    height,
    tiles,
    stockpile: { pos: stockpile, wood: 0, food: 0 },
  });
}

function makeInstitution(kind: InstitutionKind): Institution {
  return {
    id: `institution-${kind}-12`,
    kind,
    supporterIds: ["agent-1", "agent-2"],
    opposedIds: ["agent-3"],
    establishedAtTick: 12,
    provenance: {
      causedByEventIds: ["event-1"],
      proposedByAgentIds: ["agent-1"],
      supportedByAgentIds: ["agent-1", "agent-2"],
      opposedByAgentIds: ["agent-3"],
      decidedAtTick: 12,
    },
  };
}

/** A one-tile settlement whose only free cell is (1, 0). */
function createBlockedWorld(): WorldState {
  return createWorld(
    3,
    1,
    new Map<string, Terrain>([
      ["1,0", "water"],
      ["2,0", "water"],
    ]),
  );
}

describe("advanceSpatialDemands", () => {
  it("creates exactly one demand and one facility per institution, however often it runs", () => {
    const world = createWorld(5, 5);
    const institution = makeInstitution("communalGranaryStore");
    world.institutions.push(institution);

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
    expect(world.buildings).toHaveLength(1);
  });

  it.each([
    ["communalGranaryStore", "communalGranary"],
    ["grainMarket", "grainMarket"],
    ["rationControl", "rationDepot"],
  ] as const)("maps the %s institution to a %s", (institutionKind, facilityKind) => {
    const world = createWorld(5, 5);
    world.institutions.push(makeInstitution(institutionKind));

    advanceSpatialDemands(world, () => 0);

    expect(world.spatialDemands[0]?.facilityKind).toBe(facilityKind);
    expect(world.buildings.filter(isFacility)[0]?.kind).toBe(facilityKind);
  });

  it("places one facility per institution on distinct cells", () => {
    const world = createWorld(5, 5);
    world.institutions.push(
      makeInstitution("communalGranaryStore"),
      makeInstitution("grainMarket"),
      makeInstitution("rationControl"),
    );

    advanceSpatialDemands(world, () => 0);

    const positions = world.buildings.filter(isFacility).map(({ pos }) => `${pos.x},${pos.y}`);
    expect(positions).toHaveLength(3);
    expect(new Set(positions).size).toBe(3);
  });

  it("gives the facility a zeroed inventory and untouched usage timestamps", () => {
    const world = createWorld(5, 5);
    world.institutions.push(makeInstitution("communalGranaryStore"));

    advanceSpatialDemands(world, () => 0);

    expect(world.buildings.filter(isFacility)[0]).toMatchObject({
      progress: 0,
      inventory: { wood: 0, food: 0 },
      operation: "inactive",
      blockedReason: null,
      maintenanceDue: 0,
      lastUsedAtTick: null,
      lastTradeTick: null,
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
    });
  });

  it("copies the institution's frozen provenance instead of sharing it", () => {
    const world = createWorld(5, 5);
    const institution = makeInstitution("communalGranaryStore");
    world.institutions.push(institution);

    advanceSpatialDemands(world, () => 0);
    const demand = world.spatialDemands[0];

    expect(demand?.provenance).toEqual(institution.provenance);
    expect(demand?.provenance).not.toBe(institution.provenance);
    expect(demand?.provenance.supportedByAgentIds).not.toBe(
      institution.provenance.supportedByAgentIds,
    );
    expect(demand?.supporterIds).not.toBe(institution.supporterIds);
  });

  it("keeps one blocked demand and builds nothing when no site exists", () => {
    const world = createBlockedWorld();
    world.institutions.push(makeInstitution("communalGranaryStore"));

    advanceSpatialDemands(world, () => 0);
    advanceSpatialDemands(world, () => 0);

    expect(world.spatialDemands).toHaveLength(1);
    expect(world.spatialDemands[0]).toMatchObject({
      status: "blocked",
      blockedReason: "noValidSite",
      site: null,
      siteRationale: null,
    });
    expect(world.buildings).toHaveLength(0);
  });

  it("does not rescan a blocked demand before the retry interval", () => {
    const world = createBlockedWorld();
    world.institutions.push(makeInstitution("communalGranaryStore"));
    advanceSpatialDemands(world, () => 0);

    const openedTile = world.tiles[1];
    if (openedTile !== undefined) openedTile.terrain = "plains";
    world.tick = SPATIAL_DEMAND_RETRY_INTERVAL_TICKS - 1;
    advanceSpatialDemands(world, () => 0);

    expect(world.spatialDemands[0]).toMatchObject({ status: "blocked", site: null });
    expect(world.buildings).toHaveLength(0);
  });

  it("reuses the same demand when the retry interval reopens a site", () => {
    const world = createBlockedWorld();
    const institution = makeInstitution("communalGranaryStore");
    world.institutions.push(institution);
    advanceSpatialDemands(world, () => 0);

    const openedTile = world.tiles[1];
    if (openedTile !== undefined) openedTile.terrain = "plains";
    world.tick = SPATIAL_DEMAND_RETRY_INTERVAL_TICKS;
    advanceSpatialDemands(world, () => 0);

    expect(world.spatialDemands).toHaveLength(1);
    expect(world.spatialDemands[0]).toMatchObject({
      id: `demand-${institution.id}`,
      status: "awaitingMaterials",
      blockedReason: null,
      site: { x: 1, y: 0 },
    });
    expect(world.buildings).toHaveLength(1);
  });

  it("leaves demands alone once they have moved past site selection", () => {
    const world = createWorld(5, 5);
    world.institutions.push(makeInstitution("communalGranaryStore"));
    advanceSpatialDemands(world, () => 0);

    const demand = world.spatialDemands[0];
    if (demand !== undefined) demand.status = "building";
    world.tick = SPATIAL_DEMAND_RETRY_INTERVAL_TICKS;
    advanceSpatialDemands(world, () => 0);

    expect(world.spatialDemands[0]?.status).toBe("building");
    expect(world.buildings).toHaveLength(1);
  });
});
