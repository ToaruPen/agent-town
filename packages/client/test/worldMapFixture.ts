import { WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH, type WorldMap } from "@agent-town/shared";

export function makeWorldMapFixture(): WorldMap {
  const cells: WorldMap["cells"] = Array.from(
    { length: WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT },
    () => ({ terrain: "sea", polityId: null }),
  );
  const settlementFrontierPos = { x: 1, y: 1 };
  cells[settlementFrontierPos.y * WORLD_MAP_WIDTH + settlementFrontierPos.x] = {
    terrain: "plains",
    polityId: null,
  };
  return {
    width: WORLD_MAP_WIDTH,
    height: WORLD_MAP_HEIGHT,
    cells,
    cities: [],
    tradeRoutes: [],
    borderChanges: [],
    settlementFrontierPos,
  };
}
