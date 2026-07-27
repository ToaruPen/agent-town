import {
  type CulturalValue,
  NATION_CAPITAL_POPULATION_WEIGHT,
  NATION_CITY_POPULATION_WEIGHT,
  NATION_INITIAL_CULTURE_BASE,
  NATION_INITIAL_CULTURE_MAX,
  NATION_INITIAL_CULTURE_MIN,
  NATION_INITIAL_CULTURE_PER_VALUE_WEIGHT,
  NATION_INITIAL_STABILITY_BASE,
  NATION_INITIAL_STABILITY_MAX,
  NATION_INITIAL_STABILITY_MIN,
  NATION_INITIAL_STABILITY_PER_HISTORY_POINT,
  NATION_POPULATION_PER_HISTORY_POINT,
  NATION_STARTING_FOOD_MUTUAL_AID_COEFFICIENT,
  NATION_STARTING_FOOD_PRODUCTION_MULTIPLIER,
  NATION_STARTING_FOOD_STEWARDSHIP_COEFFICIENT,
  NATION_STARTING_MATERIAL_ORDER_COEFFICIENT,
  NATION_STARTING_MATERIAL_PRODUCTION_MULTIPLIER,
  NATION_STARTING_MATERIAL_VALOR_COEFFICIENT,
  NATION_STARTING_WEALTH_COMMERCE_COEFFICIENT,
  NATION_STARTING_WEALTH_PER_TERRITORY_CELL,
  NATION_TERRAIN_FOOD_PRODUCTION,
  NATION_TERRAIN_MATERIAL_PRODUCTION,
  type NationCityState,
  type NationId,
  type NationState,
  type Polity,
  type WorldCity,
  type WorldHistory,
  type WorldMapCell,
} from "@agent-town/shared";

import { computeProsperity } from "./prosperity.js";

function historyPopulation(history: WorldHistory, polityId: NationId): number {
  return history.events
    .flatMap(({ effects }) => effects)
    .reduce(
      (total, effect) =>
        effect.kind === "population" && effect.targetId === polityId ? total + effect.delta : total,
      0,
    );
}

function cityWeight(city: WorldCity): number {
  return city.isCapital ? NATION_CAPITAL_POPULATION_WEIGHT : NATION_CITY_POPULATION_WEIGHT;
}

function initialCities(cities: readonly WorldCity[], population: number): NationCityState[] {
  const totalWeight = cities.reduce((total, item) => total + cityWeight(item), 0);
  if (totalWeight === 0) throw new Error("live nation requires at least one city");
  const allocations = cities.map((item) =>
    Math.floor((population * cityWeight(item)) / totalWeight),
  );
  const allocated = allocations.reduce((total, value) => total + value, 0);
  const remainderOrder = cities
    .map((item, index) => ({ index, weight: cityWeight(item), cityId: item.id }))
    .toSorted(
      (left, right) => right.weight - left.weight || left.cityId.localeCompare(right.cityId),
    );
  for (let offset = 0; offset < population - allocated; offset += 1) {
    const target = remainderOrder[offset];
    if (target !== undefined) allocations[target.index] = (allocations[target.index] ?? 0) + 1;
  }
  return cities.map((item, index) => ({
    cityId: item.id,
    population: allocations[index] ?? 0,
    developmentLevel: 0,
  }));
}

function valueWeight(polity: Polity, value: CulturalValue): number {
  return polity.values.find((item) => item.value === value)?.weight ?? 0;
}

function terrainProduction(
  cells: readonly WorldMapCell[],
  coefficients: Readonly<Record<WorldMapCell["terrain"], number>>,
): number {
  return cells.reduce((total, cell) => total + coefficients[cell.terrain], 0);
}

function initialStocks(
  polity: Polity,
  territoryCellCount: number,
  foodProduction: number,
  materialProduction: number,
): NationState["stocks"] {
  const foodMultiplier =
    NATION_STARTING_FOOD_PRODUCTION_MULTIPLIER +
    valueWeight(polity, "mutualAid") * NATION_STARTING_FOOD_MUTUAL_AID_COEFFICIENT +
    valueWeight(polity, "stewardship") * NATION_STARTING_FOOD_STEWARDSHIP_COEFFICIENT;
  const materialMultiplier =
    NATION_STARTING_MATERIAL_PRODUCTION_MULTIPLIER +
    valueWeight(polity, "valor") * NATION_STARTING_MATERIAL_VALOR_COEFFICIENT +
    valueWeight(polity, "order") * NATION_STARTING_MATERIAL_ORDER_COEFFICIENT;
  const wealthPerCell =
    NATION_STARTING_WEALTH_PER_TERRITORY_CELL +
    valueWeight(polity, "commerce") * NATION_STARTING_WEALTH_COMMERCE_COEFFICIENT;
  return {
    food: Math.round(foodProduction * foodMultiplier),
    materials: Math.round(materialProduction * materialMultiplier),
    wealth: Math.round(territoryCellCount * wealthPerCell),
  };
}

function initialStability(populationPoints: number): number {
  const stability =
    NATION_INITIAL_STABILITY_BASE + populationPoints * NATION_INITIAL_STABILITY_PER_HISTORY_POINT;
  return Math.max(NATION_INITIAL_STABILITY_MIN, Math.min(NATION_INITIAL_STABILITY_MAX, stability));
}

function initialCulture(polity: Polity): number {
  const inheritedWeight = polity.values.reduce((total, value) => total + value.weight, 0);
  const culture =
    NATION_INITIAL_CULTURE_BASE + inheritedWeight * NATION_INITIAL_CULTURE_PER_VALUE_WEIGHT;
  return Math.max(NATION_INITIAL_CULTURE_MIN, Math.min(NATION_INITIAL_CULTURE_MAX, culture));
}

function bootstrapNation(
  history: WorldHistory,
  polity: Polity,
  playerNationId: NationId | null,
  ownedCells: WorldMapCell[],
): NationState {
  const populationPoints = historyPopulation(history, polity.id);
  const population = populationPoints * NATION_POPULATION_PER_HISTORY_POINT;
  const foodProduction = terrainProduction(ownedCells, NATION_TERRAIN_FOOD_PRODUCTION);
  const materialProduction = terrainProduction(ownedCells, NATION_TERRAIN_MATERIAL_PRODUCTION);
  const cities = history.worldMap.cities.filter(({ polityId }) => polityId === polity.id);
  const nation: NationState = {
    id: polity.id,
    controller: polity.id === playerNationId ? "player" : "agent",
    autoPilot: true,
    stocks: initialStocks(polity, ownedCells.length, foodProduction, materialProduction),
    cities: initialCities(cities, population),
    territoryCellCount: ownedCells.length,
    population,
    stability: initialStability(populationPoints),
    culture: initialCulture(polity),
    foodProduction,
    materialProduction,
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
  };
  return { ...nation, prosperity: computeProsperity(nation) };
}

export function bootstrapNations(
  history: WorldHistory,
  playerNationId: NationId | null,
): NationState[] {
  return history.polities.flatMap((polity) => {
    const ownedCells = history.worldMap.cells.filter(({ polityId }) => polityId === polity.id);
    return ownedCells.length === 0
      ? []
      : [bootstrapNation(history, polity, playerNationId, ownedCells)];
  });
}
