import {
  NATION_FOOD_PRODUCTION_PER_CAPITA,
  NATION_PROSPERITY_CULTURE_REFERENCE,
  NATION_PROSPERITY_CULTURE_WEIGHT,
  NATION_PROSPERITY_POPULATION_REFERENCE,
  NATION_PROSPERITY_POPULATION_WEIGHT,
  NATION_PROSPERITY_PRODUCTION_REFERENCE,
  NATION_PROSPERITY_PRODUCTION_WEIGHT,
  NATION_PROSPERITY_SCORE_MAX,
  NATION_PROSPERITY_STABILITY_REFERENCE,
  NATION_PROSPERITY_STABILITY_WEIGHT,
  NATION_PROSPERITY_WEALTH_REFERENCE,
  NATION_PROSPERITY_WEALTH_WEIGHT,
  type NationState,
  type ProsperityScore,
} from "@agent-town/shared";

function normalized(value: number, reference: number): number {
  return Math.max(0, Math.min(1, value / reference));
}

export function computeProsperity(nation: NationState): ProsperityScore {
  const population = normalized(nation.population, NATION_PROSPERITY_POPULATION_REFERENCE);
  const seasonalFoodProduction =
    nation.foodProduction * nation.population * NATION_FOOD_PRODUCTION_PER_CAPITA;
  const production = normalized(
    seasonalFoodProduction + nation.materialProduction,
    NATION_PROSPERITY_PRODUCTION_REFERENCE,
  );
  const wealth = normalized(nation.stocks.wealth, NATION_PROSPERITY_WEALTH_REFERENCE);
  const stability = normalized(nation.stability, NATION_PROSPERITY_STABILITY_REFERENCE);
  const culture = normalized(nation.culture, NATION_PROSPERITY_CULTURE_REFERENCE);
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
