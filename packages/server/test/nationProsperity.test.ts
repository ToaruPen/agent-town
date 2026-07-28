import {
  NATION_PROSPERITY_CULTURE_WEIGHT,
  NATION_PROSPERITY_POPULATION_WEIGHT,
  NATION_PROSPERITY_PRODUCTION_WEIGHT,
  NATION_PROSPERITY_SCORE_MAX,
  NATION_PROSPERITY_STABILITY_WEIGHT,
  NATION_PROSPERITY_WEALTH_WEIGHT,
  type NationState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { computeProsperity } from "../src/sim/nation/prosperity.js";

function nationFixture(overrides: Partial<NationState> = {}): NationState {
  return {
    id: "realm",
    controller: "agent",
    autoPilot: true,
    stocks: { food: 0, materials: 0, wealth: 2_500 },
    cities: [{ cityId: "capital", population: 5_000, developmentLevel: 0 }],
    territoryCellCount: 100,
    population: 5_000,
    stability: 50,
    culture: 250,
    foodProduction: 500,
    materialProduction: 100,
    activeDirectives: [],
    prosperity: {
      population: 0,
      production: 0,
      wealth: 0,
      stability: 0,
      culture: 0,
      total: 0,
    },
    lastReport: null,
    ...overrides,
  };
}

function expectedLogRatio(value: number, maximum: number): number {
  return Math.log1p(value) / Math.log1p(maximum);
}

describe("computeProsperity", () => {
  it("normalizes each component on a log scale against the living field maximum", () => {
    const nation = nationFixture();
    const leader = nationFixture({
      id: "leader",
      stocks: { food: 0, materials: 0, wealth: 5_000 },
      cities: [{ cityId: "leader-capital", population: 10_000, developmentLevel: 0 }],
      population: 10_000,
      stability: 100,
      culture: 500,
      foodProduction: 500,
      materialProduction: 200,
    });
    const score = computeProsperity(nation, [nation, leader]);

    expect(score.population).toBeCloseTo(expectedLogRatio(5_000, 10_000));
    expect(score.production).toBeCloseTo(expectedLogRatio(350, 700));
    expect(score.wealth).toBeCloseTo(expectedLogRatio(2_500, 5_000));
    expect(score.stability).toBeCloseTo(expectedLogRatio(50, 100));
    expect(score.culture).toBeCloseTo(expectedLogRatio(250, 500));
    expect(score.total).toBeCloseTo(
      (score.population * NATION_PROSPERITY_POPULATION_WEIGHT +
        score.production * NATION_PROSPERITY_PRODUCTION_WEIGHT +
        score.wealth * NATION_PROSPERITY_WEALTH_WEIGHT +
        score.stability * NATION_PROSPERITY_STABILITY_WEIGHT +
        score.culture * NATION_PROSPERITY_CULTURE_WEIGHT) *
        NATION_PROSPERITY_SCORE_MAX,
    );
  });

  it("awards 1000 only to a nation that leads or ties every component", () => {
    const leader = nationFixture();

    expect(computeProsperity(leader, [leader])).toEqual({
      population: 1,
      production: 1,
      wealth: 1,
      stability: 1,
      culture: 1,
      total: NATION_PROSPERITY_SCORE_MAX,
    });
  });

  it("preserves the magnitude difference between a close field and a blowout", () => {
    const leader = nationFixture({ id: "leader", population: 1_000 });
    const close = nationFixture({ id: "close", population: 970 });
    const distant = nationFixture({ id: "distant", population: 250 });

    const closeScore = computeProsperity(close, [close, leader]);
    const distantScore = computeProsperity(distant, [distant, leader]);

    expect(closeScore.population).toBeGreaterThan(0.99);
    expect(distantScore.population).toBeLessThan(0.9);
  });

  it("uses seasonal per-capita food output in the production component", () => {
    const nation = nationFixture({ population: 2_500 });
    const leader = nationFixture();
    const score = computeProsperity(nation, [nation, leader]);

    expect(score.production).toBeCloseTo(expectedLogRatio(225, 350));
  });
});
