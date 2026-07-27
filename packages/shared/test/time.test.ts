import {
  DAYS_PER_SEASON,
  FOOD_PER_MEAL,
  HUNGER_DECAY_PER_DAY,
  HUNGER_PER_MEAL,
  NATION_TICKS_PER_SEASON,
  NATION_TICKS_PER_YEAR,
  TICKS_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  accessibleFoodTotal,
  dayOfTick,
  foodDaysRemaining,
  isWinter,
  nationSeasonOfTick,
  nationYearOfTick,
  seasonOfTick,
  storedFoodTotal,
} from "../src/time.js";
import { makeFacilityFixture, makeTrailCellsFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

function worldWithFood(food: number, population: number): WorldState {
  return {
    tick: 0,
    width: 1,
    height: 1,
    tiles: [{ terrain: "plains", resource: null }],
    agents: Array.from({ length: population }, (_, index) => ({
      id: `agent-${index + 1}`,
      name: `Agent ${index + 1}`,
      pos: { x: 0, y: 0 },
      carrying: null,
      activity: { kind: "idle" as const },
      tasks: [],
      planSource: "fake" as const,
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
    })),
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [],
    trailCells: makeTrailCellsFixture(1, 1),
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

describe("calendar helpers", () => {
  it("numbers days from one at exact tick boundaries", () => {
    expect(dayOfTick(0)).toBe(1);
    expect(dayOfTick(TICKS_PER_DAY - 1)).toBe(1);
    expect(dayOfTick(TICKS_PER_DAY)).toBe(2);
    expect(dayOfTick(8 * TICKS_PER_DAY)).toBe(9);
  });

  it("cycles through two-day seasons and identifies winter", () => {
    expect(seasonOfTick(0)).toBe("spring");
    expect(seasonOfTick(DAYS_PER_SEASON * TICKS_PER_DAY)).toBe("summer");
    expect(seasonOfTick(2 * DAYS_PER_SEASON * TICKS_PER_DAY)).toBe("autumn");
    expect(seasonOfTick(3 * DAYS_PER_SEASON * TICKS_PER_DAY)).toBe("winter");
    expect(seasonOfTick(4 * DAYS_PER_SEASON * TICKS_PER_DAY)).toBe("spring");
    expect(isWinter(3 * DAYS_PER_SEASON * TICKS_PER_DAY - 1)).toBe(false);
    expect(isWinter(3 * DAYS_PER_SEASON * TICKS_PER_DAY)).toBe(true);
  });
});

describe("nation calendar helpers", () => {
  it("advances through one-based elapsed seasons at exact tick boundaries", () => {
    expect(nationSeasonOfTick(0)).toBe("spring");
    expect(nationSeasonOfTick(NATION_TICKS_PER_SEASON - 1)).toBe("spring");
    expect(nationSeasonOfTick(NATION_TICKS_PER_SEASON)).toBe("summer");
    expect(nationSeasonOfTick(2 * NATION_TICKS_PER_SEASON)).toBe("autumn");
    expect(nationSeasonOfTick(3 * NATION_TICKS_PER_SEASON)).toBe("winter");
  });

  it("numbers elapsed years from one and returns to spring at rollover", () => {
    expect(nationYearOfTick(0)).toBe(1);
    expect(nationYearOfTick(NATION_TICKS_PER_YEAR - 1)).toBe(1);
    expect(nationSeasonOfTick(NATION_TICKS_PER_YEAR - 1)).toBe("winter");
    expect(nationYearOfTick(NATION_TICKS_PER_YEAR)).toBe(2);
    expect(nationSeasonOfTick(NATION_TICKS_PER_YEAR)).toBe("spring");
  });
});

describe("food totals across stores", () => {
  it("counts a shut facility as stored but not as accessible", () => {
    const world = worldWithFood(5, 2);
    const granary = makeFacilityFixture("communalGranary", 20);
    const market = makeFacilityFixture("grainMarket", 10);
    market.operation = "blocked";
    market.blockedReason = "noTradeRoute";
    world.buildings.push(granary, market);

    expect(storedFoodTotal(world)).toBe(35);
    expect(accessibleFoodTotal(world)).toBe(25);
    expect(foodDaysRemaining(world)).toBeCloseTo(
      25 / (world.agents.length * FOOD_PER_MEAL * (HUNGER_DECAY_PER_DAY / HUNGER_PER_MEAL)),
    );
  });

  it("excludes a facility that is still a building plot", () => {
    const world = worldWithFood(5, 2);
    const plot = makeFacilityFixture("communalGranary", 12);
    plot.complete = false;
    plot.operation = "inactive";
    world.buildings.push(plot);

    expect(storedFoodTotal(world)).toBe(17);
    expect(accessibleFoodTotal(world)).toBe(5);
  });

  it("ignores houses, which never hold food", () => {
    const world = worldWithFood(5, 2);
    world.buildings.push({ kind: "house", pos: { x: 0, y: 0 }, progress: 1, complete: true });

    expect(storedFoodTotal(world)).toBe(5);
    expect(accessibleFoodTotal(world)).toBe(5);
  });
});

describe("foodDaysRemaining", () => {
  it("divides accessible food by population daily need derived from meal balance", () => {
    const population = 2;
    const food = 25;
    const dailyNeed = population * FOOD_PER_MEAL * (HUNGER_DECAY_PER_DAY / HUNGER_PER_MEAL);

    expect(foodDaysRemaining(worldWithFood(food, population))).toBeCloseTo(food / dailyNeed);
  });

  it("returns zero for an empty colony with no stored food", () => {
    expect(foodDaysRemaining(worldWithFood(0, 0))).toBe(0);
  });

  it("uses a one-person forecast for an empty colony with stored food", () => {
    const food = 25;
    const onePersonDailyNeed = FOOD_PER_MEAL * (HUNGER_DECAY_PER_DAY / HUNGER_PER_MEAL);

    expect(foodDaysRemaining(worldWithFood(food, 0))).toBeCloseTo(food / onePersonDailyNeed);
  });
});
