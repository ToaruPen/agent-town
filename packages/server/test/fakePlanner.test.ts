import {
  type AgentState,
  DAYS_PER_SEASON,
  dailyFoodNeed,
  FACILITY_FOOD_CAPACITY,
  FACILITY_STOCK_RESERVE_DAYS,
  FACILITY_WOOD_COST,
  FATIGUE_REST_THRESHOLD,
  type Facility,
  FOOD_PER_MEAL,
  foodDaysRemaining,
  HOUSE_BUILD_TICKS,
  HOUSE_WOOD_COST,
  HUNGER_EAT_THRESHOLD,
  RATION_BELOW_FOOD_DAYS,
  STOCKPILE_TARGET_FOOD,
  STOCKPILE_TARGET_WOOD,
  type Tile,
  WOOD_BURN_PER_AGENT_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { FakePlanner, woodTarget } from "../src/sim/fakePlanner.js";
import { makeDemandFixture, makeFacilityFixture, makeTrailCellsFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

function createAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "agent-1",
    name: "トネリコ",
    pos: { x: 0, y: 0 },
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
    ...overrides,
  };
}

function createWorld(agent: AgentState, tiles: Tile[]): WorldState {
  return {
    tick: 0,
    width: tiles.length,
    height: 1,
    tiles,
    agents: [agent],
    stockpile: { pos: { x: tiles.length - 1, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [],
    trailCells: makeTrailCellsFixture(tiles.length, 1),
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
}

describe("FakePlanner", () => {
  it("plans to eat when the agent is hungry", () => {
    const agent = createAgent({ hunger: HUNGER_EAT_THRESHOLD - 1 });
    const world = createWorld(agent, [{ terrain: "plains", resource: null }]);

    const tasks = new FakePlanner(() => 0).plan(world, agent);

    expect(tasks).toEqual([{ kind: "eat" }]);
  });

  it("assigns moveTo and gather for the nearest wood when the stockpile is empty", () => {
    const agent = createAgent();
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "forest", resource: { kind: "wood", amount: 20 } },
      { terrain: "plains", resource: null },
    ]);

    const tasks = new FakePlanner(() => 0).plan(world, agent);

    expect(tasks).toEqual([
      { kind: "moveTo", dest: { x: 1, y: 0 } },
      { kind: "gather", resource: "wood", target: { x: 1, y: 0 } },
    ]);
  });

  it("assigns moveTo stockpile and deposit when carrying", () => {
    const agent = createAgent({ carrying: { kind: "wood", amount: 5 } });
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
    ]);

    const tasks = new FakePlanner(() => 0).plan(world, agent);

    expect(tasks).toEqual([{ kind: "moveTo", dest: world.stockpile.pos }, { kind: "deposit" }]);
  });

  it("prioritizes depositing carried food over eating when hungry", () => {
    const agent = createAgent({
      carrying: { kind: "food", amount: FOOD_PER_MEAL },
      hunger: HUNGER_EAT_THRESHOLD - 1,
    });
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
    ]);

    const tasks = new FakePlanner(() => 0).plan(world, agent);

    expect(tasks).toEqual([{ kind: "moveTo", dest: world.stockpile.pos }, { kind: "deposit" }]);
  });

  it("scales the food stockpile target with the current population", () => {
    const agent = createAgent();
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: { kind: "food", amount: 10 } },
    ]);
    world.agents.push(createAgent({ id: "agent-2", name: "シラカバ" }));
    world.stockpile.wood = STOCKPILE_TARGET_WOOD;
    world.stockpile.food = STOCKPILE_TARGET_FOOD;

    const tasks = new FakePlanner(() => 0).plan(world, agent);

    expect(tasks).toEqual([
      { kind: "moveTo", dest: { x: 1, y: 0 } },
      { kind: "gather", resource: "food", target: { x: 1, y: 0 } },
    ]);
  });

  it("gathers wood only below the full-winter reserve when housing capacity is free", () => {
    const agent = createAgent();
    const woodTile = { x: 1, y: 0 };
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "forest", resource: { kind: "wood", amount: 10 } },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
    ]);
    world.agents.push(createAgent({ id: "agent-2", name: "シラカバ" }));
    world.buildings = [
      { kind: "house", pos: { x: 2, y: 0 }, progress: HOUSE_BUILD_TICKS, complete: true },
      { kind: "house", pos: { x: 3, y: 0 }, progress: HOUSE_BUILD_TICKS, complete: true },
    ];
    world.stockpile.food = STOCKPILE_TARGET_FOOD * world.agents.length;
    const winterReserve = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;
    const planner = new FakePlanner(() => 0);
    expect(woodTarget(world, winterReserve)).toBe(winterReserve);

    world.stockpile.wood = winterReserve - 1;
    expect(planner.plan(world, agent)).toEqual([
      { kind: "moveTo", dest: woodTile },
      { kind: "gather", resource: "wood", target: woodTile },
    ]);

    world.stockpile.wood = winterReserve;
    expect(planner.plan(world, agent)).not.toContainEqual({
      kind: "gather",
      resource: "wood",
      target: woodTile,
    });
  });

  it("uses one house-demand wood target for both gathering and construction", () => {
    const agent = createAgent();
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "forest", resource: { kind: "wood", amount: 10 } },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
    ]);
    world.stockpile.food = STOCKPILE_TARGET_FOOD;
    const winterReserve = WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;
    const target = woodTarget(world, winterReserve);
    const planner = new FakePlanner(() => 0);
    expect(target).toBe(winterReserve + HOUSE_WOOD_COST);

    world.stockpile.wood = target - 1;
    expect(planner.plan(world, agent)).toEqual([
      { kind: "moveTo", dest: { x: 1, y: 0 } },
      { kind: "gather", resource: "wood", target: { x: 1, y: 0 } },
    ]);

    world.stockpile.wood = target;
    expect(planner.plan(world, agent)).toEqual([{ kind: "build", pos: { x: 2, y: 0 } }]);
  });

  it("rests after carrying and hunger priorities when fatigue is below threshold", () => {
    const agent = createAgent({ fatigue: FATIGUE_REST_THRESHOLD - 1 });
    const world = createWorld(agent, [{ terrain: "plains", resource: null }]);

    expect(new FakePlanner(() => 0).plan(world, agent)).toEqual([{ kind: "rest" }]);

    agent.hunger = HUNGER_EAT_THRESHOLD - 1;
    expect(new FakePlanner(() => 0).plan(world, agent)).toEqual([{ kind: "eat" }]);

    agent.carrying = { kind: "food", amount: 1 };
    expect(new FakePlanner(() => 0).plan(world, agent)).toEqual([
      { kind: "moveTo", dest: world.stockpile.pos },
      { kind: "deposit" },
    ]);
  });

  it("resumes the nearest reachable incomplete house without requiring more wood", () => {
    const agent = createAgent();
    const world = createWorld(
      agent,
      Array.from({ length: 5 }, () => ({ terrain: "plains", resource: null })),
    );
    world.buildings = [
      { kind: "house", pos: { x: 3, y: 0 }, progress: 10, complete: false },
      { kind: "house", pos: { x: 1, y: 0 }, progress: 20, complete: false },
    ];

    expect(new FakePlanner(() => 0).plan(world, agent)).toEqual([
      { kind: "build", pos: { x: 1, y: 0 } },
    ]);
  });

  it("starts a house at the exact cost plus full-winter reserve when capacity is not free", () => {
    const agent = createAgent();
    const world = createWorld(
      agent,
      Array.from({ length: 4 }, () => ({ terrain: "plains", resource: null })),
    );
    const reserve = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;
    world.stockpile.wood = HOUSE_WOOD_COST + reserve;

    expect(new FakePlanner(() => 0).plan(world, agent)).toEqual([
      { kind: "build", pos: { x: 2, y: 0 } },
    ]);
  });

  it("does not build with free completed capacity or wood below cost plus reserve", () => {
    const agent = createAgent();
    const world = createWorld(
      agent,
      Array.from({ length: 3 }, () => ({ terrain: "plains", resource: null })),
    );
    const reserve = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;
    const planner = new FakePlanner(() => 0);

    world.stockpile.wood = HOUSE_WOOD_COST + reserve;
    world.buildings = [
      { kind: "house", pos: { x: 1, y: 0 }, progress: HOUSE_BUILD_TICKS, complete: true },
    ];
    expect(planner.plan(world, agent)).not.toContainEqual({
      kind: "build",
      pos: expect.anything(),
    });

    world.buildings = [];
    world.stockpile.wood = HOUSE_WOOD_COST + reserve - 1;
    expect(planner.plan(world, agent)).not.toContainEqual({
      kind: "build",
      pos: expect.anything(),
    });
  });

  it("chooses a reachable resource-free site near stockpile excluding stockpile agents and buildings", () => {
    const agent = createAgent({ pos: { x: 3, y: 0 } });
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: { kind: "food", amount: 1 } },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
    ]);
    world.buildings = [{ kind: "house", pos: { x: 2, y: 0 }, progress: 1, complete: true }];
    world.agents.push(createAgent({ id: "agent-2", name: "シラカバ", pos: { x: 3, y: 0 } }));
    world.stockpile.wood =
      HOUSE_WOOD_COST + world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;

    expect(new FakePlanner(() => 0).plan(world, agent)).toEqual([
      { kind: "build", pos: { x: 0, y: 0 } },
    ]);
  });

  it("does not start a house when no valid site exists", () => {
    const agent = createAgent();
    const world = createWorld(agent, [{ terrain: "plains", resource: null }]);
    world.stockpile.wood = HOUSE_WOOD_COST + WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;

    expect(new FakePlanner(() => 0).plan(world, agent)).not.toContainEqual({
      kind: "build",
      pos: expect.anything(),
    });
  });

  it("does not choose a valid stockpile-side site that the builder cannot reach", () => {
    const agent = createAgent();
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "water", resource: null },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
    ]);
    world.stockpile.wood = HOUSE_WOOD_COST + WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;

    expect(new FakePlanner(() => 0).plan(world, agent)).not.toContainEqual({
      kind: "build",
      pos: expect.anything(),
    });
  });
});

