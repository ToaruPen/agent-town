import type {
  ActiveDirective,
  CulturalValue,
  NationState,
  Polity,
  SeasonLedgerEntry,
  SeasonMetric,
  WorldMap,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { resolveSeason } from "../src/sim/nation/season.js";

function nationFixture(id: string, overrides: Partial<NationState> = {}): NationState {
  return {
    id,
    controller: "agent",
    autoPilot: true,
    stocks: { food: 100, materials: 100, wealth: 100 },
    cities: [{ cityId: `${id}-capital`, population: 100, developmentLevel: 0 }],
    territoryCellCount: 10,
    population: 100,
    stability: 50,
    culture: 10,
    foodProduction: 10,
    materialProduction: 5,
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

function polityFixture(id: string, weights: Partial<Record<CulturalValue, number>> = {}): Polity {
  return {
    id,
    name: id,
    adjective: id,
    color: 0,
    values: Object.entries(weights).map(([value, weight]) => ({
      value: value as CulturalValue,
      weight,
      changedByEventIds: [],
    })),
    foundingMyth: "",
    formativeTraumaEventIds: [],
    taboo: "",
    ambition: "",
    governance: "",
  };
}

function worldMapFixture(): WorldMap {
  return {
    width: 2,
    height: 1,
    cells: [
      { terrain: "plains", polityId: "a" },
      { terrain: "plains", polityId: "b" },
    ],
    cities: [
      {
        id: "a-capital",
        name: "A",
        pos: { x: 0, y: 0 },
        polityId: "a",
        isCapital: true,
        foundedByEventId: "found-a",
      },
      {
        id: "b-capital",
        name: "B",
        pos: { x: 1, y: 0 },
        polityId: "b",
        isCapital: true,
        foundedByEventId: "found-b",
      },
    ],
    tradeRoutes: [
      {
        id: "route-a-b",
        cityIds: ["a-capital", "b-capital"],
        establishedByEventId: "trade-a-b",
      },
    ],
    borderChanges: [],
    settlementFrontierPos: { x: 0, y: 0 },
  };
}

function activeDirective(
  id: string,
  kind: ActiveDirective["kind"],
  seasonsRemaining: number,
  totalSeasons: number,
): ActiveDirective {
  return {
    id,
    kind,
    targetCityId: null,
    issuedAtTick: 100,
    seasonsRemaining,
    totalSeasons,
  };
}

function metricDelta(entries: SeasonLedgerEntry[], metric: SeasonMetric): number {
  return entries.reduce((total, entry) => total + (entry.metric === metric ? entry.delta : 0), 0);
}

describe("resolveSeason", () => {
  it("runs the fixed pipeline, charges a new directive once, and completes it before production", () => {
    const starting = nationFixture("a", {
      activeDirectives: [activeDirective("farmland-1", "clearFarmland", 2, 2)],
    });
    const polity = polityFixture("a", { mutualAid: 1 });

    const first = resolveSeason([starting], [polity], worldMapFixture(), 300);
    const firstNation = first.nations[0];
    const firstReport = first.reports.get("a");
    if (firstNation === undefined || firstReport === undefined) throw new Error("missing nation");

    expect(firstNation.stocks.food).toBeCloseTo(75.1);
    expect(firstNation.stocks.materials).toBe(75);
    expect(firstNation.stocks.wealth).toBe(100);
    expect(firstNation.population).toBe(101);
    expect(firstNation.stability).toBe(51);
    expect(firstNation.culture).toBeCloseTo(10.3);
    expect(firstNation.activeDirectives).toEqual([
      {
        ...activeDirective("farmland-1", "clearFarmland", 2, 2),
        seasonsRemaining: 1,
      },
    ]);
    expect(firstReport).toMatchObject({
      year: 1,
      season: "summer",
      completedDirectiveIds: [],
    });
    expect(
      firstReport.entries.map(({ metric, reason, directiveId }) => [metric, reason, directiveId]),
    ).toEqual([
      ["food", "directiveCost", "farmland-1"],
      ["materials", "directiveCost", "farmland-1"],
      ["wealth", "directiveCost", "farmland-1"],
      ["food", "baseProduction", null],
      ["materials", "baseProduction", null],
      ["wealth", "tradeIncome", null],
      ["food", "populationConsumption", null],
      ["population", "growth", null],
      ["stability", "stabilityDrift", null],
      ["culture", "cultureAffinity", "farmland-1"],
    ]);

    const second = resolveSeason(first.nations, [polity], worldMapFixture(), 600);
    const secondNation = second.nations[0];
    const secondReport = second.reports.get("a");
    if (secondNation === undefined || secondReport === undefined) throw new Error("missing nation");

    expect(secondNation.foodProduction).toBe(35);
    expect(secondNation.activeDirectives).toEqual([]);
    expect(secondReport.completedDirectiveIds).toEqual(["farmland-1"]);
    expect(
      secondReport.entries.find(
        ({ metric, reason }) => metric === "food" && reason === "baseProduction",
      )?.delta,
    ).toBeCloseTo(0.3535);
    expect(secondReport.entries.some(({ reason }) => reason === "directiveCost")).toBe(false);
  });

  it("makes every ledger metric sum to the corresponding observed state change", () => {
    const starting = nationFixture("a", {
      activeDirectives: [activeDirective("festival-1", "holdFestival", 1, 1)],
      stability: 98,
      culture: 20,
    });
    const result = resolveSeason(
      [starting],
      [polityFixture("a", { faith: 1 })],
      worldMapFixture(),
      300,
    );
    const nation = result.nations[0];
    const report = result.reports.get("a");
    if (nation === undefined || report === undefined) throw new Error("missing nation");
    const observed = {
      food: nation.stocks.food - starting.stocks.food,
      materials: nation.stocks.materials - starting.stocks.materials,
      wealth: nation.stocks.wealth - starting.stocks.wealth,
      population: nation.population - starting.population,
      stability: nation.stability - starting.stability,
      culture: nation.culture - starting.culture,
    };

    for (const metric of [
      "food",
      "materials",
      "wealth",
      "population",
      "stability",
      "culture",
    ] as const) {
      expect(metricDelta(report.entries, metric)).toBeCloseTo(observed[metric]);
    }
    expect(report.completedDirectiveIds).toEqual(["festival-1"]);
    expect(nation.stability).toBe(100);
    expect(nation.culture).toBe(25);
  });

  it("is invariant to input order and returns nations in ascending NationId order", () => {
    const a = nationFixture("a");
    const b = nationFixture("b", {
      cities: [{ cityId: "b-capital", population: 200, developmentLevel: 0 }],
      population: 200,
    });
    const polities = [polityFixture("b"), polityFixture("a")];
    const worldMap = worldMapFixture();

    const forward = resolveSeason([a, b], polities, worldMap, 300);
    const reverse = resolveSeason([b, a], polities, worldMap, 300);

    expect(forward.nations.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(reverse.nations).toEqual(forward.nations);
    expect([...reverse.reports]).toEqual([...forward.reports]);
  });

  it("does not make one nation's prosperity depend on whether a rival is present", () => {
    const a = nationFixture("a");
    const b = nationFixture("b");
    const polities = [polityFixture("a"), polityFixture("b")];
    const worldMap = worldMapFixture();

    const withRival = resolveSeason([a, b], polities, worldMap, 300).nations.find(
      ({ id }) => id === "a",
    );
    const alone = resolveSeason([a], polities, worldMap, 300).nations[0];

    expect(alone?.prosperity).toEqual(withRival?.prosperity);
  });

  it("removes a nation from live state when famine reduces its population to zero", () => {
    const dying = nationFixture("a", {
      stocks: { food: 0, materials: 0, wealth: 0 },
      cities: [{ cityId: "a-capital", population: 1, developmentLevel: 0 }],
      population: 1,
      stability: 1,
      culture: 0,
      foodProduction: 0,
      materialProduction: 0,
    });

    const result = resolveSeason([dying], [polityFixture("a")], worldMapFixture(), 300);

    expect(result.nations).toEqual([]);
    expect(result.reports.get("a")?.entries).toContainEqual({
      metric: "population",
      delta: -1,
      reason: "famine",
      directiveId: null,
    });
  });

  it("applies famine losses and halves population loss while encourageStores remains active", () => {
    const base = nationFixture("a", {
      stocks: { food: 0, materials: 0, wealth: 0 },
      cities: [
        { cityId: "a-capital", population: 120, developmentLevel: 0 },
        { cityId: "a-harbor", population: 80, developmentLevel: 0 },
      ],
      territoryCellCount: 0,
      population: 200,
      stability: 50,
      culture: 0,
      foodProduction: 0,
      materialProduction: 0,
    });
    const protectedNation = nationFixture("a", {
      ...base,
      stocks: { food: 10, materials: 10, wealth: 20 },
      activeDirectives: [activeDirective("stores-1", "encourageStores", 2, 2)],
    });
    const polity = polityFixture("a");
    const worldMap = worldMapFixture();

    const unprotected = resolveSeason([base], [polity], worldMap, 300);
    const protectedResult = resolveSeason([protectedNation], [polity], worldMap, 300);
    const unprotectedNation = unprotected.nations[0];
    const afterProtected = protectedResult.nations[0];
    const protectedReport = protectedResult.reports.get("a");
    if (
      unprotectedNation === undefined ||
      afterProtected === undefined ||
      protectedReport === undefined
    )
      throw new Error("missing nation");

    expect(unprotectedNation.population).toBe(190);
    expect(afterProtected.population).toBe(195);
    expect(afterProtected.cities.map(({ population }) => population)).toEqual([117, 78]);
    expect(afterProtected.stocks.food).toBe(0);
    expect(afterProtected.stability).toBe(43);
    expect(protectedReport.entries.filter(({ reason }) => reason === "famine")).toEqual([
      { metric: "population", delta: -5, reason: "famine", directiveId: null },
      { metric: "stability", delta: -5, reason: "famine", directiveId: null },
    ]);

    const recovered = resolveSeason(protectedResult.nations, [polity], worldMap, 600);
    const recoveredNation = recovered.nations[0];
    const recoveredReport = recovered.reports.get("a");
    if (recoveredNation === undefined || recoveredReport === undefined)
      throw new Error("missing nation");

    expect(recoveredNation.population).toBe(195);
    expect(recoveredNation.stocks.food).toBeCloseTo(40.25);
    expect(recoveredReport.completedDirectiveIds).toEqual(["stores-1"]);
    expect(recoveredReport.entries.some(({ reason }) => reason === "famine")).toBe(false);
  });
});
