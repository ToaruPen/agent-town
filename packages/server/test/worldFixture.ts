import type { TrailCell, WorldState } from "@agent-town/shared";

import { makeWorldMapFixture } from "./worldMapFixture.js";

type RequiredWorldFields = "width" | "height" | "tiles" | "stockpile";
type WorldFixtureOptions = Pick<WorldState, RequiredWorldFields> &
  Partial<Omit<WorldState, RequiredWorldFields>>;

export function makeTrailCellsFixture(width: number, height: number): TrailCell[] {
  return Array.from({ length: width * height }, () => ({
    wear: 0,
    level: "none" as const,
    passagesToday: 0,
    purposeWear: {
      survival: 0,
      gathering: 0,
      construction: 0,
      facilityService: 0,
      wandering: 0,
    },
    dominantPurpose: null,
    facilityWear: {},
    causedByFacilityIds: [],
    lastUsedAtTick: null,
  }));
}

export function makeWorldFixture(options: WorldFixtureOptions): WorldState {
  const { width, height, tiles, stockpile, ...overrides } = options;
  return {
    tick: 0,
    width,
    height,
    tiles,
    agents: [],
    stockpile,
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [],
    trailCells: makeTrailCellsFixture(width, height),
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
      worldMap: makeWorldMapFixture(),
    },
    ...overrides,
  };
}
