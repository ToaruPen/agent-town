import {
  type AgentState,
  accessibleFoodTotal,
  FACILITY_FOOD_CAPACITY,
  FACILITY_MAINTENANCE_PER_DAY,
  FACILITY_RESERVE_FOOD_DAYS,
  type Facility,
  type FacilityKind,
  FOOD_PER_MEAL,
  GRANARY_FOOD_SPOILAGE_RATE,
  HUNGER_PER_MEAL,
  MARKET_EXPORT_FOOD,
  MARKET_EXPORT_WOOD,
  MARKET_IMPORT_FOOD,
  MARKET_IMPORT_WOOD,
  MARKET_TRADE_INTERVAL_TICKS,
  type Position,
  RATION_FOOD_PER_MEAL,
  RATION_HUNGER_PER_MEAL,
  RATION_STRAIN_PER_MEAL,
  RATION_STRAIN_RECOVERY_PER_DAY,
  STOCKPILE_FOOD_SPOILAGE_RATE,
  storedFoodTotal,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  applyMealFromStore,
  chooseFoodStore,
  foodStorePos,
  marketHasTradeAccess,
  refreshFacilityAvailability,
  runFacilityDay,
  runFacilityInterval,
} from "../src/sim/facilityOperation.js";
import { makeAgentFixture } from "./agentFixture.js";
import { makeFacilityFixture } from "./spatialFixture.js";
import { makeWorldFixture } from "./worldFixture.js";

const WIDTH = 8;
const HEIGHT = 3;

function makeResident(id: string, pos: Position, hunger: number): AgentState {
  return makeAgentFixture({
    id,
    name: id,
    pos,
    hunger,
  });
}

interface WorldOptions {
  stockpileFood?: number;
  residents?: AgentState[];
}

function createWorld(options: WorldOptions = {}): WorldState {
  return makeWorldFixture({
    width: WIDTH,
    height: HEIGHT,
    tiles: Array.from({ length: WIDTH * HEIGHT }, () => ({
      terrain: "plains" as const,
      resource: null,
    })),
    agents: options.residents ?? [makeResident("agent-1", { x: 1, y: 0 }, 100)],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: options.stockpileFood ?? 0 },
  });
}

function addFacility(world: WorldState, kind: FacilityKind, pos: Position, food: number): Facility {
  const facility = makeFacilityFixture(kind, pos);
  facility.complete = true;
  facility.operation = "active";
  facility.inventory.food = food;
  world.buildings.push(facility);
  return facility;
}

/** Gives the settlement a homeland whose city sits on a trade route. */
function grantTradeAccess(world: WorldState): void {
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
}

function wallOff(world: WorldState, x: number): void {
  for (let y = 0; y < HEIGHT; y += 1) {
    const tile = world.tiles[y * WIDTH + x];
    if (tile !== undefined) tile.terrain = "water";
  }
}

describe("granary operation", () => {
  it("loses less food than the open stockpile and records what it saved", () => {
    const world = createWorld({ stockpileFood: 50 });
    const granary = addFacility(world, "communalGranary", { x: 3, y: 0 }, 100);

    runFacilityDay(world);

    expect(granary.inventory.food).toBeCloseTo(100 * (1 - GRANARY_FOOD_SPOILAGE_RATE));
    expect(granary.statsToday.foodPreserved).toBeCloseTo(
      100 * (STOCKPILE_FOOD_SPOILAGE_RATE - GRANARY_FOOD_SPOILAGE_RATE),
    );
    expect(world.stockpile.food).toBeCloseTo(50 * (1 - STOCKPILE_FOOD_SPOILAGE_RATE));
  });

  it("falls back to open-air spoilage and shuts once upkeep is overdue", () => {
    const world = createWorld();
    const granary = addFacility(world, "communalGranary", { x: 3, y: 0 }, 100);
    granary.maintenanceDue = FACILITY_MAINTENANCE_PER_DAY.communalGranary + 1;

    runFacilityDay(world);

    expect(granary.inventory.food).toBeCloseTo(100 * (1 - STOCKPILE_FOOD_SPOILAGE_RATE));
    expect(granary.statsToday.foodPreserved).toBe(0);
    expect(granary.operation).toBe("blocked");
    expect(granary.blockedReason).toBe("maintenanceOverdue");
  });

  it("adds a day of upkeep and clears yesterday's tally", () => {
    const world = createWorld();
    const granary = addFacility(world, "communalGranary", { x: 3, y: 0 }, 10);
    granary.statsToday.visits = 7;

    runFacilityDay(world);

    expect(granary.maintenanceDue).toBe(FACILITY_MAINTENANCE_PER_DAY.communalGranary);
    expect(granary.statsToday.visits).toBe(0);
  });

  it("leaves a building plot untouched", () => {
    const world = createWorld();
    const plot = addFacility(world, "communalGranary", { x: 3, y: 0 }, 0);
    plot.complete = false;
    plot.operation = "inactive";

    runFacilityDay(world);

    expect(plot.maintenanceDue).toBe(0);
    expect(plot.operation).toBe("inactive");
  });

  it("recovers ration strain without dipping below zero", () => {
    const strained = makeResident("agent-1", { x: 1, y: 0 }, 100);
    strained.rationStrain = RATION_STRAIN_RECOVERY_PER_DAY / 2;
    const world = createWorld({ residents: [strained] });

    runFacilityDay(world);

    expect(strained.rationStrain).toBe(0);
  });
});

