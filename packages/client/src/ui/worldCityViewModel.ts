import { NATION_CITY_DEVELOPMENT_CAP, type NationCityState } from "@agent-town/shared";

export type CityTier = 1 | 2 | 3 | 4;

/**
 * The population each tier opens at, ascending.
 *
 * These are absolute on purpose: a city must not appear to grow because a rival's city shrank, which
 * is the argument the spec makes for prosperity normalisation (§4.4) and `visual.md` §2.3 carries over
 * to glyph size. The bands span the range the simulation actually produces — a nation holds
 * `NATION_POPULATION_PER_HISTORY_POINT` × 80–120 people, split by
 * `NATION_CAPITAL_POPULATION_WEIGHT` 2 against `NATION_CITY_POPULATION_WEIGHT` 1 over one to four
 * cities, so a city sits between roughly 2,000 and 10,000 at bootstrap and climbs from there.
 *
 * **Provisional, and the one thing in this slice that wants moving.** `visual.md` §2.3 says these
 * belong in `packages/shared/src/constants.ts`; a client worker may not edit that file, so they live
 * here until the supervisor lands them as a shared constant. Nothing but this array changes when they
 * move — the thresholds are absolute either way, which is what the tests pin.
 */
export const CITY_TIER_MIN_POPULATIONS = [0, 2500, 5000, 7500] as const;

/** The 6 px chronicle cell's radii, from `visual.md` §2.7. The 12 px surface has its own column. */
export const CHRONICLE_CITY_TIER_RADII_PX = [2, 2.5, 3, 3.5] as const;

/** §2.7 gives the chronicle a flat ring: prosperity tiers need a larger cell to be comparable. */
const CHRONICLE_RING_WIDTH_PX = 1;

/** §2.7 omits the development core at this cell size — a tier-1 core would be about 1.2 px of mud. */
const CHRONICLE_CORE_RADIUS_PX = 0;

export interface CityGlyph {
  tier: CityTier;
  radiusPx: number;
  /** 0 at the chronicle. Kept on the model so a larger surface can draw the gauge from one decision. */
  coreRadiusPx: number;
  ringWidthPx: number;
  /** Development as a share of the cap, 0..1, which is the core's size wherever there is room for it. */
  developmentRatio: number;
  shape: "circle" | "diamond";
}

/** Capital-ness is a shape, not a size, so radius is free to mean population honestly (§2.3). */
export interface CityGlyphOptions {
  isCapital: boolean;
}

export function cityPopulationTier(population: number): CityTier {
  let tier: CityTier = 1;
  for (const [index, minimum] of CITY_TIER_MIN_POPULATIONS.entries()) {
    if (population >= minimum) tier = (index + 1) as CityTier;
  }
  return tier;
}

function developmentRatio(cityState: NationCityState | null): number {
  if (cityState === null || NATION_CITY_DEVELOPMENT_CAP <= 0) return 0;
  const level = Math.max(0, cityState.developmentLevel);
  return Math.min(1, level / NATION_CITY_DEVELOPMENT_CAP);
}

/**
 * One city's glyph on the 6 px chronicle map. `cityState` is null for a city whose nation state has
 * not arrived — the chronicle has none until the world map gets a live host — and such a city draws
 * at the smallest tier rather than vanishing.
 */
export function chronicleCityGlyph(
  cityState: NationCityState | null,
  options: CityGlyphOptions,
): CityGlyph {
  const tier = cityState === null ? 1 : cityPopulationTier(cityState.population);
  return {
    tier,
    radiusPx: CHRONICLE_CITY_TIER_RADII_PX[tier - 1] ?? CHRONICLE_CITY_TIER_RADII_PX[0],
    coreRadiusPx: CHRONICLE_CORE_RADIUS_PX,
    ringWidthPx: CHRONICLE_RING_WIDTH_PX,
    developmentRatio: developmentRatio(cityState),
    shape: options.isCapital ? "diamond" : "circle",
  };
}
