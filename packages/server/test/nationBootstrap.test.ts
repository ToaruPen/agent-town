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

    expect(bootstrapNations(history, "alive")).toEqual([
      expect.objectContaining({
        id: "alive",
        controller: "player",
        autoPilot: true,
        prosperity: {
          population: 0,
          production: 0,
          wealth: 0,
          stability: 0,
          culture: 0,
          total: 0,
        },
      }),
    ]);
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
    expect(nation?.stability).toBe(90);
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
});
