import type {
  DirectiveKind,
  DirectiveOption,
  NationState,
  Polity,
  SeasonReport,
  WorldMap,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { chooseDirective } from "../src/sim/nation/chancellor.js";
import { listDirectiveOptions } from "../src/sim/nation/directives.js";

function nationFixture(overrides: Partial<NationState> = {}): NationState {
  return {
    id: "realm",
    controller: "agent",
    autoPilot: true,
    stocks: { food: 10_000, materials: 10_000, wealth: 10_000 },
    cities: [{ cityId: "capital", population: 1_000, developmentLevel: 0 }],
    territoryCellCount: 3,
    population: 1_000,
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

function worldMapFixture(): WorldMap {
  return {
    width: 3,
    height: 1,
    cells: [
      { terrain: "plains", polityId: "realm" },
      { terrain: "forest", polityId: "realm" },
      { terrain: "hills", polityId: "realm" },
    ],
    cities: [],
    tradeRoutes: [],
    borderChanges: [],
    settlementFrontierPos: { x: 0, y: 0 },
  };
}

function reportFixture(entries: SeasonReport["entries"]): SeasonReport {
  return {
    year: 1,
    season: "spring",
    entries,
    completedDirectiveIds: [],
  };
}

function scoredOptions(
  nation: NationState,
  polity: Polity,
  affinities: Partial<Record<DirectiveKind, number>>,
): DirectiveOption[] {
  return listDirectiveOptions(nation, polity, worldMapFixture()).flatMap((option) => {
    const affinity = affinities[option.kind];
    return affinity === undefined ? [] : [{ ...option, affinity }];
  });
}

describe("chooseDirective", () => {
  it("returns null when empty stocks leave no unblocked option", () => {
    const nation = nationFixture({ stocks: { food: 0, materials: 0, wealth: 0 } });
    const polity = polityFixture();
    const options = listDirectiveOptions(nation, polity, worldMapFixture());

    expect(chooseDirective(nation, polity, options, null)).toBeNull();
  });

  it("makes commerce-led and faith-led polities choose different directives from the same state", () => {
    const nation = nationFixture();
    const commerce = polityFixture({
      values: [{ value: "commerce", weight: 1, changedByEventIds: [] }],
    });
    const faith = polityFixture({
      values: [{ value: "faith", weight: 1, changedByEventIds: [] }],
    });

    expect(
      chooseDirective(
        nation,
        commerce,
        listDirectiveOptions(nation, commerce, worldMapFixture()),
        null,
      )?.kind,
    ).toBe("growCity");
    expect(
      chooseDirective(nation, faith, listDirectiveOptions(nation, faith, worldMapFixture()), null)
        ?.kind,
    ).toBe("holdFestival");
  });

  it("breaks affinity ties by kind declaration order, independent of option order", () => {
    const nation = nationFixture();
    const polity = polityFixture();
    const options = listDirectiveOptions(nation, polity, worldMapFixture()).toReversed();

    expect(chooseDirective(nation, polity, options, null)?.kind).toBe("clearFarmland");
  });

  it("breaks same-kind ties by ascending target city id", () => {
    const nation = nationFixture({
      cities: [
        { cityId: "city-b", population: 500, developmentLevel: 0 },
        { cityId: "city-a", population: 500, developmentLevel: 0 },
      ],
    });
    const polity = polityFixture();
    const options = listDirectiveOptions(nation, polity, worldMapFixture()).filter(
      ({ kind }) => kind === "growCity",
    );

    expect(chooseDirective(nation, polity, options, null)?.targetCityId).toBe("city-a");
  });

  it("is repeatable and mutates none of its inputs", () => {
    const nation = nationFixture();
    const polity = polityFixture({
      values: [{ value: "commerce", weight: 1, changedByEventIds: [] }],
    });
    const options = listDirectiveOptions(nation, polity, worldMapFixture());
    const nationBefore = structuredClone(nation);
    const polityBefore = structuredClone(polity);
    const optionsBefore = structuredClone(options);

    const first = chooseDirective(nation, polity, options, null);
    const second = chooseDirective(nation, polity, options, null);

    expect(second).toEqual(first);
    expect(nation).toEqual(nationBefore);
    expect(polity).toEqual(polityBefore);
    expect(options).toEqual(optionsBefore);
  });

  it("prioritizes food directives when the last report sums to a food deficit", () => {
    const nation = nationFixture();
    const polity = polityFixture();
    const options = scoredOptions(nation, polity, {
      encourageStores: 0,
      holdFestival: 0.4,
    });
    const report = reportFixture([
      { metric: "food", delta: -10, reason: "populationConsumption", directiveId: null },
      { metric: "food", delta: 5, reason: "baseProduction", directiveId: null },
    ]);

    expect(chooseDirective(nation, polity, options, report)?.kind).toBe("encourageStores");
  });

  it("prioritizes material directives when the last report sums to a material deficit", () => {
    const nation = nationFixture();
    const polity = polityFixture();
    const options = scoredOptions(nation, polity, {
      openMine: 0,
      growCity: 0.4,
    });
    const report = reportFixture([
      { metric: "materials", delta: -5, reason: "directiveCost", directiveId: "mine-1" },
    ]);

    expect(chooseDirective(nation, polity, options, report)?.kind).toBe("openMine");
  });

  it("uses absolute stability below the threshold and ignores report stability deltas", () => {
    const polity = polityFixture();
    const lowNation = nationFixture({ stability: 39 });
    const thresholdNation = nationFixture({ stability: 40 });
    const report = reportFixture([
      { metric: "stability", delta: 20, reason: "stabilityDrift", directiveId: null },
    ]);
    const lowOptions = scoredOptions(lowNation, polity, {
      growCity: 0.4,
      holdFestival: 0,
    });
    const thresholdOptions = scoredOptions(thresholdNation, polity, {
      growCity: 0.4,
      holdFestival: 0,
    });

    expect(chooseDirective(lowNation, polity, lowOptions, report)?.kind).toBe("holdFestival");
    expect(chooseDirective(thresholdNation, polity, thresholdOptions, report)?.kind).toBe(
      "growCity",
    );
  });

  it("adds no deficit bonus in the first season", () => {
    const nation = nationFixture({ stability: 39 });
    const polity = polityFixture();
    const foodOptions = scoredOptions(nation, polity, {
      encourageStores: 0,
      holdFestival: 0.4,
    });
    const stabilityOptions = scoredOptions(nation, polity, {
      growCity: 0.4,
      holdFestival: 0,
    });

    expect(chooseDirective(nation, polity, foodOptions, null)?.kind).toBe("holdFestival");
    expect(chooseDirective(nation, polity, stabilityOptions, null)?.kind).toBe("growCity");
  });
});