describe("market trade access", () => {
  it("requires a homeland city that sits on an inherited trade route", () => {
    const world = createWorld();
    expect(marketHasTradeAccess(world)).toBe(false);

    grantTradeAccess(world);
    expect(marketHasTradeAccess(world)).toBe(true);
  });

  it("refuses access when the route belongs to another polity", () => {
    const world = createWorld();
    grantTradeAccess(world);
    const homelandCity = world.history.worldMap.cities[0];
    if (homelandCity !== undefined) homelandCity.polityId = "polity-other";

    expect(marketHasTradeAccess(world)).toBe(false);
  });
});

describe("market exchange", () => {
  function marketWorld(stockpileFood: number): { world: WorldState; market: Facility } {
    const world = createWorld({ stockpileFood });
    grantTradeAccess(world);
    const market = addFacility(world, "grainMarket", { x: 3, y: 0 }, 0);
    market.inventory.wood = MARKET_IMPORT_WOOD;
    world.tick = MARKET_TRADE_INTERVAL_TICKS;
    return { world, market };
  }

  it("buys grain with wood when the settlement is short", () => {
    const { world, market } = marketWorld(0);

    runFacilityInterval(world);

    expect(market.inventory.wood).toBe(0);
    expect(market.inventory.food).toBe(MARKET_IMPORT_FOOD);
    expect(market.statsToday.woodSpent).toBe(MARKET_IMPORT_WOOD);
    expect(market.statsToday.foodImported).toBe(MARKET_IMPORT_FOOD);
    expect(market.lastTradeTick).toBe(MARKET_TRADE_INTERVAL_TICKS);
  });

  it("sells surplus grain for wood when the settlement is well fed", () => {
    const { world, market } = marketWorld(60);
    market.inventory.food = MARKET_EXPORT_FOOD;

    runFacilityInterval(world);

    expect(market.inventory.food).toBe(0);
    expect(market.inventory.wood).toBe(MARKET_IMPORT_WOOD + MARKET_EXPORT_WOOD);
    expect(market.statsToday.foodExported).toBe(MARKET_EXPORT_FOOD);
    expect(market.statsToday.woodReceived).toBe(MARKET_EXPORT_WOOD);
  });

  it("keeps everything unchanged without a trade route", () => {
    const { world, market } = marketWorld(0);
    world.history.settlementOrigin = null;

    runFacilityInterval(world);

    expect(market.inventory).toEqual({ wood: MARKET_IMPORT_WOOD, food: 0 });
    expect(market.operation).toBe("blocked");
    expect(market.blockedReason).toBe("noTradeRoute");
    expect(market.lastTradeTick).toBeNull();
  });

  it("keeps everything unchanged when it cannot pay", () => {
    const { world, market } = marketWorld(0);
    market.inventory.wood = MARKET_IMPORT_WOOD - 1;

    runFacilityInterval(world);

    expect(market.inventory).toEqual({ wood: MARKET_IMPORT_WOOD - 1, food: 0 });
    expect(market.lastTradeTick).toBeNull();
  });

  it("stays idle between interval ticks and never trades twice at one tick", () => {
    const { world, market } = marketWorld(0);
    world.tick = MARKET_TRADE_INTERVAL_TICKS - 1;

    runFacilityInterval(world);
    expect(market.inventory.food).toBe(0);

    world.tick = MARKET_TRADE_INTERVAL_TICKS;
    market.inventory.wood = MARKET_IMPORT_WOOD * 2;
    runFacilityInterval(world);
    runFacilityInterval(world);

    expect(market.inventory.food).toBe(MARKET_IMPORT_FOOD);
    expect(market.inventory.wood).toBe(MARKET_IMPORT_WOOD);
  });

  it("never trades at tick zero", () => {
    const { world, market } = marketWorld(0);
    world.tick = 0;

    runFacilityInterval(world);

    expect(market.inventory.food).toBe(0);
  });
});

