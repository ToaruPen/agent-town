import {
  type AgentState,
  CARRY_CAPACITY,
  FACILITY_BUILD_TICKS,
  FACILITY_FOOD_CAPACITY,
  FACILITY_WOOD_COST,
  type Facility,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  applyFacilityBuild,
  applyFacilityMaintenance,
  deliverFacilityTransfer,
  facilityWoodRemaining,
  findFacility,
  planFacilityTasks,
  withdrawFacilityTransfer,
} from "../src/sim/construction.js";
import { createTrailCells } from "../src/sim/traffic.js";
import { makeDemandFixture, makeFacilityFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

interface SiteOptions {
  stockpileWood?: number;
  stockpileFood?: number;
  facilityKind?: Facility["kind"];
}

function createSite(options: SiteOptions = {}): { world: WorldState; facility: Facility } {
  const facility = makeFacilityFixture(options.facilityKind);
  const world: WorldState = {
    tick: 0,
    width: 4,
    height: 1,
    tiles: Array.from({ length: 4 }, () => ({ terrain: "plains" as const, resource: null })),
    agents: [],
    stockpile: {
      pos: { x: 0, y: 0 },
      wood: options.stockpileWood ?? 10,
      food: options.stockpileFood ?? 0,
    },
    buildings: [facility],
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [makeDemandFixture(options.facilityKind)],
    trailCells: createTrailCells(4, 1),
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
      worldMap: makeWorldMapFixture(),
    },
  };
  return { world, facility };
}

function createAgent(): AgentState {
  return {
    id: "agent-1",
    name: "トネリコ",
    pos: { x: 1, y: 0 },
    carrying: null,
    activity: { kind: "idle" },
    tasks: [],
    planSource: "fake",
    llmProvider: null,
    thinking: false,
    lastThought: null,
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
    rationStrain: 0,
    lastRationTick: null,
  };
}

/** Every plank in the system, so a transfer can be proven to neither lose nor mint wood. */
function totalConstructionWood(world: WorldState, facility: Facility, carried: number): number {
  return world.stockpile.wood + facility.woodDelivered + facility.inventory.wood + carried;
}

function completeWoodDelivery(facility: Facility): void {
  facility.woodDelivered = FACILITY_WOOD_COST.communalGranary;
}

describe("findFacility", () => {
  it("finds a facility by id and ignores houses", () => {
    const { world, facility } = createSite();
    world.buildings.push({ kind: "house", pos: { x: 3, y: 0 }, progress: 1, complete: true });

    expect(findFacility(world, facility.id)).toBe(facility);
    expect(findFacility(world, "facility-missing")).toBeNull();
  });
});

describe("facility wood transfers", () => {
  it("moves exactly one carry load from the stockpile into the site", () => {
    const { world, facility } = createSite();

    const withdrawn = withdrawFacilityTransfer(world, facility, "wood");
    expect(withdrawn).toBe(CARRY_CAPACITY);
    expect(world.stockpile.wood).toBe(5);

    const remainder = deliverFacilityTransfer(world, facility, "wood", withdrawn);
    expect(remainder).toBe(0);
    expect(facility.woodDelivered).toBe(CARRY_CAPACITY);
    expect(totalConstructionWood(world, facility, remainder)).toBe(10);
  });

  it("withdraws nothing when the stockpile is empty", () => {
    const { world, facility } = createSite({ stockpileWood: 0 });

    expect(withdrawFacilityTransfer(world, facility, "wood")).toBe(0);
    expect(world.stockpile.wood).toBe(0);
  });

  it("withdraws nothing when the site needs no more wood", () => {
    const { world, facility } = createSite();
    completeWoodDelivery(facility);

    expect(facilityWoodRemaining(world, facility)).toBe(0);
    expect(withdrawFacilityTransfer(world, facility, "wood")).toBe(0);
    expect(world.stockpile.wood).toBe(10);
  });

  it("withdraws nothing when an incomplete site is asked for food", () => {
    const { world, facility } = createSite({ stockpileFood: 20 });

    expect(withdrawFacilityTransfer(world, facility, "food")).toBe(0);
    expect(world.stockpile.food).toBe(20);
  });

  it("clamps a delivery to the remaining wood and hands back the overflow", () => {
    const { world, facility } = createSite();
    facility.woodDelivered = FACILITY_WOOD_COST.communalGranary - 2;
    const before = totalConstructionWood(world, facility, CARRY_CAPACITY);

    const remainder = deliverFacilityTransfer(world, facility, "wood", CARRY_CAPACITY);

    expect(remainder).toBe(CARRY_CAPACITY - 2);
    expect(facility.woodDelivered).toBe(FACILITY_WOOD_COST.communalGranary);
    expect(totalConstructionWood(world, facility, remainder)).toBe(before);
  });

  it("refuses food at a site that is still a building plot", () => {
    const { world, facility } = createSite();

    expect(deliverFacilityTransfer(world, facility, "food", CARRY_CAPACITY)).toBe(CARRY_CAPACITY);
    expect(facility.inventory.food).toBe(0);
  });

  it("stores food in a finished facility up to its capacity", () => {
    const { world, facility } = createSite({ stockpileFood: 500 });
    facility.complete = true;
    facility.inventory.food = FACILITY_FOOD_CAPACITY.communalGranary - 2;

    const remainder = deliverFacilityTransfer(world, facility, "food", CARRY_CAPACITY);

    expect(remainder).toBe(CARRY_CAPACITY - 2);
    expect(facility.inventory.food).toBe(FACILITY_FOOD_CAPACITY.communalGranary);
  });

  it("withdraws food for a finished facility only up to the space left", () => {
    const { world, facility } = createSite({ stockpileFood: 500 });
    facility.complete = true;
    facility.inventory.food = FACILITY_FOOD_CAPACITY.communalGranary - 2;

    expect(withdrawFacilityTransfer(world, facility, "food")).toBe(2);
    expect(world.stockpile.food).toBe(498);
  });
});

