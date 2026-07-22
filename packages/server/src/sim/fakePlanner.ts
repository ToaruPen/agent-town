import {
  type AgentState,
  type AgentTask,
  DAYS_PER_SEASON,
  FATIGUE_REST_THRESHOLD,
  HOUSE_CAPACITY,
  HOUSE_WOOD_COST,
  HUNGER_EAT_THRESHOLD,
  type Position,
  type ResourceKind,
  STOCKPILE_TARGET_FOOD,
  WANDER_RADIUS,
  WOOD_BURN_PER_AGENT_PER_DAY,
  type WorldState,
} from "@agent-town/shared";

import { filterReachable, findNearestReachable, isWalkable } from "./astar.js";

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

function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function incompleteHouseTarget(world: WorldState, agent: AgentState): Position | null {
  const candidates = world.buildings.filter(({ complete }) => !complete).map(({ pos }) => pos);
  return findNearestReachable(world, agent.pos, candidates);
}

function isFreeBuildSite(world: WorldState, pos: Position): boolean {
  const tile = world.tiles[pos.y * world.width + pos.x];
  if (tile?.resource !== null || !isWalkable(world, pos)) return false;
  if (positionsEqual(pos, world.stockpile.pos)) return false;
  if (world.agents.some((agent) => positionsEqual(agent.pos, pos))) return false;
  return !world.buildings.some((building) => positionsEqual(building.pos, pos));
}

function newHouseSite(world: WorldState, agent: AgentState): Position | null {
  const candidates: Position[] = [];
  for (let index = 0; index < world.tiles.length; index += 1) {
    const pos = { x: index % world.width, y: Math.floor(index / world.width) };
    if (isFreeBuildSite(world, pos)) candidates.push(pos);
  }
  const reachable = filterReachable(world, agent.pos, candidates);
  return findNearestReachable(world, world.stockpile.pos, reachable);
}

function priorityTasks(world: WorldState, agent: AgentState): AgentTask[] | null {
  if (agent.carrying !== null) {
    return [{ kind: "moveTo", dest: world.stockpile.pos }, { kind: "deposit" }];
  }
  if (agent.hunger < HUNGER_EAT_THRESHOLD) return [{ kind: "eat" }];
  if (agent.fatigue < FATIGUE_REST_THRESHOLD) return [{ kind: "rest" }];
  const incompleteTarget = incompleteHouseTarget(world, agent);
  return incompleteTarget === null ? null : [{ kind: "build", pos: incompleteTarget }];
}

function newHouseTasks(
  world: WorldState,
  agent: AgentState,
  winterWoodTarget: number,
): AgentTask[] | null {
  const completedCapacity =
    world.buildings.filter(({ complete }) => complete).length * HOUSE_CAPACITY;
  const canAfford = world.stockpile.wood >= HOUSE_WOOD_COST + winterWoodTarget;
  if (completedCapacity > world.agents.length || !canAfford) return null;
  const site = newHouseSite(world, agent);
  return site === null ? null : [{ kind: "build", pos: site }];
}

function resourceTasks(
  world: WorldState,
  agent: AgentState,
  winterWoodTarget: number,
): AgentTask[] | null {
  if (world.stockpile.wood < winterWoodTarget) {
    const target = findNearestResource(world, agent, "wood");
    return target === null ? null : gatherTasks("wood", target);
  }
  if (world.stockpile.food >= STOCKPILE_TARGET_FOOD * world.agents.length) return null;
  const target = findNearestResource(world, agent, "food");
  return target === null ? null : gatherTasks("food", target);
}

export class FakePlanner implements Planner {
  constructor(private readonly rng: () => number) {}

  plan(world: WorldState, agent: AgentState): AgentTask[] {
    const priority = priorityTasks(world, agent);
    if (priority !== null) return priority;
    const winterWoodTarget = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;
    const house = newHouseTasks(world, agent, winterWoodTarget);
    if (house !== null) return house;
    const resources = resourceTasks(world, agent, winterWoodTarget);
    if (resources !== null) return resources;

    const positions = walkablePositionsWithinRadius(world, agent.pos);
    const destination = positions[Math.floor(this.rng() * positions.length)];
    return destination === undefined ? [] : [{ kind: "moveTo", dest: destination }];
  }
}
