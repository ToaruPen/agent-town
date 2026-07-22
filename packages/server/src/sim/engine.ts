import type { Tile, WorldState } from "@agent-town/shared";

import { stepAgent } from "./executor.js";
import type { Planner } from "./fakePlanner.js";

function snapshotResources(tiles: Tile[]): (string | null)[] {
  return tiles.map(({ resource }) =>
    resource === null ? null : `${resource.kind}:${resource.amount}`,
  );
}

function markDirtyTiles(
  tiles: Tile[],
  before: (string | null)[],
  dirtyTileIndexes: Set<number>,
): void {
  for (const [index, tile] of tiles.entries()) {
    const resource = tile.resource;
    const after = resource === null ? null : `${resource.kind}:${resource.amount}`;
    if (before[index] !== after) dirtyTileIndexes.add(index);
  }
}

export function createEngine(world: WorldState, planner: Planner, rng: () => number) {
  void rng;
  const dirtyTileIndexes = new Set<number>();

  return {
    world,
    step(): void {
      const resourcesBefore = snapshotResources(world.tiles);
      for (const agent of world.agents) {
        if (agent.tasks.length === 0) agent.tasks.push(...planner.plan(world, agent));
        stepAgent(world, agent);
      }
      world.tick += 1;
      markDirtyTiles(world.tiles, resourcesBefore, dirtyTileIndexes);
    },
    drainDirtyTiles(): number[] {
      const indexes = [...dirtyTileIndexes];
      dirtyTileIndexes.clear();
      return indexes;
    },
  };
}
