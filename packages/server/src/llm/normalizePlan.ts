import type { AgentState, AgentTask, Position, WorldState } from "@agent-town/shared";

import { findNearestReachable, findPath } from "../sim/astar.js";

type ArrivalRule = "adjacent" | "exact";

interface TaskLocation {
  arrival: ArrivalRule;
  destination: Position;
  target: Position;
}

export type PlanNormalizationResult =
  | { ok: true; tasks: AgentTask[] }
  | { ok: false; error: string };

type CursorResult = { ok: true; cursor: Position } | { ok: false; error: string };

function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function isAdjacentOrOn(left: Position, right: Position): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) <= 1;
}

function buildApproaches(target: Position): Position[] {
  return [
    { x: target.x, y: target.y - 1 },
    { x: target.x + 1, y: target.y },
    { x: target.x, y: target.y + 1 },
    { x: target.x - 1, y: target.y },
  ];
}

function restTarget(world: WorldState, cursor: Position): Position | null {
  const houses = world.buildings.filter(({ complete }) => complete).map(({ pos }) => pos);
  return (
    findNearestReachable(world, cursor, houses) ??
    findNearestReachable(world, cursor, [world.stockpile.pos])
  );
}

function directLocation(target: Position, arrival: ArrivalRule): TaskLocation {
  return { arrival, destination: target, target };
}

function buildLocation(world: WorldState, cursor: Position, target: Position): TaskLocation | null {
  if (isAdjacentOrOn(cursor, target)) {
    return { arrival: "adjacent", destination: cursor, target };
  }
  const destination = findNearestReachable(world, cursor, buildApproaches(target));
  return destination === null ? null : { arrival: "adjacent", destination, target };
}

function gatherLocation(
  world: WorldState,
  cursor: Position,
  target: Position,
): TaskLocation | null {
  if (isAdjacentOrOn(cursor, target)) {
    return { arrival: "adjacent", destination: cursor, target };
  }
  const destination =
    findNearestReachable(world, cursor, buildApproaches(target)) ??
    findNearestReachable(world, cursor, [target]);
  return destination === null ? null : { arrival: "adjacent", destination, target };
}

function taskLocation(world: WorldState, cursor: Position, task: AgentTask): TaskLocation | null {
  if (task.kind === "gather") return gatherLocation(world, cursor, task.target);
  if (task.kind === "forage") return directLocation(task.target, "exact");
  if (task.kind === "eat") return directLocation(world.stockpile.pos, "adjacent");
  if (task.kind === "build") return buildLocation(world, cursor, task.pos);
  if (task.kind === "rest") {
    const target = restTarget(world, cursor);
    return target === null ? null : directLocation(target, "exact");
  }
  return null;
}

function hasArrived(cursor: Position, location: TaskLocation): boolean {
  return location.arrival === "exact"
    ? positionsEqual(cursor, location.target)
    : isAdjacentOrOn(cursor, location.target);
}

function unreachableError(index: number, kind: AgentTask["kind"]): { ok: false; error: string } {
  return { ok: false, error: `task[${index}] ${kind} destination is unreachable` };
}

function appendAuthoredMove(
  world: WorldState,
  cursor: Position,
  task: Extract<AgentTask, { kind: "moveTo" }>,
  normalized: AgentTask[],
  index: number,
): CursorResult {
  if (findPath(world, cursor, task.dest) === null) return unreachableError(index, task.kind);
  normalized.push(task);
  return { ok: true, cursor: task.dest };
}

function appendPositionalTask(
  world: WorldState,
  cursor: Position,
  task: AgentTask,
  normalized: AgentTask[],
  index: number,
): CursorResult {
  const location = taskLocation(world, cursor, task);
  if (location === null) return unreachableError(index, task.kind);
  if (hasArrived(cursor, location)) {
    normalized.push(task);
    return { ok: true, cursor };
  }
  if (findPath(world, cursor, location.destination) === null) {
    return unreachableError(index, task.kind);
  }
  normalized.push({ kind: "moveTo", dest: location.destination }, task);
  return { ok: true, cursor: location.destination };
}

export function normalizePlan(
  world: WorldState,
  agent: AgentState,
  tasks: AgentTask[],
): PlanNormalizationResult {
  const normalized: AgentTask[] = [];
  let cursor = agent.pos;

  for (const [index, task] of tasks.entries()) {
    if (task.kind === "moveTo") {
      const result = appendAuthoredMove(world, cursor, task, normalized, index);
      if (!result.ok) return result;
      cursor = result.cursor;
      continue;
    }
    if (task.kind === "deposit") {
      normalized.push(task);
      continue;
    }
    const result = appendPositionalTask(world, cursor, task, normalized, index);
    if (!result.ok) return result;
    cursor = result.cursor;
  }

  return { ok: true, tasks: normalized };
}
