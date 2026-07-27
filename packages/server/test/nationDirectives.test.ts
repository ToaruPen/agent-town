import type {
  ActiveDirective,
  DirectiveKind,
  NationState,
  Polity,
  WorldMap,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { generateWorldHistory } from "../src/sim/historyGen.js";
import { bootstrapNations } from "../src/sim/nation/bootstrap.js";
import { completeDirective, listDirectiveOptions } from "../src/sim/nation/directives.js";

function nationFixture(overrides: Partial<NationState> = {}): NationState {
  return {
    id: "realm",
    controller: "agent",
    autoPilot: true,
    stocks: { food: 10_000, materials: 10_000, wealth: 10_000 },
    cities: [
      { cityId: "capital", population: 1_000, developmentLevel: 0 },
      { cityId: "harbor", population: 500, developmentLevel: 0 },
    ],
    territoryCellCount: 3,
    population: 1_500,
    stability: 70,
    culture: 0,
    foodProduction: 20,
    materialProduction: 10,
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

function polityFixture(overrides: Partial<Polity> = {}): Polity {
  return {
    id: "realm",
    name: "Realm",
    adjective: "Realm",
    color: 0,
    values: [],
    foundingMyth: "",
    formativeTraumaEventIds: [],
    taboo: "",
    ambition: "",
    governance: "",
    ...overrides,
  };
}

function worldMapFixture(
  cells: WorldMap["cells"] = [
    { terrain: "plains", polityId: "realm" },
    { terrain: "forest", polityId: "realm" },
    { terrain: "hills", polityId: "realm" },
  ],
): WorldMap {
  return {
    width: cells.length,
    height: 1,
    cells,
    cities: [],
    tradeRoutes: [],
    borderChanges: [],
    settlementFrontierPos: { x: 0, y: 0 },
  };
}

function activeDirective(kind: DirectiveKind, targetCityId: string | null = null): ActiveDirective {
  return {
    id: `${kind}-1`,
    kind,
    targetCityId,
    issuedAtTick: 300,
    seasonsRemaining: 0,
    totalSeasons: 1,
  };
}

describe("listDirectiveOptions", () => {
  it("lists every kind every season and expands growCity once per owned city", () => {
    const options = listDirectiveOptions(nationFixture(), polityFixture(), worldMapFixture());

    expect(options.map(({ kind, targetCityId }) => [kind, targetCityId])).toEqual([
      ["clearFarmland", null],
      ["developTimber", null],
      ["openMine", null],
      ["growCity", "capital"],
      ["growCity", "harbor"],
      ["encourageStores", null],
      ["holdFestival", null],
    ]);
    expect(options.every(({ blockedReason }) => blockedReason === null)).toBe(true);
  });

  it("exposes the configured one-time costs and completion durations for each kind", () => {
    const options = listDirectiveOptions(nationFixture(), polityFixture(), worldMapFixture());
    const byKind = Object.fromEntries(
      options.map(({ kind, cost, seasons }) => [kind, { cost, seasons }]),
    );

    expect(byKind).toEqual({
      clearFarmland: {
        cost: { food: 20, materials: 30, wealth: 10 },
        seasons: 2,
      },
      developTimber: {
        cost: { food: 10, materials: 20, wealth: 15 },
        seasons: 2,
      },
      openMine: {
        cost: { food: 15, materials: 50, wealth: 30 },
        seasons: 3,
      },
      growCity: {
        cost: { food: 30, materials: 40, wealth: 50 },
        seasons: 3,
      },
      encourageStores: {
        cost: { food: 10, materials: 10, wealth: 20 },
        seasons: 2,
      },
      holdFestival: {
        cost: { food: 20, materials: 0, wealth: 40 },
        seasons: 1,
      },
    });
  });

  it("uses signed cultural coefficients, defaults missing weights to zero, and clamps affinity", () => {
    const stewardshipOptions = listDirectiveOptions(
      nationFixture(),
      polityFixture({
        values: [{ value: "stewardship", weight: 0.8, changedByEventIds: [] }],
      }),
      worldMapFixture(),
    );
    const festivalOptions = listDirectiveOptions(
      nationFixture(),
      polityFixture({
        values: [
          { value: "faith", weight: 1, changedByEventIds: [] },
          { value: "kinship", weight: 1, changedByEventIds: [] },
        ],
      }),
      worldMapFixture(),
    );

    expect(stewardshipOptions.find(({ kind }) => kind === "developTimber")?.affinity).toBe(-0.8);
    expect(stewardshipOptions.find(({ kind }) => kind === "holdFestival")?.affinity).toBe(0);
    expect(festivalOptions.find(({ kind }) => kind === "holdFestival")?.affinity).toBe(1);
  });

  it.each([
    {
      name: "taboo",
      kind: "developTimber",
      nation: nationFixture(),
      polity: polityFixture({
        values: [{ value: "stewardship", weight: 0.75, changedByEventIds: [] }],
      }),
      worldMap: worldMapFixture(),
      want: "taboo",
    },
    {
      name: "missing terrain",
      kind: "openMine",
      nation: nationFixture(),
      polity: polityFixture(),
      worldMap: worldMapFixture([
        { terrain: "plains", polityId: "realm" },
        { terrain: "hills", polityId: "other" },
      ]),
      want: "missingTerrain",
    },
    {
      name: "missing forest terrain",
      kind: "developTimber",
      nation: nationFixture(),
      polity: polityFixture(),
      worldMap: worldMapFixture([{ terrain: "plains", polityId: "realm" }]),
      want: "missingTerrain",
    },
    {
      name: "city at maximum development",
      kind: "growCity",
      nation: nationFixture({
        cities: [{ cityId: "capital", population: 1_000, developmentLevel: 5 }],
      }),
      polity: polityFixture(),
      worldMap: worldMapFixture(),
      want: "cityAtMaxDevelopment",
    },
    {
      name: "same directive already active",
      kind: "openMine",
      nation: nationFixture({
        activeDirectives: [
          {
            id: "mine-1",
            kind: "openMine",
            targetCityId: null,
            issuedAtTick: 0,
            seasonsRemaining: 2,
            totalSeasons: 3,
          },
        ],
      }),
      polity: polityFixture(),
      worldMap: worldMapFixture(),
      want: "alreadyActive",
    },
    {
      name: "insufficient food",
      kind: "clearFarmland",
      nation: nationFixture({ stocks: { food: 19, materials: 30, wealth: 10 } }),
      polity: polityFixture(),
      worldMap: worldMapFixture(),
      want: "insufficientFood",
    },
    {
      name: "insufficient materials",
      kind: "clearFarmland",
      nation: nationFixture({ stocks: { food: 20, materials: 29, wealth: 10 } }),
      polity: polityFixture(),
      worldMap: worldMapFixture(),
      want: "insufficientMaterials",
    },
    {
      name: "insufficient wealth",
      kind: "clearFarmland",
      nation: nationFixture({ stocks: { food: 20, materials: 30, wealth: 9 } }),
      polity: polityFixture(),
      worldMap: worldMapFixture(),
      want: "insufficientWealth",
    },
  ])("reports $name without omitting the option", ({ kind, nation, polity, worldMap, want }) => {
    const option = listDirectiveOptions(nation, polity, worldMap).find(
      (item) => item.kind === kind,
    );

    expect(option?.blockedReason).toBe(want);
  });

  it.each([
    {
      name: "taboo before terrain, active status, and stocks",
      kind: "developTimber",
      nation: nationFixture({
        stocks: { food: 0, materials: 0, wealth: 0 },
        activeDirectives: [
          {
            id: "timber-1",
            kind: "developTimber",
            targetCityId: null,
            issuedAtTick: 0,
            seasonsRemaining: 1,
            totalSeasons: 2,
          },
        ],
      }),
      polity: polityFixture({
        values: [{ value: "stewardship", weight: 0.8, changedByEventIds: [] }],
      }),
      worldMap: worldMapFixture([{ terrain: "plains", polityId: "realm" }]),
      want: "taboo",
    },
    {
      name: "terrain before active status and stocks",
      kind: "openMine",
      nation: nationFixture({
        stocks: { food: 0, materials: 0, wealth: 0 },
        activeDirectives: [
          {
            id: "mine-1",
            kind: "openMine",
            targetCityId: null,
            issuedAtTick: 0,
            seasonsRemaining: 1,
            totalSeasons: 3,
          },
        ],
      }),
      polity: polityFixture(),
      worldMap: worldMapFixture([{ terrain: "plains", polityId: "realm" }]),
      want: "missingTerrain",
    },
    {
      name: "city cap before active status and stocks",
      kind: "growCity",
      nation: nationFixture({
        stocks: { food: 0, materials: 0, wealth: 0 },
        cities: [{ cityId: "capital", population: 1_000, developmentLevel: 5 }],
        activeDirectives: [
          {
            id: "city-1",
            kind: "growCity",
            targetCityId: "capital",
            issuedAtTick: 0,
            seasonsRemaining: 1,
            totalSeasons: 3,
          },
        ],
      }),
      polity: polityFixture(),
      worldMap: worldMapFixture(),
      want: "cityAtMaxDevelopment",
    },
    {
      name: "active status before stock checks",
      kind: "encourageStores",
      nation: nationFixture({
        stocks: { food: 0, materials: 0, wealth: 0 },
        activeDirectives: [
          {
            id: "stores-1",
            kind: "encourageStores",
            targetCityId: null,
            issuedAtTick: 0,
            seasonsRemaining: 1,
            totalSeasons: 2,
          },
        ],
      }),
      polity: polityFixture(),
      worldMap: worldMapFixture(),
      want: "alreadyActive",
    },
    {
      name: "food before materials and wealth",
      kind: "clearFarmland",
      nation: nationFixture({ stocks: { food: 0, materials: 0, wealth: 0 } }),
      polity: polityFixture(),
      worldMap: worldMapFixture(),
      want: "insufficientFood",
    },
    {
      name: "materials before wealth",
      kind: "clearFarmland",
      nation: nationFixture({ stocks: { food: 20, materials: 0, wealth: 0 } }),
      polity: polityFixture(),
      worldMap: worldMapFixture(),
      want: "insufficientMaterials",
    },
  ])("uses fixed precedence: $name", ({ kind, nation, polity, worldMap, want }) => {
    const option = listDirectiveOptions(nation, polity, worldMap).find(
      (item) => item.kind === kind,
    );

    expect(option?.blockedReason).toBe(want);
  });

  it("evaluates city cap and active status independently for each growCity target", () => {
    const nation = nationFixture({
      cities: [
        { cityId: "capital", population: 1_000, developmentLevel: 0 },
        { cityId: "harbor", population: 500, developmentLevel: 5 },
      ],
      activeDirectives: [
        {
          id: "city-1",
          kind: "growCity",
          targetCityId: "capital",
          issuedAtTick: 0,
          seasonsRemaining: 1,
          totalSeasons: 3,
        },
      ],
    });

    expect(
      listDirectiveOptions(nation, polityFixture(), worldMapFixture())
        .filter(({ kind }) => kind === "growCity")
        .map(({ targetCityId, blockedReason }) => [targetCityId, blockedReason]),
    ).toEqual([
      ["capital", "alreadyActive"],
      ["harbor", "cityAtMaxDevelopment"],
    ]);
  });

  it("accepts owned mountains as valid mine terrain", () => {
    const option = listDirectiveOptions(
      nationFixture(),
      polityFixture(),
      worldMapFixture([{ terrain: "mountains", polityId: "realm" }]),
    ).find(({ kind }) => kind === "openMine");

    expect(option?.blockedReason).toBeNull();
  });

  it("makes a generated moss-guardian polity refuse timber development through affinity", () => {
    const history = generateWorldHistory(7);
    const polity = history.polities.find(({ name }) => name === "苔守諸領");
    const nation = bootstrapNations(history, null).find(({ id }) => id === polity?.id);
    if (polity === undefined || nation === undefined)
      throw new Error("seed 7 must retain 苔守諸領");

    const option = listDirectiveOptions(nation, polity, history.worldMap).find(
      ({ kind }) => kind === "developTimber",
    );

    expect(option).toMatchObject({ affinity: -0.8, blockedReason: "taboo" });
  });
});

describe("completeDirective", () => {
  it.each([
    {
      kind: "clearFarmland",
      targetCityId: null,
      want: {
        foodProductionDelta: 10,
        materialProductionDelta: 0,
        stockDeltas: { food: 0, materials: 0, wealth: 0 },
        stabilityDelta: 0,
        cultureDelta: 0,
        cityDevelopment: null,
      },
    },
    {
      kind: "developTimber",
      targetCityId: null,
      want: {
        foodProductionDelta: 0,
        materialProductionDelta: 8,
        stockDeltas: { food: 0, materials: 0, wealth: 0 },
        stabilityDelta: 0,
        cultureDelta: 0,
        cityDevelopment: null,
      },
    },
    {
      kind: "openMine",
      targetCityId: null,
      want: {
        foodProductionDelta: 0,
        materialProductionDelta: 16,
        stockDeltas: { food: 0, materials: 0, wealth: 0 },
        stabilityDelta: 0,
        cultureDelta: 0,
        cityDevelopment: null,
      },
    },
    {
      kind: "growCity",
      targetCityId: "capital",
      want: {
        foodProductionDelta: 0,
        materialProductionDelta: 0,
        stockDeltas: { food: 0, materials: 0, wealth: 0 },
        stabilityDelta: 0,
        cultureDelta: 0,
        cityDevelopment: { cityId: "capital", delta: 1 },
      },
    },
    {
      kind: "encourageStores",
      targetCityId: null,
      want: {
        foodProductionDelta: 0,
        materialProductionDelta: 0,
        stockDeltas: { food: 50, materials: 0, wealth: 0 },
        stabilityDelta: 0,
        cultureDelta: 0,
        cityDevelopment: null,
      },
    },
    {
      kind: "holdFestival",
      targetCityId: null,
      want: {
        foodProductionDelta: 0,
        materialProductionDelta: 0,
        stockDeltas: { food: 0, materials: 0, wealth: 0 },
        stabilityDelta: 8,
        cultureDelta: 5,
        cityDevelopment: null,
      },
    },
  ] as const)(
    "describes the $kind completion effect without mutating inputs",
    ({ kind, targetCityId, want }) => {
      const directive = activeDirective(kind, targetCityId);
      const nation = nationFixture();
      const directiveBefore = structuredClone(directive);
      const nationBefore = structuredClone(nation);

      expect(completeDirective(directive, nation)).toEqual(want);
      expect(directive).toEqual(directiveBefore);
      expect(nation).toEqual(nationBefore);
    },
  );

  it("returns no city-development increase when the target is already at the cap", () => {
    const nation = nationFixture({
      cities: [{ cityId: "capital", population: 1_000, developmentLevel: 5 }],
    });

    expect(
      completeDirective(activeDirective("growCity", "capital"), nation).cityDevelopment,
    ).toEqual({
      cityId: "capital",
      delta: 0,
    });
  });
});
