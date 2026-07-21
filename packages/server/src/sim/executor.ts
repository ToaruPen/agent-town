import {
  type AgentActivity,
  type AgentState,
  type AgentTask,
  CARRY_CAPACITY,
  GATHER_TICKS,
  MOVE_TICKS_PER_TILE,
  type Position,
  type Tile,
  type WorldState,
} from "@agent-town/shared";

import { findPath, isWalkable } from "./astar.js";

type MovingActivity = Extract<AgentActivity, { kind: "moving" }>;

interface GatherTarget {
  tile: Tile;
  resource: NonNullable<Tile["resource"]>;
}

function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function isAdjacentOrOn(left: Position, right: Position): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) <= 1;
}

function tileAt(world: WorldState, pos: Position): Tile | undefined {
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) return undefined;
  return world.tiles[pos.y * world.width + pos.x];
}

function finishHeadTask(agent: AgentState): void {
  agent.tasks.shift();
  agent.activity = { kind: "idle" };
}

function prepareMovement(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "moveTo" }>,
): MovingActivity | null {
  if (agent.activity.kind === "moving") return agent.activity;
  const path = findPath(world, agent.pos, task.dest);
  if (path === null || path.length === 0) {
    finishHeadTask(agent);
    return null;
  }

  const activity: MovingActivity = { kind: "moving", path, ticksIntoStep: 0 };
  agent.activity = activity;
  return activity;
}

function stepMoveTo(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "moveTo" }>,
): void {
  const activity = prepareMovement(world, agent, task);
  if (activity === null) return;

  const next = activity.path[0];
  if (next === undefined || !isWalkable(world, next)) {
    finishHeadTask(agent);
    return;
  }

  activity.ticksIntoStep += 1;
  if (activity.ticksIntoStep < MOVE_TICKS_PER_TILE) return;

  activity.path.shift();
  agent.pos = next;
  if (activity.path.length === 0) {
    finishHeadTask(agent);
    return;
  }
  activity.ticksIntoStep = 0;
}

function validGatherTile(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "gather" }>,
): GatherTarget | null {
  if (!isAdjacentOrOn(agent.pos, task.target)) return null;
  const tile = tileAt(world, task.target);
  if (tile?.resource?.kind !== task.resource || tile.resource.amount <= 0) return null;
  return { tile, resource: tile.resource };
}

function stepGather(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "gather" }>,
): void {
  const target = validGatherTile(world, agent, task);
  if (target === null) {
    finishHeadTask(agent);
    return;
  }

  if (agent.activity.kind !== "gathering" || !positionsEqual(agent.activity.target, task.target)) {
    agent.activity = { kind: "gathering", target: task.target, ticksRemaining: GATHER_TICKS };
  }

  agent.activity.ticksRemaining -= 1;
  if (agent.activity.ticksRemaining > 0) return;

  const amount = Math.min(CARRY_CAPACITY, target.resource.amount);
  agent.carrying = { kind: task.resource, amount };
  target.resource.amount -= amount;
  if (target.resource.amount === 0) target.tile.resource = null;
  finishHeadTask(agent);
}

function stepDeposit(world: WorldState, agent: AgentState): void {
  if (!isAdjacentOrOn(agent.pos, world.stockpile.pos)) {
    finishHeadTask(agent);
    return;
  }

  agent.activity = { kind: "depositing" };
  const carrying = agent.carrying;
  if (carrying?.kind === "wood") world.stockpile.wood += carrying.amount;
  if (carrying?.kind === "food") world.stockpile.food += carrying.amount;
  agent.carrying = null;
  finishHeadTask(agent);
}

export function stepAgent(world: WorldState, agent: AgentState): void {
  const task = agent.tasks[0];
  if (task === undefined) {
    agent.activity = { kind: "idle" };
    return;
  }

  if (task.kind === "moveTo") stepMoveTo(world, agent, task);
  if (task.kind === "gather") stepGather(world, agent, task);
  if (task.kind === "deposit") stepDeposit(world, agent);
}