describe("food store selection", () => {
  it("prefers the ration depot while the settlement is short", () => {
    const world = createWorld({ stockpileFood: 5 });
    const depot = addFacility(world, "rationDepot", { x: 3, y: 0 }, 10);
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");

    expect(chooseFoodStore(world, resident)).toEqual({ kind: "facility", facility: depot });
  });

  it("opens the granary once the everyday stores are empty", () => {
    const world = createWorld({ stockpileFood: 0 });
    const granary = addFacility(world, "communalGranary", { x: 3, y: 0 }, 100);
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");

    expect(chooseFoodStore(world, resident)).toEqual({ kind: "facility", facility: granary });
  });

  it("keeps the reserve shut while the stockpile still feeds the settlement", () => {
    const world = createWorld({ stockpileFood: 40 });
    addFacility(world, "communalGranary", { x: 3, y: 0 }, 100);
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");

    expect(chooseFoodStore(world, resident)).toEqual({
      kind: "stockpile",
      pos: world.stockpile.pos,
    });
  });

  it("walks past a blocked store to a reachable one", () => {
    const world = createWorld({ stockpileFood: 40 });
    const depot = addFacility(world, "rationDepot", { x: 2, y: 0 }, 40);
    depot.maintenanceDue = FACILITY_MAINTENANCE_PER_DAY.rationDepot + 1;
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");

    expect(chooseFoodStore(world, resident)).toEqual({
      kind: "stockpile",
      pos: world.stockpile.pos,
    });
  });

  it("ignores a store cut off from every resident", () => {
    const world = createWorld({ stockpileFood: 0 });
    addFacility(world, "communalGranary", { x: 6, y: 0 }, 100);
    wallOff(world, 4);
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");

    expect(chooseFoodStore(world, resident)).toBeNull();
  });

  it("returns nothing when no store holds a whole meal", () => {
    const world = createWorld({ stockpileFood: FOOD_PER_MEAL - 1 });
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");

    expect(chooseFoodStore(world, resident)).toBeNull();
  });

  it("serves the neediest first when the depot cannot feed everyone", () => {
    const hungry = makeResident("agent-2", { x: 1, y: 0 }, 10);
    const comfortable = makeResident("agent-1", { x: 1, y: 0 }, 90);
    const world = createWorld({ stockpileFood: 5, residents: [comfortable, hungry] });
    const depot = addFacility(world, "rationDepot", { x: 3, y: 0 }, RATION_FOOD_PER_MEAL);

    expect(chooseFoodStore(world, hungry)).toEqual({ kind: "facility", facility: depot });
    expect(chooseFoodStore(world, comfortable)).toEqual({
      kind: "stockpile",
      pos: world.stockpile.pos,
    });
  });

  it("reports where a resident must walk for each kind of store", () => {
    const world = createWorld({ stockpileFood: 0 });
    const granary = addFacility(world, "communalGranary", { x: 3, y: 0 }, 100);

    expect(foodStorePos({ kind: "stockpile", pos: world.stockpile.pos })).toEqual({ x: 0, y: 0 });
    expect(foodStorePos({ kind: "facility", facility: granary })).toEqual({ x: 3, y: 0 });
  });
});

describe("meals from a store", () => {
  it("shrinks the meal and strains the resident while rationing", () => {
    const world = createWorld({ stockpileFood: 5 });
    const depot = addFacility(world, "rationDepot", { x: 3, y: 0 }, 10);
    world.tick = 12;
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");
    resident.hunger = 10;

    expect(applyMealFromStore(world, resident, { kind: "facility", facility: depot })).toBe(true);
    expect(depot.inventory.food).toBe(10 - RATION_FOOD_PER_MEAL);
    expect(resident.hunger).toBe(10 + RATION_HUNGER_PER_MEAL);
    expect(resident.rationStrain).toBeCloseTo(RATION_STRAIN_PER_MEAL);
    expect(resident.lastRationTick).toBe(12);
    expect(depot.statsToday).toMatchObject({ visits: 1, rationMeals: 1 });
    expect(depot.lastUsedAtTick).toBe(12);
  });

  it("serves a full meal from the same depot in a good year", () => {
    const world = createWorld({ stockpileFood: 200 });
    const depot = addFacility(world, "rationDepot", { x: 3, y: 0 }, 40);
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");
    resident.hunger = 10;

    expect(applyMealFromStore(world, resident, { kind: "facility", facility: depot })).toBe(true);
    expect(depot.inventory.food).toBe(40 - FOOD_PER_MEAL);
    expect(resident.hunger).toBe(10 + HUNGER_PER_MEAL);
    expect(resident.rationStrain).toBe(0);
    expect(depot.statsToday).toMatchObject({ visits: 1, rationMeals: 0 });
  });

  it("takes an ordinary meal from the stockpile", () => {
    const world = createWorld({ stockpileFood: 20 });
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");
    resident.hunger = 10;

    const store = { kind: "stockpile", pos: world.stockpile.pos } as const;
    expect(applyMealFromStore(world, resident, store)).toBe(true);
    expect(world.stockpile.food).toBe(20 - FOOD_PER_MEAL);
    expect(resident.hunger).toBe(10 + HUNGER_PER_MEAL);
  });

  it("refuses a meal the store cannot cover", () => {
    const world = createWorld({ stockpileFood: FOOD_PER_MEAL - 1 });
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");

    const store = { kind: "stockpile", pos: world.stockpile.pos } as const;
    expect(applyMealFromStore(world, resident, store)).toBe(false);
    expect(world.stockpile.food).toBe(FOOD_PER_MEAL - 1);
  });
});

