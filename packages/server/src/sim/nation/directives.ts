import {
  type ActiveDirective,
  type CulturalValue,
  type DirectiveBlockedReason,
  type DirectiveKind,
  type DirectiveOption,
  NATION_CITY_DEVELOPMENT_CAP,
  NATION_CLEAR_FARMLAND_FOOD_PRODUCTION_BONUS,
  NATION_DEVELOP_TIMBER_MATERIAL_PRODUCTION_BONUS,
  NATION_DIRECTIVE_COSTS,
  NATION_DIRECTIVE_CULTURAL_AFFINITIES,
  NATION_DIRECTIVE_DURATIONS,
  NATION_DIRECTIVE_TABOO_AFFINITY,
  NATION_ENCOURAGE_STORES_FOOD_BONUS,
  NATION_GROW_CITY_DEVELOPMENT_BONUS,
  NATION_HOLD_FESTIVAL_CULTURE_BONUS,
  NATION_HOLD_FESTIVAL_STABILITY_BONUS,
  NATION_OPEN_MINE_MATERIAL_PRODUCTION_BONUS,
  type NationState,
  type NationStocks,
  type Polity,
  type WorldMap,
} from "@agent-town/shared";

const DIRECTIVE_KINDS = [
  "clearFarmland",
  "developTimber",
  "openMine",
  "growCity",
  "encourageStores",
  "holdFestival",
] as const satisfies readonly DirectiveKind[];

function culturalWeight(polity: Polity, value: CulturalValue): number {
  return polity.values.find((item) => item.value === value)?.weight ?? 0;
}

function affinityFor(kind: DirectiveKind, polity: Polity): number {
  const affinity = Object.entries(NATION_DIRECTIVE_CULTURAL_AFFINITIES[kind]).reduce(
    (total, [value, coefficient]) =>
      total + coefficient * culturalWeight(polity, value as CulturalValue),
    0,
  );
  return Math.max(-1, Math.min(1, affinity));
}

function hasRequiredTerrain(kind: DirectiveKind, nation: NationState, worldMap: WorldMap): boolean {
  const ownedTerrains = worldMap.cells
    .filter(({ polityId }) => polityId === nation.id)
    .map(({ terrain }) => terrain);
  if (kind === "developTimber") return ownedTerrains.includes("forest");
  if (kind === "openMine")
    return ownedTerrains.includes("hills") || ownedTerrains.includes("mountains");
  return true;
}

function cityIsAtCap(
  kind: DirectiveKind,
  targetCityId: string | null,
  nation: NationState,
): boolean {
  if (kind !== "growCity") return false;
  return (
    nation.cities.find(({ cityId }) => cityId === targetCityId)?.developmentLevel ===
    NATION_CITY_DEVELOPMENT_CAP
  );
}

function isAlreadyActive(
  kind: DirectiveKind,
  targetCityId: string | null,
  nation: NationState,
): boolean {
  return nation.activeDirectives.some(
    (directive) => directive.kind === kind && directive.targetCityId === targetCityId,
  );
}

function insufficientStockReason(
  stocks: NationStocks,
  cost: NationStocks,
): DirectiveBlockedReason | null {
  if (cost.food > stocks.food) return "insufficientFood";
  if (cost.materials > stocks.materials) return "insufficientMaterials";
  if (cost.wealth > stocks.wealth) return "insufficientWealth";
  return null;
}

function blockedReason(
  kind: DirectiveKind,
  targetCityId: string | null,
  affinity: number,
  nation: NationState,
  worldMap: WorldMap,
): DirectiveBlockedReason | null {
  if (affinity <= NATION_DIRECTIVE_TABOO_AFFINITY) return "taboo";
  if (!hasRequiredTerrain(kind, nation, worldMap)) return "missingTerrain";
  if (cityIsAtCap(kind, targetCityId, nation)) return "cityAtMaxDevelopment";
  if (isAlreadyActive(kind, targetCityId, nation)) return "alreadyActive";
  return insufficientStockReason(nation.stocks, NATION_DIRECTIVE_COSTS[kind]);
}

