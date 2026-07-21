import {
  type AgentState,
  type AgentTask,
  type Position,
  type ResourceKind,
  STOCKPILE_TARGET_FOOD,
  STOCKPILE_TARGET_WOOD,
  WANDER_RADIUS,
  type WorldState,
} from "@agent-town/shared";

import { isWalkable } from "./astar.js";

export interface Planner {
  plan(world: WorldState, agent: AgentState): AgentTask[];
}

function manhattanDistance(from: Position, to: Position): number {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
}

function findNearestResource(
  world: WorldState,
  agent: AgentState,
  kind: ResourceKind,
): Position | null {
  let nearest: Position | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const [index, tile] of world.tiles.entries()) {
    if (tile.resource?.kind !== kind || tile.resource.amount <= 0) continue;
    const pos = { x: index % world.width, y: Math.floor(index / world.width) };
    const distance = manhattanDistance(agent.pos, pos);
    if (distance >= nearestDistance) continue;
    nearest = pos;
    nearestDistance = distance;
  }

  return nearest;
}

function gatherTasks(kind: ResourceKind, target: Position): AgentTask[] {
  return [
    { kind: "moveTo", dest: target },
    { kind: "gather", resource: kind, target },
  ];
}

function walkablePositionsWithinRadius(world: WorldState, center: Position): Position[] {
  const positions: Position[] = [];
  const minX = Math.max(0, center.x - WANDER_RADIUS);
  const maxX = Math.min(world.width - 1, center.x + WANDER_RADIUS);
  const minY = Math.max(0, center.y - WANDER_RADIUS);
  const maxY = Math.min(world.height - 1, center.y + WANDER_RADIUS);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const pos = { x, y };
      if (manhattanDistance(center, pos) <= WANDER_RADIUS && isWalkable(world, pos)) {
        positions.push(pos);
      }
    }
  }

  return positions;
}

export class FakePlanner implements Planner {
  constructor(private readonly rng: () => number) {}

  plan(world: WorldState, agent: AgentState): AgentTask[] {
    if (agent.carrying !== null) {
      return [{ kind: "moveTo", dest: world.stockpile.pos }, { kind: "deposit" }];
    }

    if (world.stockpile.wood < STOCKPILE_TARGET_WOOD) {
      const target = findNearestResource(world, agent, "wood");
      if (target !== null) return gatherTasks("wood", target);
    } else if (world.stockpile.food < STOCKPILE_TARGET_FOOD) {
      const target = findNearestResource(world, agent, "food");
      if (target !== null) return gatherTasks("food", target);
    }

    const positions = walkablePositionsWithinRadius(world, agent.pos);
    const destination = positions[Math.floor(this.rng() * positions.length)];
    return destination === undefined ? [] : [{ kind: "moveTo", dest: destination }];
  }
}
