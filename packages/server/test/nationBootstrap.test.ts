import type {
  CulturalValue,
  HistoryEffect,
  Polity,
  WorldCity,
  WorldHistory,
  WorldMapCell,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { generateWorldHistory } from "../src/sim/historyGen.js";
import { bootstrapNations } from "../src/sim/nation/bootstrap.js";

function polity(id: string, weights: Partial<Record<CulturalValue, number>> = {}): Polity {
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

function city(cityId: string, polityId: string, isCapital: boolean): WorldCity {
  return {
    id: cityId,
    name: cityId,
    pos: { x: 0, y: 0 },
    polityId,
    isCapital,
    foundedByEventId: `founding-${polityId}`,
  };
}

function historyFixture(
  polities: Polity[],
  cells: WorldMapCell[],
  cities: WorldCity[],
  populationEffects: Readonly<Record<string, number[]>>,
): WorldHistory {
  return {
    startYear: -200,
    currentYear: 0,
    polities,
    events: Object.entries(populationEffects).flatMap(([targetId, deltas]) =>
      deltas.map((delta, index) => ({
        id: `population-${targetId}-${index}`,
        year: -200 + index,
        kind: "founding" as const,
        title: "",
        summary: "",
        polityIds: [targetId],
        causeIds: [],
        effects: [{ kind: "population", targetId, delta } satisfies HistoryEffect],
      })),
    ),
    landmarks: [],
    settlementOrigin: null,
    worldMap: {
      width: cells.length,
      height: 1,
      cells,
      cities,
      tradeRoutes: [],
      borderChanges: [],
      settlementFrontierPos: { x: 0, y: 0 },
    },
  };
}

function cellsFor(polityId: string, terrains: WorldMapCell["terrain"][]): WorldMapCell[] {
  return terrains.map((terrain) => ({ terrain, polityId }));
}

describe("bootstrapNations", () => {
  it("returns deeply identical nations for the same history", () => {
    const history = generateWorldHistory(42);

    expect(bootstrapNations(history, null)).toEqual(bootstrapNations(history, null));
  });

  it("changes the bootstrapped nations when the generated seed changes", () => {
    const first = bootstrapNations(generateWorldHistory(42), null);
    const second = bootstrapNations(generateWorldHistory(43), null);

    expect(first).not.toEqual(second);
  });

  it("excludes dead polities and assigns the requested player controller", () => {
    const history = historyFixture(
      [polity("alive"), polity("dead")],
      [{ terrain: "plains", polityId: "alive" }],
      [city("capital-alive", "alive", true), city("capital-dead", "dead", true)],
      { alive: [10], dead: [10] },
    );

    const nations = bootstrapNations(history, "alive");

    expect(nations).toEqual([
      expect.objectContaining({
        id: "alive",
        controller: "player",
        autoPilot: true,
      }),
    ]);
    expect(nations[0]?.prosperity.total).toBeGreaterThan(0);
  });

  it("normalizes every nation against the same bootstrapped field maxima", () => {
    const history = historyFixture(
      [polity("smaller"), polity("larger", { commerce: 1, knowledge: 1 })],
      [...cellsFor("smaller", ["plains"]), ...cellsFor("larger", ["plains", "forest"])],
      [city("smaller-capital", "smaller", true), city("larger-capital", "larger", true)],
      { smaller: [10], larger: [20] },
    );

    const nations = bootstrapNations(history, null);
    const smaller = nations.find(({ id }) => id === "smaller");
    const larger = nations.find(({ id }) => id === "larger");

    expect(smaller?.prosperity.population).toBeCloseTo(Math.log1p(1_000) / Math.log1p(2_000));
    expect(smaller?.prosperity.production).toBeCloseTo(Math.log1p(0.45) / Math.log1p(1.85));
    expect(smaller?.prosperity.wealth).toBeCloseTo(Math.log1p(2) / Math.log1p(16));
    expect(smaller?.prosperity.stability).toBeCloseTo(Math.log1p(42) / Math.log1p(44));
    expect(smaller?.prosperity.culture).toBeCloseTo(Math.log1p(20) / Math.log1p(40));
    expect(larger?.prosperity).toMatchObject({
      population: 1,
      production: 1,
      wealth: 1,
      stability: 1,
      culture: 1,
    });
  });

  it("excludes a polity with territory but no population from live nations", () => {
    const history = historyFixture(
      [polity("survivor"), polity("extinct")],
      [
        { terrain: "plains", polityId: "survivor" },
        { terrain: "forest", polityId: "extinct" },
      ],
      [city("survivor-capital", "survivor", true), city("extinct-capital", "extinct", true)],
      { survivor: [10], extinct: [] },
    );

    expect(bootstrapNations(history, null).map(({ id }) => id)).toEqual(["survivor"]);
  });

  it("folds population effects and conserves the scaled total across a capital-weighted split", () => {
    const history = historyFixture(
      [polity("realm")],
      cellsFor("realm", ["plains"]),
      [
        city("town-b", "realm", false),
        city("capital", "realm", true),
        city("town-a", "realm", false),
      ],
      { realm: [100, -10] },
    );

    const [nation] = bootstrapNations(history, null);

    expect(nation?.population).toBe(9_000);
    expect(nation?.stability).toBe(58);
    expect(nation?.cities).toEqual([
      { cityId: "town-b", population: 2_250, developmentLevel: 0 },
      { cityId: "capital", population: 4_500, developmentLevel: 0 },
      { cityId: "town-a", population: 2_250, developmentLevel: 0 },
    ]);
    expect(nation?.cities.reduce((total, item) => total + item.population, 0)).toBe(
      nation?.population,
    );
  });

  it("derives food and material production from owned terrain", () => {
    const history = historyFixture(
      [polity("fertile"), polity("rugged")],
      [...cellsFor("fertile", ["plains", "forest"]), ...cellsFor("rugged", ["hills", "mountains"])],
      [city("fertile-capital", "fertile", true), city("rugged-capital", "rugged", true)],
      { fertile: [10], rugged: [10] },
    );

    const nations = bootstrapNations(history, null);
    const fertile = nations.find(({ id }) => id === "fertile");
    const rugged = nations.find(({ id }) => id === "rugged");

    expect(fertile).toMatchObject({ foodProduction: 3, materialProduction: 1.25 });
    expect(rugged).toMatchObject({ foodProduction: 0.75, materialProduction: 3.5 });
  });

  it("turns the specified cultural values into distinct starting stocks", () => {
    const polities = [
      polity("food", { mutualAid: 1, stewardship: 1 }),
      polity("wealth", { commerce: 1 }),
      polity("materials", { order: 1, valor: 1 }),
    ];
    const history = historyFixture(
      polities,
      polities.flatMap(({ id }) => cellsFor(id, ["plains", "forest"])),
      polities.map(({ id }) => city(`${id}-capital`, id, true)),
      { food: [10], wealth: [10], materials: [10] },
    );

    const stocks = Object.fromEntries(
      bootstrapNations(history, null).map((nation) => [nation.id, nation.stocks]),
    );

    expect(stocks).toEqual({
      food: { food: 24, materials: 5, wealth: 4 },
      wealth: { food: 12, materials: 5, wealth: 16 },
      materials: { food: 12, materials: 10, wealth: 4 },
    });
  });

  it("derives distinct initial stability and culture with headroom in both directions", () => {
    const history = historyFixture(
      [polity("scarred", { faith: 0.5 }), polity("flourishing", { commerce: 1, knowledge: 0.8 })],
      [...cellsFor("scarred", ["plains"]), ...cellsFor("flourishing", ["plains"])],
      [city("scarred-capital", "scarred", true), city("flourishing-capital", "flourishing", true)],
      { scarred: [20], flourishing: [100] },
    );

    const byId = Object.fromEntries(
      bootstrapNations(history, null).map(({ id, stability, culture }) => [
        id,
        { stability, culture },
      ]),
    );

    expect(byId).toEqual({
      scarred: { stability: 44, culture: 25 },
      flourishing: { stability: 60, culture: 38 },
    });
    for (const { stability, culture } of Object.values(byId)) {
      expect(stability).toBeGreaterThan(0);
      expect(stability).toBeLessThan(100);
      expect(culture).toBeGreaterThan(0);
      expect(culture).toBeLessThan(100);
    }
  });
});