describe("applyFacilityBuild", () => {
  it("refuses to raise a frame before all the wood has arrived", () => {
    const { world, facility } = createSite();
    facility.woodDelivered = FACILITY_WOOD_COST.communalGranary - 1;

    expect(applyFacilityBuild(world, facility, 10)).toBe(false);
    expect(facility.progress).toBe(0);
    expect(world.spatialDemands[0]?.status).toBe("awaitingMaterials");
  });

  it("marks the demand as building once work starts", () => {
    const { world, facility } = createSite();
    completeWoodDelivery(facility);

    expect(applyFacilityBuild(world, facility, 4)).toBe(true);
    expect(facility.progress).toBe(4);
    expect(world.spatialDemands[0]?.status).toBe("building");
  });

  it("clamps progress at the configured labor and finishes the facility", () => {
    const { world, facility } = createSite();
    completeWoodDelivery(facility);

    expect(applyFacilityBuild(world, facility, FACILITY_BUILD_TICKS.communalGranary + 50)).toBe(
      true,
    );
    expect(facility).toMatchObject({
      progress: FACILITY_BUILD_TICKS.communalGranary,
      complete: true,
      operation: "active",
      blockedReason: null,
    });
    expect(world.spatialDemands[0]?.status).toBe("fulfilled");
  });

  it("refuses further work once the facility stands", () => {
    const { world, facility } = createSite();
    completeWoodDelivery(facility);
    applyFacilityBuild(world, facility, FACILITY_BUILD_TICKS.communalGranary);

    expect(applyFacilityBuild(world, facility, 1)).toBe(false);
    expect(facility.progress).toBe(FACILITY_BUILD_TICKS.communalGranary);
  });

  it("throws when a facility has lost its demand", () => {
    const { world, facility } = createSite();
    world.spatialDemands = [];
    completeWoodDelivery(facility);

    expect(() => applyFacilityBuild(world, facility, 1)).toThrow(facility.demandId);
  });
});

describe("applyFacilityMaintenance", () => {
  it("records only the work the facility actually needed", () => {
    const facility = makeFacilityFixture();
    facility.complete = true;
    facility.maintenanceDue = 3;

    expect(applyFacilityMaintenance(facility, 10)).toBe(3);
    expect(facility.maintenanceDue).toBe(0);
    expect(facility.statsToday.maintenanceWork).toBe(3);
  });

  it("does nothing when nothing is due", () => {
    const facility = makeFacilityFixture();
    facility.complete = true;

    expect(applyFacilityMaintenance(facility, 5)).toBe(0);
    expect(facility.maintenanceDue).toBe(0);
    expect(facility.statsToday.maintenanceWork).toBe(0);
  });
});

describe("planFacilityTasks", () => {
  it("does not move food into a blocked facility", () => {
    const { world, facility } = createSite({ stockpileFood: 100 });
    facility.complete = true;
    facility.operation = "blocked";
    facility.blockedReason = "noTradeRoute";

    expect(planFacilityTasks(world, createAgent())).toBeNull();
  });

  it("refreshes a newly completed market before choosing a stocking task", () => {
    const { world, facility } = createSite({
      stockpileFood: 100,
      facilityKind: "grainMarket",
    });
    facility.woodDelivered = FACILITY_WOOD_COST.grainMarket;
    const agent = createAgent();
    world.agents = [agent];

    applyFacilityBuild(world, facility, FACILITY_BUILD_TICKS.grainMarket);

    expect(facility.operation).toBe("active");
    expect(planFacilityTasks(world, agent)).toBeNull();
    expect(facility).toMatchObject({
      operation: "blocked",
      blockedReason: "noTradeRoute",
      inventory: { food: 0 },
    });
  });
});
