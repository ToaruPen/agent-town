import {
  type AgentTask,
  type PlanSource,
  TICKS_PER_DAY,
  type Tile,
  type WorldState,
} from "@agent-town/shared";

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

export interface Engine {
  world: WorldState;
  step(): void;
  drainDirtyTiles(): number[];
  applyPlan(agentId: string, tasks: AgentTask[], source: PlanSource, reasoning?: string): void;
  isDayBoundary(): boolean;
}

function warnUnknownAgent(agentId: string): void {
  console.warn(
    JSON.stringify({ at: "engine.applyPlan", agent: agentId, outcome: "unknown-agent" }),
  );
}

export function createEngine(world: WorldState, planner: Planner, rng: () => number): Engine {
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
    applyPlan(agentId: string, tasks: AgentTask[], source: PlanSource, reasoning?: string): void {
      const agent = world.agents.find(({ id }) => id === agentId);
      if (agent === undefined) {
        warnUnknownAgent(agentId);
        return;
      }
      agent.tasks = tasks;
      agent.planSource = source;
      agent.thinking = false;
      agent.lastThought = reasoning ?? null;
    },
    isDayBoundary(): boolean {
      return world.tick > 0 && world.tick % TICKS_PER_DAY === 0;
    },
  };
}
