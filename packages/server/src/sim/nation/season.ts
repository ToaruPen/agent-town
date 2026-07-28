import {
  type ActiveDirective,
  NATION_CITY_CAPACITY_PER_DEVELOPMENT_LEVEL,
  NATION_CITY_CAPACITY_PER_TERRITORY_CELL,
  NATION_CITY_POPULATION_GROWTH_RATE,
  NATION_CULTURE_GAIN_PER_AFFINITY,
  NATION_DIRECTIVE_COSTS,
  NATION_ENCOURAGE_STORES_FAMINE_LOSS_MULTIPLIER,
  NATION_FAMINE_POPULATION_LOSS_RATE,
  NATION_FAMINE_STABILITY_LOSS,
  NATION_FOOD_CONSUMPTION_PER_CAPITA,
  NATION_FOOD_PRODUCTION_PER_CAPITA,
  NATION_STABILITY_DRIFT_MAX,
  NATION_STABILITY_DRIFT_MIN,
  NATION_STABILITY_MAX,
  NATION_STABILITY_MIN,
  NATION_TRADE_ROUTE_INCOME,
  type NationId,
  type NationState,
  nationSeasonOfTick,
  nationYearOfTick,
  type Polity,
  type SeasonLedgerEntry,
  type SeasonLedgerReason,
  type SeasonMetric,
  type SeasonReport,
  type WorldMap,
} from "@agent-town/shared";

import { completeDirective, listDirectiveOptions } from "./directives.js";
import { computeProsperity } from "./prosperity.js";

type StockMetric = "food" | "materials" | "wealth";

interface SeasonContext {
  nation: NationState;
  entries: SeasonLedgerEntry[];
  completedDirectiveIds: string[];
  famine: boolean;
}

function cloneReport(report: SeasonReport | null): SeasonReport | null {
  return report === null
    ? null
    : {
        ...report,
        entries: report.entries.map((entry) => ({ ...entry })),
        completedDirectiveIds: [...report.completedDirectiveIds],
      };
}

function cloneNation(nation: NationState): NationState {
  return {
    ...nation,
    stocks: { ...nation.stocks },
    cities: nation.cities.map((city) => ({ ...city })),
    activeDirectives: nation.activeDirectives.map((directive) => ({ ...directive })),
    prosperity: { ...nation.prosperity },
    lastReport: cloneReport(nation.lastReport),
  };
}

function ledger(
  context: SeasonContext,
  metric: SeasonMetric,
  delta: number,
  reason: SeasonLedgerReason,
  directiveId: string | null = null,
): void {
  if (delta === 0) return;
  context.entries.push({ metric, delta, reason, directiveId });
}

function changeStock(
  context: SeasonContext,
  metric: StockMetric,
  requestedDelta: number,
  reason: SeasonLedgerReason,
  directiveId: string | null = null,
): void {
  const before = context.nation.stocks[metric];
  const after = Math.max(0, before + requestedDelta);
  context.nation.stocks[metric] = after;
  ledger(context, metric, after - before, reason, directiveId);
}

function changeStability(
  context: SeasonContext,
  requestedDelta: number,
  reason: SeasonLedgerReason,
  directiveId: string | null = null,
): void {
  const before = context.nation.stability;
  const after = Math.max(
    NATION_STABILITY_MIN,
    Math.min(NATION_STABILITY_MAX, before + requestedDelta),
  );
  context.nation.stability = after;
  ledger(context, "stability", after - before, reason, directiveId);
}

function changeCulture(
  context: SeasonContext,
  delta: number,
  reason: SeasonLedgerReason,
  directiveId: string | null,
): void {
  context.nation.culture += delta;
  ledger(context, "culture", delta, reason, directiveId);
}

function chargeDirective(context: SeasonContext, directive: ActiveDirective): void {
  if (directive.seasonsRemaining !== directive.totalSeasons) return;
  const cost = NATION_DIRECTIVE_COSTS[directive.kind];
  changeStock(context, "food", -cost.food, "directiveCost", directive.id);
  changeStock(context, "materials", -cost.materials, "directiveCost", directive.id);
  changeStock(context, "wealth", -cost.wealth, "directiveCost", directive.id);
}

function applyCityDevelopment(
  nation: NationState,
  development: { cityId: string; delta: number } | null,
): void {
  if (development === null) return;
  nation.cities = nation.cities.map((city) =>
    city.cityId === development.cityId
      ? { ...city, developmentLevel: city.developmentLevel + development.delta }
      : city,
  );
}