function option(
  kind: DirectiveKind,
  targetCityId: string | null,
  nation: NationState,
  polity: Polity,
  worldMap: WorldMap,
): DirectiveOption {
  const affinity = affinityFor(kind, polity);
  return {
    kind,
    targetCityId,
    cost: { ...NATION_DIRECTIVE_COSTS[kind] },
    seasons: NATION_DIRECTIVE_DURATIONS[kind],
    affinity,
    blockedReason: blockedReason(kind, targetCityId, affinity, nation, worldMap),
  };
}

export function listDirectiveOptions(
  nation: NationState,
  polity: Polity,
  worldMap: WorldMap,
): DirectiveOption[] {
  return DIRECTIVE_KINDS.flatMap((kind) =>
    kind === "growCity"
      ? nation.cities.map(({ cityId }) => option(kind, cityId, nation, polity, worldMap))
      : [option(kind, null, nation, polity, worldMap)],
  );
}

export interface DirectiveCompletion {
  foodProductionDelta: number;
  materialProductionDelta: number;
  stockDeltas: NationStocks;
  stabilityDelta: number;
  cultureDelta: number;
  cityDevelopment: { cityId: string; delta: number } | null;
}

const NO_COMPLETION_EFFECT: DirectiveCompletion = {
  foodProductionDelta: 0,
  materialProductionDelta: 0,
  stockDeltas: { food: 0, materials: 0, wealth: 0 },
  stabilityDelta: 0,
  cultureDelta: 0,
  cityDevelopment: null,
};

function growCityCompletion(directive: ActiveDirective, nation: NationState): DirectiveCompletion {
  const city = nation.cities.find(({ cityId }) => cityId === directive.targetCityId);
  if (city === undefined || directive.targetCityId === null)
    throw new Error("growCity completion requires an owned target city");
  return {
    ...NO_COMPLETION_EFFECT,
    stockDeltas: { ...NO_COMPLETION_EFFECT.stockDeltas },
    cityDevelopment: {
      cityId: directive.targetCityId,
      delta: Math.max(
        0,
        Math.min(
          NATION_GROW_CITY_DEVELOPMENT_BONUS,
          NATION_CITY_DEVELOPMENT_CAP - city.developmentLevel,
        ),
      ),
    },
  };
}

export function completeDirective(
  directive: ActiveDirective,
  nation: NationState,
): DirectiveCompletion {
  switch (directive.kind) {
    case "clearFarmland":
      return {
        ...NO_COMPLETION_EFFECT,
        stockDeltas: { ...NO_COMPLETION_EFFECT.stockDeltas },
        foodProductionDelta: NATION_CLEAR_FARMLAND_FOOD_PRODUCTION_BONUS,
      };
    case "developTimber":
      return {
        ...NO_COMPLETION_EFFECT,
        stockDeltas: { ...NO_COMPLETION_EFFECT.stockDeltas },
        materialProductionDelta: NATION_DEVELOP_TIMBER_MATERIAL_PRODUCTION_BONUS,
      };
    case "openMine":
      return {
        ...NO_COMPLETION_EFFECT,
        stockDeltas: { ...NO_COMPLETION_EFFECT.stockDeltas },
        materialProductionDelta: NATION_OPEN_MINE_MATERIAL_PRODUCTION_BONUS,
      };
    case "growCity":
      return growCityCompletion(directive, nation);
    case "encourageStores":
      return {
        ...NO_COMPLETION_EFFECT,
        stockDeltas: {
          food: NATION_ENCOURAGE_STORES_FOOD_BONUS,
          materials: 0,
          wealth: 0,
        },
      };
    case "holdFestival":
      return {
        ...NO_COMPLETION_EFFECT,
        stockDeltas: { ...NO_COMPLETION_EFFECT.stockDeltas },
        stabilityDelta: NATION_HOLD_FESTIVAL_STABILITY_BONUS,
        cultureDelta: NATION_HOLD_FESTIVAL_CULTURE_BONUS,
      };
  }
}
