import {
  type AgentActivity,
  type AgentState,
  type AgentTask,
  CARRY_CAPACITY,
  EAT_TICKS,
  FOOD_PER_MEAL,
  FORAGE_TICKS,
  GATHER_TICKS,
  HUNGER_MAX,
  HUNGER_PER_MEAL,
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

function stepToward(
  world: WorldState,
  agent: AgentState,
  dest: Position,
  hasArrived: (pos: Position) => boolean,
): void {
  if (agent.activity.kind !== "moving") {
    const path = findPath(world, agent.pos, dest);
    if (path === null || path.length === 0) {
      finishHeadTask(agent);
      return;
    }
    agent.activity = { kind: "moving", path, ticksIntoStep: 0 };
  }

  const next = agent.activity.path[0];
  if (next === undefined || !isWalkable(world, next)) {
    finishHeadTask(agent);
    return;
  }

  agent.activity.ticksIntoStep += 1;
  if (agent.activity.ticksIntoStep < MOVE_TICKS_PER_TILE) return;

  agent.activity.path.shift();
  agent.pos = next;
  if (hasArrived(agent.pos)) {
    agent.activity = { kind: "idle" };
    return;
  }
  agent.activity.ticksIntoStep = 0;
}

function stepEat(world: WorldState, agent: AgentState): void {
  if (world.stockpile.food < FOOD_PER_MEAL) {
    finishHeadTask(agent);
    return;
  }

  if (!isAdjacentOrOn(agent.pos, world.stockpile.pos)) {
    stepToward(world, agent, world.stockpile.pos, (pos) =>
      isAdjacentOrOn(pos, world.stockpile.pos),
    );
    return;
  }

  if (agent.activity.kind !== "eating") {
    agent.activity = { kind: "eating", ticksRemaining: EAT_TICKS };
  }

  agent.activity.ticksRemaining -= 1;
  if (agent.activity.ticksRemaining > 0) return;

  world.stockpile.food -= FOOD_PER_MEAL;
  agent.hunger = Math.min(HUNGER_MAX, agent.hunger + HUNGER_PER_MEAL);
  finishHeadTask(agent);
}

function stepForage(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "forage" }>,
): void {
  const tile = tileAt(world, task.target);
  if (tile?.resource?.kind !== "food" || tile.resource.amount <= 0) {
    finishHeadTask(agent);
    return;
  }

  if (!positionsEqual(agent.pos, task.target)) {
    stepToward(world, agent, task.target, (pos) => positionsEqual(pos, task.target));
    return;
  }

  if (agent.activity.kind !== "foraging" || !positionsEqual(agent.activity.target, task.target)) {
    agent.activity = { kind: "foraging", target: task.target, ticksRemaining: FORAGE_TICKS };
  }

  agent.activity.ticksRemaining -= 1;
  if (agent.activity.ticksRemaining > 0) return;

  tile.resource.amount = Math.max(0, tile.resource.amount - FOOD_PER_MEAL);
  if (tile.resource.amount === 0) tile.resource = null;
  agent.hunger = Math.min(HUNGER_MAX, agent.hunger + HUNGER_PER_MEAL);
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
  if (task.kind === "eat") stepEat(world, agent);
  if (task.kind === "forage") stepForage(world, agent, task);
  if (task.kind === "deposit") stepDeposit(world, agent);
}
