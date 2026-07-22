import {
  DAYS_PER_SEASON,
  FOOD_PER_MEAL,
  HUNGER_DECAY_PER_DAY,
  HUNGER_PER_MEAL,
  TICKS_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { dayOfTick, foodDaysRemaining, isWinter, seasonOfTick } from "../src/time.js";

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
      thinking: false,
      lastThought: null,
      hunger: 100,
      fatigue: 100,
      health: 100,
    })),
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food },
    buildings: [],
    deaths: [],
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

describe("foodDaysRemaining", () => {
  it("divides stored food by population daily need derived from meal balance", () => {
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
