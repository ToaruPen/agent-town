import type { NationState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { computeProsperity } from "../src/sim/nation/prosperity.js";

function nationFixture(overrides: Partial<NationState> = {}): NationState {
  return {
    id: "realm",
    controller: "agent",
    autoPilot: true,
    stocks: { food: 0, materials: 0, wealth: 2_500 },
    cities: [{ cityId: "capital", population: 10_000, developmentLevel: 0 }],
    territoryCellCount: 100,
    population: 10_000,
    stability: 50,
    culture: 50,
    foodProduction: 400,
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

describe("computeProsperity", () => {
  it("returns normalized component ratios and their weighted total", () => {
    expect(computeProsperity(nationFixture())).toEqual({
      population: 0.5,
      production: 0.5,
      wealth: 0.5,
      stability: 0.5,
      culture: 0.5,
      total: 500,
    });
  });

  it("clamps every component and the weighted total to their public ranges", () => {
    const score = computeProsperity(
      nationFixture({
        stocks: { food: 0, materials: 0, wealth: 50_000 },
        population: 100_000,
        stability: 200,
        culture: 200,
        foodProduction: 10_000,
        materialProduction: 10_000,
      }),
    );

    expect(score).toEqual({
      population: 1,
      production: 1,
      wealth: 1,
      stability: 1,
      culture: 1,
      total: 1_000,
    });
  });

  it("uses seasonal per-capita food output in the production component", () => {
    const score = computeProsperity(nationFixture({ population: 5_000 }));

    expect(score.production).toBe(0.3);
  });
});
