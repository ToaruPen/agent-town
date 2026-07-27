import type { NationState, Polity, SeasonReport, WorldHistory } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  advanceNationEngine,
  type NationEngineState,
  type QueuedDirective,
} from "../src/sim/nation/engine.js";

function nationFixture(overrides: Partial<NationState> = {}): NationState {
  return {
    id: "realm",
    controller: "player",
    autoPilot: false,
    stocks: { food: 1_000, materials: 1_000, wealth: 1_000 },
    cities: [{ cityId: "capital", population: 100, developmentLevel: 0 }],
    territoryCellCount: 3,
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

function historyFixture(): WorldHistory {
  const polity: Polity = {
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
  };
  return {
    startYear: -200,
    currentYear: 0,
    polities: [polity],
    events: [],
    landmarks: [],
    settlementOrigin: null,
    worldMap: {
      width: 3,
      height: 1,
      cells: [
        { terrain: "plains", polityId: "realm" },
        { terrain: "forest", polityId: "realm" },
        { terrain: "hills", polityId: "realm" },
      ],
      cities: [
        {
          id: "capital",
          name: "Capital",
          pos: { x: 0, y: 0 },
          polityId: "realm",
          isCapital: true,
          foundedByEventId: "found-realm",
        },
      ],
      tradeRoutes: [],
      borderChanges: [],
      settlementFrontierPos: { x: 0, y: 0 },
    },
  };
}

describe("advanceNationEngine", () => {
  it("increments one tick and resolves a season only on the exact boundary", () => {
    const history = historyFixture();
    const before: NationEngineState = { tick: 298, nations: [nationFixture()] };

    const ordinary = advanceNationEngine(before, history, []);
    const boundary = advanceNationEngine(ordinary.state, history, []);

    expect(ordinary.state.tick).toBe(299);
    expect(ordinary.reports.size).toBe(0);
    expect(boundary.state.tick).toBe(300);
    expect([...boundary.reports.keys()]).toEqual(["realm"]);
    expect(before).toEqual({ tick: 298, nations: [nationFixture()] });
  });

  it("charges an accepted directive in one season only across its whole lifetime", () => {
    const history = historyFixture();
    let state: NationEngineState = { tick: 299, nations: [nationFixture()] };
    let queued: QueuedDirective[] = [
      {
        id: "directive-accepted-at-250",
        nationId: "realm",
        kind: "clearFarmland",
        targetCityId: null,
        issuedAtTick: 250,
      },
    ];
    const reports: SeasonReport[] = [];

    for (let step = 0; step < 601; step += 1) {
      const result = advanceNationEngine(state, history, queued);
      state = result.state;
      if (result.consumedQueuedDirectiveIds.length > 0) queued = [];
      reports.push(...result.reports.values());
    }

    const chargedReports = reports.filter((report) =>
      report.entries.some(
        ({ reason, directiveId }) =>
          reason === "directiveCost" && directiveId === "directive-accepted-at-250",
      ),
    );
    const chargedMetrics = chargedReports.flatMap((report) =>
      report.entries
        .filter(
          ({ reason, directiveId }) =>
            reason === "directiveCost" && directiveId === "directive-accepted-at-250",
        )
        .map(({ metric }) => metric),
    );

    expect(chargedReports).toHaveLength(1);
    expect(chargedMetrics).toEqual(["food", "materials", "wealth"]);
    expect(reports.flatMap(({ completedDirectiveIds }) => completedDirectiveIds)).toContain(
      "directive-accepted-at-250",
    );
  });

  it("activates the chancellor choice for an agent nation at a boundary", () => {
    const history = historyFixture();
    const state: NationEngineState = {
      tick: 299,
      nations: [nationFixture({ controller: "agent", autoPilot: false })],
    };

    const result = advanceNationEngine(state, history, []);
    const directive = result.state.nations[0]?.activeDirectives[0];

    expect(directive).toMatchObject({
      id: "chancellor-realm-300",
      kind: "clearFarmland",
      issuedAtTick: 300,
      seasonsRemaining: 1,
      totalSeasons: 2,
    });
    expect(
      result.reports
        .get("realm")
        ?.entries.filter(({ reason }) => reason === "directiveCost")
        .map(({ directiveId }) => directiveId),
    ).toEqual(["chancellor-realm-300", "chancellor-realm-300", "chancellor-realm-300"]);
  });
});
