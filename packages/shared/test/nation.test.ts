import {
  CLOCK_BROADCAST_MS,
  DEFAULT_SPEED,
  type DirectiveOption,
  NATION_TICKS_PER_SEASON,
  NATION_TICKS_PER_YEAR,
  type NationWorldState,
  SEASONS,
  SPEED_MULTIPLIERS,
  type WorldCellChange,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { makeWorldMapFixture } from "./worldMapFixture.js";

describe("nation contracts", () => {
  it("exports the frozen nation pacing constants", () => {
    expect(NATION_TICKS_PER_SEASON).toBe(300);
    expect(NATION_TICKS_PER_YEAR).toBe(1_200);
    expect(SPEED_MULTIPLIERS).toEqual([0, 1, 2, 4, 8]);
    expect(DEFAULT_SPEED).toBe(1);
    expect(CLOCK_BROADCAST_MS).toBe(1_000);
  });

  it("exports complete nation state, directive, and cell-change contracts", () => {
    const option: DirectiveOption = {
      kind: "clearFarmland",
      targetCityId: "city-1",
      cost: { food: 1, materials: 2, wealth: 3 },
      seasons: 1,
      affinity: 0.5,
      blockedReason: null,
    };
    const state: NationWorldState = {
      tick: 0,
      year: 1,
      season: SEASONS[0],
      speed: DEFAULT_SPEED,
      history: {
        startYear: -200,
        currentYear: 0,
        polities: [],
        events: [],
        landmarks: [],
        settlementOrigin: null,
        worldMap: makeWorldMapFixture(),
      },
      nations: [
        {
          id: "polity-1",
          controller: "player",
          autoPilot: false,
          stocks: { food: 10, materials: 20, wealth: 30 },
          cities: [{ cityId: "city-1", population: 100, developmentLevel: 1 }],
          territoryCellCount: 12,
          population: 100,
          stability: 75,
          culture: 4,
          foodProduction: 8,
          materialProduction: 6,
          activeDirectives: [
            {
              id: "directive-1",
              kind: option.kind,
              targetCityId: option.targetCityId,
              issuedAtTick: 0,
              seasonsRemaining: 1,
              totalSeasons: option.seasons,
            },
          ],
          prosperity: {
            population: 100,
            production: 80,
            wealth: 60,
            stability: 75,
            culture: 40,
            total: 76,
          },
          lastReport: {
            year: 1,
            season: "spring",
            entries: [
              {
                metric: "food",
                delta: 8,
                reason: "baseProduction",
                directiveId: null,
              },
            ],
            completedDirectiveIds: [],
          },
        },
      ],
      playerNationId: "polity-1",
    };
    const change: WorldCellChange = { index: 7, polityId: "polity-1" };

    expect(state.nations[0]?.activeDirectives[0]?.kind).toBe(option.kind);
    expect(state.nations[0]?.activeDirectives[0]?.totalSeasons).toBe(option.seasons);
    expect(state.nations[0]?.lastReport?.entries[0]?.reason).toBe("baseProduction");
    expect(change).toEqual({ index: 7, polityId: "polity-1" });
  });
});
