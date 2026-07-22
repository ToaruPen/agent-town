import {
  type AgentState,
  type AgentTask,
  CARRY_CAPACITY,
  FOOD_PER_MEAL,
  HOUSE_WOOD_COST,
  MAX_PLAN_REASONING_CHARS,
  MAX_PLAN_TASKS,
  type Position,
  type ResourceKind,
  type Tile,
  type WorldState,
} from "@agent-town/shared";

import { findNearestReachable } from "../sim/astar.js";

export type PlanParseResult =
  | { ok: true; tasks: AgentTask[]; reasoning: string }
  | { ok: false; error: string };

type TaskParseResult = { ok: true; task: AgentTask } | { ok: false; error: string };
type TileLookupResult = { ok: true; tile: Tile } | { ok: false; error: string };
type TaskValidationResult = { ok: true } | { ok: false; error: string };

interface ObjectScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

interface ValidationBudget {
  carrying: AgentState["carrying"];
  cursor: Position | null;
  food: number;
  wood: number;
  newHouseSites: Set<string>;
  resources: Map<string, { kind: ResourceKind; remaining: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePosition(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  if (typeof value.x !== "number" || !Number.isInteger(value.x)) return null;
  if (typeof value.y !== "number" || !Number.isInteger(value.y)) return null;
  return { x: value.x, y: value.y };
}

function isResourceKind(value: unknown): value is ResourceKind {
  return value === "wood" || value === "food";
}

function parseResourceTask(value: Record<string, unknown>): AgentTask | null {
  if (value.kind === "moveTo") {
    const dest = parsePosition(value.dest);
    return dest === null ? null : { kind: "moveTo", dest };
  }
  if (value.kind === "gather" && isResourceKind(value.resource)) {
    const target = parsePosition(value.target);
    return target === null ? null : { kind: "gather", resource: value.resource, target };
  }
  return null;
}

function parseSurvivalTask(value: Record<string, unknown>): AgentTask | null {
  if (value.kind === "eat") return { kind: "eat" };
  if (value.kind === "forage") {
    const target = parsePosition(value.target);
    return target === null ? null : { kind: "forage", target };
  }
  if (value.kind === "build") {
    const pos = parsePosition(value.pos);
    return pos === null ? null : { kind: "build", pos };
  }
  if (value.kind === "rest") return { kind: "rest" };
  if (value.kind === "deposit") return { kind: "deposit" };
  return null;
}

function parseTask(value: unknown): TaskParseResult {
  if (!isRecord(value)) return { ok: false, error: "task must be an object" };
  const task = parseResourceTask(value) ?? parseSurvivalTask(value);
  if (task !== null) return { ok: true, task };
  return { ok: false, error: "task has an invalid kind or fields" };
}

function isInsideJsonString(character: string | undefined, state: ObjectScanState): boolean {
  if (state.escaped) {
    state.escaped = false;
    return true;
  }
  if (character === "\\" && state.inString) {
    state.escaped = true;
    return true;
  }
  if (character === '"') {
    state.inString = !state.inString;
    return true;
  }
  return state.inString;
}

function findBalancedObjectEnd(raw: string, start: number): number {
  const state: ObjectScanState = { depth: 0, inString: false, escaped: false };
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (isInsideJsonString(character, state)) continue;
    if (character === "{") state.depth += 1;
    if (character === "}") state.depth -= 1;
    if (state.depth === 0) return index;
  }
  return -1;
}

function extractFirstBalancedObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  const end = findBalancedObjectEnd(raw, start);
  return end === -1 ? null : raw.slice(start, end + 1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exceedsUnicodeCodePointLimit(value: string, limit: number): boolean {
  let length = 0;
  for (const _codePoint of value) {
    length += 1;
    if (length > limit) return true;
  }
  return false;
}

export function parsePlanResponse(raw: string): PlanParseResult {
  const objectBlock = extractFirstBalancedObject(raw);
  if (objectBlock === null) return { ok: false, error: "response has no balanced JSON object" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(objectBlock);
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${errorMessage(error)}` };
  }

  if (!isRecord(parsed)) return { ok: false, error: "response must be an object" };
  if (typeof parsed.reasoning !== "string") {
    return { ok: false, error: "reasoning must be a string" };
  }
  if (exceedsUnicodeCodePointLimit(parsed.reasoning, MAX_PLAN_REASONING_CHARS)) {
    return {
      ok: false,
      error: `reasoning exceeds ${MAX_PLAN_REASONING_CHARS} characters`,
    };
  }
  if (!Array.isArray(parsed.plan)) return { ok: false, error: "plan must be an array" };
  if (parsed.plan.length > MAX_PLAN_TASKS) {
    return { ok: false, error: `plan exceeds ${MAX_PLAN_TASKS} tasks` };
  }

  const tasks: AgentTask[] = [];
  for (const [index, value] of parsed.plan.entries()) {
    const result = parseTask(value);
    if (!result.ok) return { ok: false, error: `plan[${index}]: ${result.error}` };
    tasks.push(result.task);
  }
  return { ok: true, tasks, reasoning: parsed.reasoning };
}

function findWalkableTile(world: WorldState, position: Position): TileLookupResult {
  const inBounds =
    Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    position.x >= 0 &&
    position.y >= 0 &&
    position.x < world.width &&
    position.y < world.height;
  if (!inBounds) return { ok: false, error: "position is out of bounds" };

  const tile = world.tiles[position.y * world.width + position.x];
  if (tile === undefined) return { ok: false, error: "position has no tile" };
  if (tile.terrain === "water" || tile.terrain === "rock") {
    return { ok: false, error: `terrain ${tile.terrain} is unwalkable` };
  }
  return { ok: true, tile };
}

function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function isAdjacentOrOn(left: Position, right: Position): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) <= 1;
}

function positionKey(pos: Position): string {
  return `${pos.x},${pos.y}`;
}

function snapshotResources(world: WorldState): ValidationBudget["resources"] {
  const resources: ValidationBudget["resources"] = new Map();
  for (const [index, tile] of world.tiles.entries()) {
    if (tile.resource === null) continue;
    const pos = { x: index % world.width, y: Math.floor(index / world.width) };
    resources.set(positionKey(pos), {
      kind: tile.resource.kind,
      remaining: tile.resource.amount,
    });
  }
  return resources;
}

function validateEat(budget: ValidationBudget): { ok: true } | { ok: false; error: string } {
  if (budget.food < FOOD_PER_MEAL) {
    return { ok: false, error: `eat requires ${FOOD_PER_MEAL} stockpile food` };
  }
  budget.food -= FOOD_PER_MEAL;
  return { ok: true };
}

function validateDeposit(
  world: WorldState,
  budget: ValidationBudget,
): { ok: true } | { ok: false; error: string } {
  if (budget.cursor === null || !isAdjacentOrOn(budget.cursor, world.stockpile.pos)) {
    return { ok: false, error: "deposit requires an explicit position beside the stockpile" };
  }
  if (budget.carrying?.kind === "food") {
    budget.food += budget.carrying.amount;
  }
  if (budget.carrying?.kind === "wood") {
    budget.wood += budget.carrying.amount;
  }
  budget.carrying = null;
  return { ok: true };
}

function validateGather(
  world: WorldState,
  task: Extract<AgentTask, { kind: "gather" }>,
  budget: ValidationBudget,
): { ok: true } | { ok: false; error: string } {
  if (budget.cursor === null || !isAdjacentOrOn(budget.cursor, task.target)) {
    return { ok: false, error: "gather requires an explicit position beside its target" };
  }
  const lookup = findWalkableTile(world, task.target);
  if (!lookup.ok) return lookup;
  const resource = budget.resources.get(positionKey(task.target));
  if (resource?.kind !== task.resource || resource.remaining <= 0) {
    return { ok: false, error: `gather target lacks ${task.resource}` };
  }
  const amount = Math.min(CARRY_CAPACITY, resource.remaining);
  resource.remaining -= amount;
  budget.carrying = {
    kind: task.resource,
    amount,
  };
  return { ok: true };
}

function validateForage(
  world: WorldState,
  target: Position,
  budget: ValidationBudget,
): { ok: true } | { ok: false; error: string } {
  const lookup = findWalkableTile(world, target);
  if (!lookup.ok) return lookup;
  const resource = budget.resources.get(positionKey(target));
  if (resource?.kind !== "food" || resource.remaining <= 0) {
    return { ok: false, error: "forage target lacks food" };
  }
  resource.remaining -= Math.min(FOOD_PER_MEAL, resource.remaining);
  budget.cursor = target;
  return { ok: true };
}

function validateNewBuildSite(
  world: WorldState,
  pos: Position,
  budget: ValidationBudget,
): { ok: true } | { ok: false; error: string } {
  const resource = budget.resources.get(positionKey(pos));
  if (resource !== undefined && resource.remaining > 0) {
    return { ok: false, error: "new build site contains a resource" };
  }
  if (positionsEqual(pos, world.stockpile.pos)) {
    return { ok: false, error: "new build site overlaps the stockpile" };
  }
  if (world.agents.some((agent) => positionsEqual(agent.pos, pos))) {
    return { ok: false, error: "new build site is occupied by an agent" };
  }
  const key = positionKey(pos);
  if (budget.newHouseSites.has(key)) {
    return { ok: false, error: "new build site is duplicated in the plan" };
  }
  if (budget.wood < HOUSE_WOOD_COST) {
    return { ok: false, error: `new build requires ${HOUSE_WOOD_COST} stockpile wood` };
  }
  budget.newHouseSites.add(key);
  budget.wood -= HOUSE_WOOD_COST;
  return { ok: true };
}

function validateBuild(
  world: WorldState,
  pos: Position,
  budget: ValidationBudget,
): { ok: true } | { ok: false; error: string } {
  const lookup = findWalkableTile(world, pos);
  if (!lookup.ok) return lookup;
  const existing = world.buildings.find((building) => positionsEqual(building.pos, pos));
  if (existing?.complete === true) return { ok: false, error: "house is already complete" };
  if (existing !== undefined) return { ok: true };
  return validateNewBuildSite(world, pos, budget);
}

function validateAutonomousTask(
  world: WorldState,
  task: AgentTask,
  budget: ValidationBudget,
  preserveCursor: boolean,
): TaskValidationResult | null {
  let result: TaskValidationResult;
  if (task.kind === "eat") result = validateEat(budget);
  else if (task.kind === "build") result = validateBuild(world, task.pos, budget);
  else if (task.kind === "rest") result = { ok: true };
  else return null;
  if (result.ok && !preserveCursor) budget.cursor = null;
  return result;
}

function normalizedRestTarget(world: WorldState, cursor: Position): Position | null {
  const houses = world.buildings.filter(({ complete }) => complete).map(({ pos }) => pos);
  return (
    findNearestReachable(world, cursor, houses) ??
    findNearestReachable(world, cursor, [world.stockpile.pos])
  );
}

function validateExactArrival(
  cursor: Position,
  target: Position,
  error: string,
): TaskValidationResult {
  return positionsEqual(cursor, target) ? { ok: true } : { ok: false, error };
}

function validateAdjacentArrival(
  cursor: Position,
  target: Position,
  error: string,
): TaskValidationResult {
  return isAdjacentOrOn(cursor, target) ? { ok: true } : { ok: false, error };
}

function validateRestArrival(world: WorldState, cursor: Position): TaskValidationResult {
  const target = normalizedRestTarget(world, cursor);
  if (target === null) return { ok: false, error: "rest destination is unreachable" };
  return validateExactArrival(cursor, target, "rest requires an explicit position on its target");
}

function validateNormalizedArrival(
  world: WorldState,
  task: AgentTask,
  budget: ValidationBudget,
): TaskValidationResult {
  if (task.kind === "moveTo" || task.kind === "deposit") return { ok: true };
  if (budget.cursor === null) return { ok: false, error: `${task.kind} requires a known position` };
  if (task.kind === "forage")
    return validateExactArrival(
      budget.cursor,
      task.target,
      "forage requires an explicit position on its target",
    );
  if (task.kind === "gather")
    return validateAdjacentArrival(
      budget.cursor,
      task.target,
      "gather requires an explicit position beside its target",
    );
  if (task.kind === "eat")
    return validateAdjacentArrival(
      budget.cursor,
      world.stockpile.pos,
      "eat requires an explicit position beside the stockpile",
    );
  if (task.kind === "build")
    return validateAdjacentArrival(
      budget.cursor,
      task.pos,
      "build requires an explicit position beside its target",
    );
  if (task.kind === "rest") return validateRestArrival(world, budget.cursor);
  return { ok: true };
}

function validateTask(
  world: WorldState,
  task: AgentTask,
  budget: ValidationBudget,
  preserveCursor: boolean,
): { ok: true } | { ok: false; error: string } {
  if (task.kind === "deposit") return validateDeposit(world, budget);
  if (task.kind === "moveTo") {
    const lookup = findWalkableTile(world, task.dest);
    if (!lookup.ok) return lookup;
    budget.cursor = task.dest;
    return { ok: true };
  }
  if (task.kind === "forage") return validateForage(world, task.target, budget);
  if (task.kind === "gather") return validateGather(world, task, budget);
  return (
    validateAutonomousTask(world, task, budget, preserveCursor) ?? {
      ok: false,
      error: `task kind ${task.kind} is not executable`,
    }
  );
}

function enteredPosition(task: AgentTask): Position | null {
  if (task.kind === "moveTo") return task.dest;
  if (task.kind === "forage") return task.target;
  return null;
}

function taskEntersBuildSite(tasks: AgentTask[]): boolean {
  const buildSites = tasks
    .filter((task): task is Extract<AgentTask, { kind: "build" }> => task.kind === "build")
    .map(({ pos }) => pos);
  return tasks.some((task) => {
    const entered = enteredPosition(task);
    return entered !== null && buildSites.some((site) => positionsEqual(entered, site));
  });
}

function validatePlanShape(
  agent: AgentState,
  tasks: AgentTask[],
  normalized: boolean,
): TaskValidationResult {
  if (tasks.length === 0) return { ok: false, error: `agent ${agent.id} plan is empty` };
  if (!normalized && tasks.length > MAX_PLAN_TASKS) {
    return { ok: false, error: `agent ${agent.id} plan exceeds ${MAX_PLAN_TASKS} tasks` };
  }
  if (taskEntersBuildSite(tasks)) {
    return { ok: false, error: `agent ${agent.id} task must not enter a build site` };
  }
  return { ok: true };
}

function createValidationBudget(world: WorldState, agent: AgentState): ValidationBudget {
  return {
    carrying: agent.carrying,
    cursor: agent.pos,
    food: world.stockpile.food,
    wood: world.stockpile.wood,
    newHouseSites: new Set(),
    resources: snapshotResources(world),
  };
}

function validateTasks(
  world: WorldState,
  agent: AgentState,
  tasks: AgentTask[],
  budget: ValidationBudget,
  normalized: boolean,
): TaskValidationResult {
  for (const [index, task] of tasks.entries()) {
    if (normalized) {
      const arrival = validateNormalizedArrival(world, task, budget);
      if (!arrival.ok) {
        return { ok: false, error: `agent ${agent.id} task[${index}]: ${arrival.error}` };
      }
    }
    const result = validateTask(world, task, budget, normalized);
    if (!result.ok)
      return { ok: false, error: `agent ${agent.id} task[${index}]: ${result.error}` };
  }
  return { ok: true };
}

function validatePlan(
  world: WorldState,
  agent: AgentState,
  tasks: AgentTask[],
  normalized: boolean,
): TaskValidationResult {
  const shape = validatePlanShape(agent, tasks, normalized);
  if (!shape.ok) return shape;
  return validateTasks(world, agent, tasks, createValidationBudget(world, agent), normalized);
}

export function validatePlanExecutability(
  world: WorldState,
  agent: AgentState,
  tasks: AgentTask[],
): { ok: true } | { ok: false; error: string } {
  return validatePlan(world, agent, tasks, false);
}

export function validateNormalizedPlanExecutability(
  world: WorldState,
  agent: AgentState,
  tasks: AgentTask[],
): { ok: true } | { ok: false; error: string } {
  return validatePlan(world, agent, tasks, true);
}
