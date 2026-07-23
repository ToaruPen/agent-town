import {
  type CulturalValue,
  type CulturalValueWeight,
  DAYS_PER_SEASON,
  FOOD_SECURITY_HUNGER_MEMORY_TICKS,
  FOOD_SECURITY_MAX_CHANGE_PER_UPDATE,
  FOOD_SECURITY_UPDATE_INTERVAL_TICKS,
  INSTITUTION_CULTURE_WEIGHT,
  INSTITUTION_DESIRE_WEIGHT,
  INSTITUTION_KINDS,
  SEASONS,
  TICKS_PER_DAY,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  daysUntilWinter,
  institutionSupportForAgent,
  institutionSupportScore,
  isRecentHungerInterrupt,
  updateFoodSecurityDesire,
} from "../src/sim/foodAnxiety.js";
import { generateWorld } from "../src/sim/worldGen.js";

const TICKS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length * TICKS_PER_DAY;
const WINTER_START_TICK = 3 * DAYS_PER_SEASON * TICKS_PER_DAY;

function firstAgent(world: ReturnType<typeof generateWorld>) {
  const agent = world.agents[0];
  if (agent === undefined) throw new Error("missing test agent");
  return agent;
}

function setHomelandCulture(value: CulturalValue): ReturnType<typeof generateWorld> {
  const world = generateWorld(42);
  const homelandId = world.history.settlementOrigin?.homelandPolityId;
  const homeland = world.history.polities.find(({ id }) => id === homelandId);
  if (homeland === undefined) throw new Error("missing homeland polity");
  homeland.values = [{ value, weight: 1, changedByEventIds: [] }];
  return world;
}

function scoreCandidates(culture: CulturalValueWeight[]) {
  return INSTITUTION_KINDS.map((kind) => ({
    kind,
    score: institutionSupportScore(kind, culture, { foodSecurity: 0 }),
  }));
}

describe("food-security desire", () => {
  it("raises food security from shortage, approaching winter, and a recent hunger interrupt", () => {
    const world = generateWorld(42);
    const agent = firstAgent(world);
    world.stockpile.food = 0;
    world.tick = 6 * TICKS_PER_DAY - FOOD_SECURITY_UPDATE_INTERVAL_TICKS;
    agent.desires.foodSecurity = 0;
    agent.lastHungerInterruptTick = world.tick - 1;

    updateFoodSecurityDesire(world, agent);

    expect(agent.desires.foodSecurity).toBe(FOOD_SECURITY_MAX_CHANGE_PER_UPDATE);
  });

  it("decays food security when stores are safe, winter is distant, and hunger is not recent", () => {
    const world = generateWorld(42);
    const agent = firstAgent(world);
    world.stockpile.food = 10_000;
    world.tick = 0;
    agent.desires.foodSecurity = 0.6;
    agent.lastHungerInterruptTick = null;

    updateFoodSecurityDesire(world, agent);

    expect(agent.desires.foodSecurity).toBeCloseTo(0.6 - FOOD_SECURITY_MAX_CHANGE_PER_UPDATE);
  });

  it("expires hunger history at the configured boundary", () => {
    expect(isRecentHungerInterrupt(100, 100 - FOOD_SECURITY_HUNGER_MEMORY_TICKS)).toBe(true);
    expect(isRecentHungerInterrupt(101, 100 - FOOD_SECURITY_HUNGER_MEMORY_TICKS)).toBe(false);
  });

  it("measures winter distance at spring start, winter boundaries, and next spring", () => {
    expect(daysUntilWinter(0)).toBe(6);
    expect(daysUntilWinter(WINTER_START_TICK - 1)).toBe(1 / TICKS_PER_DAY);
    expect(daysUntilWinter(WINTER_START_TICK)).toBe(0);
    expect(daysUntilWinter(TICKS_PER_YEAR)).toBe(6);
  });

  it("treats an infinite food forecast as zero shortage pressure", () => {
    const world = generateWorld(42);
    const agent = firstAgent(world);
    world.stockpile.food = Number.POSITIVE_INFINITY;
    world.tick = 0;
    agent.desires.foodSecurity = 0;
    agent.lastHungerInterruptTick = null;

    updateFoodSecurityDesire(world, agent);

    expect(agent.desires.foodSecurity).toBe(0);
  });

  it.each([Number.NEGATIVE_INFINITY, Number.NaN, Number.POSITIVE_INFINITY, -1, 2])(
    "keeps an updated desire finite and inside 0..1 from %s",
    (foodSecurity) => {
      const world = generateWorld(42);
      const agent = firstAgent(world);
      agent.desires.foodSecurity = foodSecurity;

      updateFoodSecurityDesire(world, agent);

      expect(Number.isFinite(agent.desires.foodSecurity)).toBe(true);
      expect(agent.desires.foodSecurity).toBeGreaterThanOrEqual(0);
      expect(agent.desires.foodSecurity).toBeLessThanOrEqual(1);
    },
  );
});

describe("institution support", () => {
  it("uses exactly the fixed three candidates in order", () => {
    expect(INSTITUTION_KINDS).toEqual(["communalGranaryStore", "grainMarket", "rationControl"]);
  });

  it.each([
    ["mutualAid", "communalGranaryStore"],
    ["commerce", "grainMarket"],
    ["order", "rationControl"],
  ] as const)("ranks %s culture's preferred candidate first", (value, preferredKind) => {
    const culture: CulturalValueWeight[] = [{ value, weight: 1, changedByEventIds: [] }];
    const candidates = scoreCandidates(culture).sort((left, right) => right.score - left.score);

    expect(candidates[0]?.kind).toBe(preferredKind);
  });

  it("applies the configured culture and desire weights", () => {
    expect(
      institutionSupportScore(
        "communalGranaryStore",
        [
          {
            value: "mutualAid",
            weight: 1,
            changedByEventIds: [],
          },
        ],
        { foodSecurity: 0.5 },
      ),
    ).toBeCloseTo(INSTITUTION_CULTURE_WEIGHT + 0.5 * INSTITUTION_DESIRE_WEIGHT);
  });

  it("returns candidate support in fixed order from homeland culture", () => {
    const world = setHomelandCulture("mutualAid");
    const agent = firstAgent(world);

    const support = institutionSupportForAgent(world, agent);
    const [communalGranary, grainMarket, rationControl] = support;
    if (communalGranary === undefined || grainMarket === undefined || rationControl === undefined) {
      throw new Error("missing institution support");
    }

    expect(support.map(({ kind }) => kind)).toEqual(INSTITUTION_KINDS);
    expect(communalGranary.score).toBeGreaterThan(grainMarket.score);
    expect(communalGranary.score).toBeGreaterThan(rationControl.score);
  });

  it("returns deeply equal support for the same input twice", () => {
    const world = setHomelandCulture("commerce");
    const agent = firstAgent(world);

    expect(institutionSupportForAgent(world, agent)).toEqual(
      institutionSupportForAgent(world, agent),
    );
  });
});
