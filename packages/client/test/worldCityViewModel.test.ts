import {
  NATION_CITY_DEVELOPMENT_CAP,
  NATION_CITY_TIER_MIN_POPULATIONS,
  type NationCityState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  CHRONICLE_CITY_TIER_RADII_PX,
  chronicleCityGlyph,
  cityPopulationTier,
} from "../src/ui/worldCityViewModel.js";

function cityState(population: number, developmentLevel = 1): NationCityState {
  return { cityId: "city-polity-1-1", population, developmentLevel };
}

describe("cityPopulationTier", () => {
  /**
   * The thresholds are absolute so a city cannot appear to grow because a rival's city shrank — the
   * same argument the spec makes for prosperity normalisation (§4.4), applied to glyph size.
   */
  it("puts each threshold's own population in the tier it opens", () => {
    expect(NATION_CITY_TIER_MIN_POPULATIONS).toHaveLength(4);
    for (const [index, minimum] of NATION_CITY_TIER_MIN_POPULATIONS.entries()) {
      expect(cityPopulationTier(minimum)).toBe(index + 1);
    }
  });

  it("keeps a population one short of a threshold in the tier below", () => {
    for (const minimum of NATION_CITY_TIER_MIN_POPULATIONS.slice(1)) {
      expect(cityPopulationTier(minimum - 1)).toBeLessThan(cityPopulationTier(minimum));
    }
  });

  it("rises with population and never falls", () => {
    const tiers = [0, 500, 2000, 3000, 6000, 9000, 40_000].map(cityPopulationTier);

    expect(tiers).toEqual([...tiers].toSorted((left, right) => left - right));
    expect(tiers.at(-1)).toBe(4);
  });

  it("holds the smallest tier for an empty or negative population", () => {
    expect(cityPopulationTier(0)).toBe(1);
    expect(cityPopulationTier(-1)).toBe(1);
  });
});

describe("chronicleCityGlyph", () => {
  /**
   * A rival collapsing must not move anyone else's glyph. The tier is a function of one city's own
   * population and of nothing else, which is what this asserts by computing it in isolation.
   */
  it("gives a city the same glyph whatever became of the rest of the world", () => {
    const before = chronicleCityGlyph(cityState(6000), { isCapital: false });
    const after = chronicleCityGlyph(cityState(6000), { isCapital: false });

    expect(before).toEqual(after);
    expect(before.tier).toBe(cityPopulationTier(6000));
  });

  it("draws a capital as a diamond and a city as a circle", () => {
    expect(chronicleCityGlyph(cityState(3000), { isCapital: true }).shape).toBe("diamond");
    expect(chronicleCityGlyph(cityState(3000), { isCapital: false }).shape).toBe("circle");
  });

  it("takes its radius from the chronicle's own tier table", () => {
    expect(CHRONICLE_CITY_TIER_RADII_PX).toHaveLength(NATION_CITY_TIER_MIN_POPULATIONS.length);
    for (const [index, minimum] of NATION_CITY_TIER_MIN_POPULATIONS.entries()) {
      const glyph = chronicleCityGlyph(cityState(minimum), { isCapital: false });
      expect(glyph.radiusPx).toBe(CHRONICLE_CITY_TIER_RADII_PX[index]);
    }
  });

  /** §2.7 drops the development core and the prosperity tiers at the 6 px cell: no room for either. */
  it("omits the development core and keeps the ring flat at the chronicle cell size", () => {
    const developed = chronicleCityGlyph(cityState(9000, NATION_CITY_DEVELOPMENT_CAP), {
      isCapital: true,
    });

    expect(developed.coreRadiusPx).toBe(0);
    expect(developed.ringWidthPx).toBe(1);
    expect(developed.developmentRatio).toBe(1);
  });

  it("reports development as a ratio of the cap, so the core can be drawn at a larger cell", () => {
    expect(chronicleCityGlyph(cityState(9000, 0), { isCapital: false }).developmentRatio).toBe(0);
    expect(
      chronicleCityGlyph(cityState(9000, NATION_CITY_DEVELOPMENT_CAP * 2), { isCapital: false })
        .developmentRatio,
    ).toBe(1);
  });

  /** The chronicle has no nation state until C1-6b wires it, so this is the case it renders today. */
  it("falls back to the smallest glyph for a city with no nation state", () => {
    const unknown = chronicleCityGlyph(null, { isCapital: false });

    expect(unknown.tier).toBe(1);
    expect(unknown.radiusPx).toBe(CHRONICLE_CITY_TIER_RADII_PX[0]);
    expect(unknown.coreRadiusPx).toBe(0);
    expect(unknown.developmentRatio).toBe(0);
  });

  it("still marks a capital with no nation state as a capital", () => {
    expect(chronicleCityGlyph(null, { isCapital: true }).shape).toBe("diamond");
  });
});
