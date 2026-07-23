import { describe, expect, it } from "vitest";

import {
  WORLD_CITY_NAME_SUFFIXES,
  WORLD_MAP_CITY_COUNT_MAX,
  WORLD_MAP_CITY_COUNT_MIN,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS,
  WORLD_MAP_WIDTH,
  type WorldMap,
} from "../src/index.js";

describe("world-map contracts", () => {
  it("defines the frozen grid, city range, and terrain weights", () => {
    const map: WorldMap = {
      width: WORLD_MAP_WIDTH,
      height: WORLD_MAP_HEIGHT,
      cells: Array.from(
        { length: WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT },
        () => ({ terrain: "sea", polityId: null }) as const,
      ),
      cities: [],
      tradeRoutes: [],
      borderChanges: [],
      settlementFrontierPos: { x: 0, y: 0 },
    };

    expect([map.width, map.height, map.cells.length]).toEqual([96, 64, 96 * 64]);
    expect([WORLD_MAP_CITY_COUNT_MIN, WORLD_MAP_CITY_COUNT_MAX]).toEqual([1, 3]);
    expect(WORLD_CITY_NAME_SUFFIXES).toEqual(["府", "市", "砦"]);
    expect(WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS).toEqual({
      sea: 0,
      plains: 1,
      forest: 0.8,
      hills: 0.55,
      mountains: 0.2,
    });
  });
});