describe("FakePlanner facility priorities", () => {
  function createFacilityWorld(): { world: WorldState; agent: AgentState; facility: Facility } {
    const agent = createAgent();
    const tiles: Tile[] = Array.from({ length: 4 }, () => ({
      terrain: "plains",
      resource: null,
    }));
    const world = createWorld(agent, tiles);
    world.width = 4;
    world.height = 1;
    world.stockpile.wood = HOUSE_WOOD_COST * 10;
    world.stockpile.food = STOCKPILE_TARGET_FOOD * 10;
    const facility = makeFacilityFixture("communalGranary", { x: 3, y: 0 });
    world.buildings.push(facility);
    world.spatialDemands.push(makeDemandFixture("communalGranary", { x: 3, y: 0 }));
    return { world, agent, facility };
  }

  it("hauls wood to a site that still needs it", () => {
    const { world, agent, facility } = createFacilityWorld();
    const planner = new FakePlanner(() => 0);

    expect(planner.plan(world, agent)).toEqual([
      { kind: "transferToFacility", facilityId: facility.id, resource: "wood" },
    ]);
  });

  it("builds once every plank has arrived", () => {
    const { world, agent, facility } = createFacilityWorld();
    facility.woodDelivered = FACILITY_WOOD_COST.communalGranary;
    const planner = new FakePlanner(() => 0);

    expect(planner.plan(world, agent)).toEqual([
      { kind: "buildFacility", facilityId: facility.id },
    ]);
  });

  it("repairs a standing facility that has fallen behind", () => {
    const { world, agent, facility } = createFacilityWorld();
    facility.complete = true;
    facility.maintenanceDue = 4;
    const planner = new FakePlanner(() => 0);

    expect(planner.plan(world, agent)).toEqual([
      { kind: "maintainFacility", facilityId: facility.id },
    ]);
  });

  function addStandingMarket(world: WorldState): Facility {
    const market = makeFacilityFixture("grainMarket", { x: 2, y: 0 });
    market.complete = true;
    market.operation = "active";
    market.maintenanceDue = 4;
    world.buildings.push(market);
    world.spatialDemands.push(makeDemandFixture("grainMarket", { x: 2, y: 0 }));
    return market;
  }

  it("raises every site before repairing one that already stands", () => {
    const { world, agent, facility } = createFacilityWorld();
    addStandingMarket(world);
    const planner = new FakePlanner(() => 0);

    expect(planner.plan(world, agent)).toEqual([
      { kind: "transferToFacility", facilityId: facility.id, resource: "wood" },
    ]);
  });

  it("stocks a finished facility once the settlement has food to spare", () => {
    const { world, agent, facility } = createFacilityWorld();
    facility.complete = true;
    const planner = new FakePlanner(() => 0);

    expect(planner.plan(world, agent)).toEqual([
      { kind: "transferToFacility", facilityId: facility.id, resource: "food" },
    ]);
  });

  it("stocks a standing facility while the settlement is still short of food", () => {
    const { world, agent, facility } = createFacilityWorld();
    facility.complete = true;
    world.stockpile.food = (RATION_BELOW_FOOD_DAYS - 1) * dailyFoodNeed(world);

    expect(foodDaysRemaining(world)).toBeLessThan(RATION_BELOW_FOOD_DAYS);
    expect(new FakePlanner(() => 0).plan(world, agent)).toEqual([
      { kind: "transferToFacility", facilityId: facility.id, resource: "food" },
    ]);
  });

  it("keeps the food at home when the stockpile holds only the day's meals", () => {
    const { world, agent } = createFacilityWorld();
    world.stockpile.food = FACILITY_STOCK_RESERVE_DAYS * dailyFoodNeed(world);
    const facility = world.buildings[0];
    if (facility === undefined) throw new Error("missing facility");
    facility.complete = true;

    expect(new FakePlanner(() => 0).plan(world, agent)[0]?.kind).not.toBe("transferToFacility");
  });

  it("refuses to stock a facility that is already full", () => {
    const { world, agent, facility } = createFacilityWorld();
    facility.complete = true;
    facility.inventory.food = FACILITY_FOOD_CAPACITY.communalGranary;

    expect(new FakePlanner(() => 0).plan(world, agent)[0]?.kind).not.toBe("transferToFacility");
  });

  it("hauls trading wood to a market that cannot pay for an import", () => {
    const agent = createAgent();
    const tiles: Tile[] = Array.from({ length: 4 }, () => ({ terrain: "plains", resource: null }));
    const world = createWorld(agent, tiles);
    world.stockpile.wood = HOUSE_WOOD_COST * 10;
    const market = addStandingMarket(world);
    market.maintenanceDue = 0;
    world.history.settlementOrigin = {
      homelandPolityId: "polity-1",
      departureEventId: "event-1",
      reason: "famine",
      inheritedValues: [],
    };
    world.history.worldMap.cities.push({
      id: "city-1",
      name: "Homeland",
      pos: { x: 0, y: 0 },
      polityId: "polity-1",
      isCapital: true,
      foundedByEventId: "event-1",
    });
    world.history.worldMap.tradeRoutes.push({
      id: "route-1",
      cityIds: ["city-1", "city-2"],
      establishedByEventId: "event-1",
    });

    expect(new FakePlanner(() => 0).plan(world, agent)).toEqual([
      { kind: "transferToFacility", facilityId: market.id, resource: "wood" },
    ]);
  });

  it("feeds the resident before touching any facility work", () => {
    const { world, agent, facility } = createFacilityWorld();
    facility.complete = true;
    facility.maintenanceDue = 4;
    agent.hunger = HUNGER_EAT_THRESHOLD - 1;

    expect(new FakePlanner(() => 0).plan(world, agent)).toEqual([{ kind: "eat" }]);
  });

  it("ignores a standing facility that needs nothing", () => {
    const { world, agent, facility } = createFacilityWorld();
    facility.complete = true;
    const planner = new FakePlanner(() => 0);

    expect(planner.plan(world, agent)[0]?.kind).not.toBe("maintainFacility");
  });

  it("gathers wood instead of proposing a transfer the stockpile cannot fund", () => {
    const { world, agent } = createFacilityWorld();
    world.stockpile.wood = 0;
    const woodTile = world.tiles[2];
    if (woodTile !== undefined) {
      woodTile.terrain = "forest";
      woodTile.resource = { kind: "wood", amount: 10 };
    }
    const planner = new FakePlanner(() => 0);

    expect(planner.plan(world, agent)).toEqual([
      { kind: "moveTo", dest: { x: 2, y: 0 } },
      { kind: "gather", resource: "wood", target: { x: 2, y: 0 } },
    ]);
  });

  it.each([
    [
      "a carried load first",
      (world: WorldState, agent: AgentState) => {
        agent.carrying = { kind: "wood", amount: 1 };
        void world;
      },
      "moveTo",
    ],
    [
      "hunger before facilities",
      (world: WorldState, agent: AgentState) => {
        agent.hunger = HUNGER_EAT_THRESHOLD - 1;
        void world;
      },
      "eat",
    ],
    [
      "fatigue before facilities",
      (world: WorldState, agent: AgentState) => {
        agent.fatigue = FATIGUE_REST_THRESHOLD - 1;
        void world;
      },
      "rest",
    ],
  ])("puts %s", (_label, arrange, expected) => {
    const { world, agent } = createFacilityWorld();
    arrange(world, agent);
    const planner = new FakePlanner(() => 0);

    expect(planner.plan(world, agent)[0]?.kind).toBe(expected);
  });

  it("puts facility work ahead of an incomplete house", () => {
    const { world, agent, facility } = createFacilityWorld();
    world.buildings.push({ kind: "house", pos: { x: 1, y: 0 }, progress: 1, complete: false });
    const planner = new FakePlanner(() => 0);

    expect(planner.plan(world, agent)).toEqual([
      { kind: "transferToFacility", facilityId: facility.id, resource: "wood" },
    ]);
  });
});