describe("food conservation", () => {
  it("moves food between stores without minting or losing any", () => {
    const world = createWorld({ stockpileFood: 5 });
    const depot = addFacility(world, "rationDepot", { x: 3, y: 0 }, 10);
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");
    const before = storedFoodTotal(world);

    applyMealFromStore(world, resident, { kind: "facility", facility: depot });

    expect(storedFoodTotal(world) - before).toBeCloseTo(-RATION_FOOD_PER_MEAL);
  });

  it("accounts for a day of spoilage exactly", () => {
    const world = createWorld({ stockpileFood: 50 });
    addFacility(world, "communalGranary", { x: 3, y: 0 }, 100);
    const before = storedFoodTotal(world);

    runFacilityDay(world);

    const spoiled = 50 * STOCKPILE_FOOD_SPOILAGE_RATE + 100 * GRANARY_FOOD_SPOILAGE_RATE;
    expect(storedFoodTotal(world) - before).toBeCloseTo(-spoiled);
  });

  it("accounts for an import exactly", () => {
    const world = createWorld({ stockpileFood: 0 });
    grantTradeAccess(world);
    const market = addFacility(world, "grainMarket", { x: 3, y: 0 }, 0);
    market.inventory.wood = MARKET_IMPORT_WOOD;
    world.tick = MARKET_TRADE_INTERVAL_TICKS;
    const before = storedFoodTotal(world);

    runFacilityInterval(world);

    expect(storedFoodTotal(world) - before).toBeCloseTo(market.statsToday.foodImported);
  });
});

describe("facility availability", () => {
  it("blocks a facility no resident can reach and revives it when the way opens", () => {
    const world = createWorld();
    const granary = addFacility(world, "communalGranary", { x: 6, y: 0 }, 20);
    wallOff(world, 4);

    refreshFacilityAvailability(world);
    expect(granary.operation).toBe("blocked");
    expect(granary.blockedReason).toBe("unreachable");

    for (let y = 0; y < HEIGHT; y += 1) {
      const tile = world.tiles[y * WIDTH + 4];
      if (tile !== undefined) tile.terrain = "plains";
    }
    refreshFacilityAvailability(world);
    expect(granary.operation).toBe("active");
    expect(granary.blockedReason).toBeNull();
  });

  it("keeps a full facility serving food while it refuses deposits", () => {
    const world = createWorld();
    const granary = addFacility(
      world,
      "communalGranary",
      { x: 3, y: 0 },
      FACILITY_FOOD_CAPACITY.communalGranary,
    );

    refreshFacilityAvailability(world);

    expect(granary.operation).toBe("active");
    expect(granary.blockedReason).toBe("full");
    expect(accessibleFoodTotal(world)).toBe(FACILITY_FOOD_CAPACITY.communalGranary);
  });

  it("ranks an unreachable market above a missing trade route", () => {
    const world = createWorld();
    const market = addFacility(world, "grainMarket", { x: 6, y: 0 }, 0);
    wallOff(world, 4);

    refreshFacilityAvailability(world);

    expect(market.blockedReason).toBe("unreachable");
  });

  it("leaves a building plot inactive", () => {
    const world = createWorld();
    const plot = addFacility(world, "communalGranary", { x: 3, y: 0 }, 0);
    plot.complete = false;
    plot.operation = "inactive";

    refreshFacilityAvailability(world);

    expect(plot.operation).toBe("inactive");
    expect(plot.blockedReason).toBeNull();
  });
});

describe("reserve release", () => {
  it("stays shut while other stores still cover the reserve threshold", () => {
    const world = createWorld({ stockpileFood: 0 });
    addFacility(world, "communalGranary", { x: 3, y: 0 }, 100);
    const depot = addFacility(world, "rationDepot", { x: 5, y: 0 }, 0);
    const resident = world.agents[0];
    if (resident === undefined) throw new Error("missing resident");

    depot.inventory.food = FACILITY_RESERVE_FOOD_DAYS * 5 + 10;
    expect(chooseFoodStore(world, resident)).toEqual({ kind: "facility", facility: depot });
  });
});