function applyCompletion(context: SeasonContext, directive: ActiveDirective): void {
  const completion = completeDirective(directive, context.nation);
  context.nation.foodProduction += completion.foodProductionDelta;
  context.nation.materialProduction += completion.materialProductionDelta;
  changeStock(context, "food", completion.stockDeltas.food, "directiveEffect", directive.id);
  changeStock(
    context,
    "materials",
    completion.stockDeltas.materials,
    "directiveEffect",
    directive.id,
  );
  changeStock(context, "wealth", completion.stockDeltas.wealth, "directiveEffect", directive.id);
  changeStability(context, completion.stabilityDelta, "directiveEffect", directive.id);
  changeCulture(context, completion.cultureDelta, "directiveEffect", directive.id);
  applyCityDevelopment(context.nation, completion.cityDevelopment);
  context.completedDirectiveIds.push(directive.id);
}

function applyDirectives(context: SeasonContext): void {
  const remaining: ActiveDirective[] = [];
  for (const directive of context.nation.activeDirectives) {
    chargeDirective(context, directive);
    const next = { ...directive, seasonsRemaining: directive.seasonsRemaining - 1 };
    if (next.seasonsRemaining <= 0) applyCompletion(context, directive);
    else remaining.push(next);
  }
  context.nation.activeDirectives = remaining;
}

function tradeRouteCount(nationId: NationId, worldMap: WorldMap): number {
  const ownedCityIds = new Set(
    worldMap.cities.filter(({ polityId }) => polityId === nationId).map(({ id }) => id),
  );
  return worldMap.tradeRoutes.filter(({ cityIds }) =>
    cityIds.some((cityId) => ownedCityIds.has(cityId)),
  ).length;
}

function applyProduction(context: SeasonContext, worldMap: WorldMap): void {
  const food =
    context.nation.foodProduction * context.nation.population * NATION_FOOD_PRODUCTION_PER_CAPITA;
  changeStock(context, "food", food, "baseProduction");
  changeStock(context, "materials", context.nation.materialProduction, "baseProduction");
  const tradeIncome = tradeRouteCount(context.nation.id, worldMap) * NATION_TRADE_ROUTE_INCOME;
  changeStock(context, "wealth", tradeIncome, "tradeIncome");
}

function applyConsumption(context: SeasonContext): void {
  const demand = context.nation.population * NATION_FOOD_CONSUMPTION_PER_CAPITA;
  const consumed = Math.min(context.nation.stocks.food, demand);
  changeStock(context, "food", -consumed, "populationConsumption");
  context.famine = consumed < demand;
}

function distributePopulationLoss(nation: NationState, loss: number): void {
  const shares = nation.cities.map((city, index) => {
    const exact = nation.population === 0 ? 0 : (loss * city.population) / nation.population;
    return {
      index,
      base: Math.floor(exact),
      remainder: exact - Math.floor(exact),
      cityId: city.cityId,
    };
  });
  const allocated = shares.reduce((total, share) => total + share.base, 0);
  const remainderOrder = shares.toSorted(
    (left, right) => right.remainder - left.remainder || left.cityId.localeCompare(right.cityId),
  );
  for (let offset = 0; offset < loss - allocated; offset += 1) {
    const share = remainderOrder[offset];
    if (share !== undefined) share.base += 1;
  }
  nation.cities = nation.cities.map((city, index) => ({
    ...city,
    population: city.population - (shares[index]?.base ?? 0),
  }));
}

function famineLoss(context: SeasonContext): number {
  const isProtected = context.nation.activeDirectives.some(
    ({ kind }) => kind === "encourageStores",
  );
  const multiplier = isProtected ? NATION_ENCOURAGE_STORES_FAMINE_LOSS_MULTIPLIER : 1;
  return Math.min(
    context.nation.population,
    Math.ceil(context.nation.population * NATION_FAMINE_POPULATION_LOSS_RATE * multiplier),
  );
}

function applyFaminePopulation(context: SeasonContext): void {
  const loss = famineLoss(context);
  distributePopulationLoss(context.nation, loss);
  context.nation.population -= loss;
  ledger(context, "population", -loss, "famine");
}

