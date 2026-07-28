import {
  NATION_FOOD_PRODUCTION_PER_CAPITA,
  NATION_PROSPERITY_CULTURE_WEIGHT,
  NATION_PROSPERITY_POPULATION_WEIGHT,
  NATION_PROSPERITY_PRODUCTION_WEIGHT,
  NATION_PROSPERITY_SCORE_MAX,
  NATION_PROSPERITY_STABILITY_WEIGHT,
  NATION_PROSPERITY_WEALTH_WEIGHT,
  type NationState,
  type ProsperityScore,
} from "@agent-town/shared";

interface ProsperityComponents {
  population: number;
  production: number;
  wealth: number;
  stability: number;
  culture: number;
}

function rawComponents(nation: NationState): ProsperityComponents {
  const seasonalFoodProduction =
    nation.foodProduction * nation.population * NATION_FOOD_PRODUCTION_PER_CAPITA;
  return {
    population: Math.max(0, nation.population),
    production: Math.max(0, seasonalFoodProduction + nation.materialProduction),
    wealth: Math.max(0, nation.stocks.wealth),
    stability: Math.max(0, nation.stability),
    culture: Math.max(0, nation.culture),
  };
}

function maximumComponents(field: readonly NationState[]): ProsperityComponents {
  const components = field.map(rawComponents);
  return {
    population: Math.max(...components.map(({ population }) => population)),
    production: Math.max(...components.map(({ production }) => production)),
    wealth: Math.max(...components.map(({ wealth }) => wealth)),
    stability: Math.max(...components.map(({ stability }) => stability)),
    culture: Math.max(...components.map(({ culture }) => culture)),
  };
}

function normalizedOnLogScale(value: number, maximum: number): number {
  return maximum <= 0 ? 0 : Math.log1p(value) / Math.log1p(maximum);
}

export function computeProsperity(
  nation: NationState,
  livingField: readonly NationState[],
): ProsperityScore {
  const raw = rawComponents(nation);
  const maximum = maximumComponents([nation, ...livingField]);
  const population = normalizedOnLogScale(raw.population, maximum.population);
  const production = normalizedOnLogScale(raw.production, maximum.production);
  const wealth = normalizedOnLogScale(raw.wealth, maximum.wealth);
  const stability = normalizedOnLogScale(raw.stability, maximum.stability);
  const culture = normalizedOnLogScale(raw.culture, maximum.culture);
  const weightedTotal =
    (population * NATION_PROSPERITY_POPULATION_WEIGHT +
      production * NATION_PROSPERITY_PRODUCTION_WEIGHT +
      wealth * NATION_PROSPERITY_WEALTH_WEIGHT +
      stability * NATION_PROSPERITY_STABILITY_WEIGHT +
      culture * NATION_PROSPERITY_CULTURE_WEIGHT) *
    NATION_PROSPERITY_SCORE_MAX;
  const total = Math.max(0, Math.min(NATION_PROSPERITY_SCORE_MAX, weightedTotal));
  return { population, production, wealth, stability, culture, total };
}
