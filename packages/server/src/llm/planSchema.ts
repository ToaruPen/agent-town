import {
  type AgentState,
  type AgentTask,
  MAX_PLAN_TASKS,
  type Position,
  type ResourceKind,
  type Tile,
  type WorldState,
} from "@agent-town/shared";

export type PlanParseResult =
  | { ok: true; tasks: AgentTask[]; reasoning: string }
  | { ok: false; error: string };

type TaskParseResult = { ok: true; task: AgentTask } | { ok: false; error: string };
type TileLookupResult = { ok: true; tile: Tile } | { ok: false; error: string };

interface ObjectScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPosition(value: unknown): value is Position {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isInteger(value.x) &&
    typeof value.y === "number" &&
    Number.isInteger(value.y)
  );
}

function isResourceKind(value: unknown): value is ResourceKind {
  return value === "wood" || value === "food";
}

function parseTask(value: unknown): TaskParseResult {
  if (!isRecord(value)) return { ok: false, error: "task must be an object" };

  if (value.kind === "moveTo" && isPosition(value.dest)) {
    return { ok: true, task: { kind: "moveTo", dest: value.dest } };
  }
  if (value.kind === "gather" && isResourceKind(value.resource) && isPosition(value.target)) {
    return {
      ok: true,
      task: { kind: "gather", resource: value.resource, target: value.target },
    };
  }
  if (value.kind === "deposit") return { ok: true, task: { kind: "deposit" } };
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

function validateTask(
  world: WorldState,
  task: AgentTask,
): { ok: true } | { ok: false; error: string } {
  if (task.kind === "deposit") return { ok: true };
  if (task.kind === "eat" || task.kind === "forage") {
    return { ok: false, error: `task kind ${task.kind} is not supported by the LLM planner` };
  }

  const position = task.kind === "moveTo" ? task.dest : task.target;
  const lookup = findWalkableTile(world, position);
  if (!lookup.ok) return lookup;
  if (
    task.kind === "gather" &&
    (lookup.tile.resource?.kind !== task.resource || lookup.tile.resource.amount <= 0)
  ) {
    return { ok: false, error: `gather target lacks ${task.resource}` };
  }
  return { ok: true };
}

export function validatePlanExecutability(
  world: WorldState,
  agent: AgentState,
  tasks: AgentTask[],
): { ok: true } | { ok: false; error: string } {
  if (tasks.length === 0) return { ok: false, error: `agent ${agent.id} plan is empty` };
  if (tasks.length > MAX_PLAN_TASKS) {
    return { ok: false, error: `agent ${agent.id} plan exceeds ${MAX_PLAN_TASKS} tasks` };
  }

  for (const [index, task] of tasks.entries()) {
    const result = validateTask(world, task);
    if (!result.ok)
      return { ok: false, error: `agent ${agent.id} task[${index}]: ${result.error}` };
  }
  return { ok: true };
}