function cityCapacity(nation: NationState, developmentLevel: number): number {
  const territoryShare =
    nation.cities.length === 0 ? 0 : nation.territoryCellCount / nation.cities.length;
  return (
    territoryShare * NATION_CITY_CAPACITY_PER_TERRITORY_CELL +
    developmentLevel * NATION_CITY_CAPACITY_PER_DEVELOPMENT_LEVEL
  );
}

function applyGrowth(context: SeasonContext): void {
  let growth = 0;
  context.nation.cities = context.nation.cities.map((city) => {
    const availableCapacity = Math.max(
      0,
      Math.floor(cityCapacity(context.nation, city.developmentLevel) - city.population),
    );
    const cityGrowth = Math.min(
      Math.floor(city.population * NATION_CITY_POPULATION_GROWTH_RATE),
      availableCapacity,
    );
    growth += cityGrowth;
    return { ...city, population: city.population + cityGrowth };
  });
  context.nation.population += growth;
  ledger(context, "population", growth, "growth");
}

function applyPopulation(context: SeasonContext): void {
  if (context.famine) applyFaminePopulation(context);
  else applyGrowth(context);
}

function activeAffinities(
  nation: NationState,
  polity: Polity,
  worldMap: WorldMap,
): { directiveId: string; affinity: number }[] {
  const options = listDirectiveOptions(nation, polity, worldMap);
  return nation.activeDirectives.map((directive) => ({
    directiveId: directive.id,
    affinity:
      options.find(
        ({ kind, targetCityId }) =>
          kind === directive.kind && targetCityId === directive.targetCityId,
      )?.affinity ?? 0,
  }));
}

function applyStabilityAndCulture(
  context: SeasonContext,
  polity: Polity,
  worldMap: WorldMap,
): void {
  if (context.famine) changeStability(context, -NATION_FAMINE_STABILITY_LOSS, "famine");
  const affinities = activeAffinities(context.nation, polity, worldMap);
  const affinityTotal = affinities.reduce((total, item) => total + item.affinity, 0);
  const baseDrift = context.famine ? NATION_STABILITY_DRIFT_MIN : NATION_STABILITY_DRIFT_MAX;
  const drift = Math.max(
    NATION_STABILITY_DRIFT_MIN,
    Math.min(NATION_STABILITY_DRIFT_MAX, baseDrift + affinityTotal),
  );
  changeStability(context, drift, "stabilityDrift");
  for (const { directiveId, affinity } of affinities) {
    const cultureGain = Math.max(0, affinity) * NATION_CULTURE_GAIN_PER_AFFINITY;
    changeCulture(context, cultureGain, "cultureAffinity", directiveId);
  }
}

function resolveNation(
  source: NationState,
  polity: Polity,
  worldMap: WorldMap,
  tick: number,
): { nation: NationState; report: SeasonReport } {
  const context: SeasonContext = {
    nation: cloneNation(source),
    entries: [],
    completedDirectiveIds: [],
    famine: false,
  };
  applyDirectives(context);
  applyProduction(context, worldMap);
  applyConsumption(context);
  applyPopulation(context);
  applyStabilityAndCulture(context, polity, worldMap);
  const report: SeasonReport = {
    year: nationYearOfTick(tick),
    season: nationSeasonOfTick(tick),
    entries: context.entries,
    completedDirectiveIds: context.completedDirectiveIds,
  };
  context.nation.lastReport = report;
  return { nation: context.nation, report };
}

export function resolveSeason(
  nations: readonly NationState[],
  polities: readonly Polity[],
  worldMap: WorldMap,
  tick: number,
): { nations: NationState[]; reports: Map<NationId, SeasonReport> } {
  const polityById = new Map(polities.map((polity) => [polity.id, polity]));
  const sorted = nations.toSorted((left, right) => left.id.localeCompare(right.id));
  const reports = new Map<NationId, SeasonReport>();
  const living = sorted
    .map((nation) => {
      const polity = polityById.get(nation.id);
      if (polity === undefined) throw new Error(`missing polity for nation ${nation.id}`);
      const result = resolveNation(nation, polity, worldMap, tick);
      reports.set(nation.id, result.report);
      return result.nation;
    })
    .filter(({ population }) => population > 0);
  const resolved = living.map((nation) => ({
    ...nation,
    prosperity: computeProsperity(nation, living),
  }));
  return { nations: resolved, reports };
}
