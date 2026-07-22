import {
  type AgentState,
  type AgentTask,
  BERRY_REGROWTH_PER_DAY,
  COLD_HEALTH_PER_DAY,
  FATIGUE_DECAY_PER_DAY,
  FOOD_PER_MEAL,
  HUNGER_DECAY_PER_DAY,
  HUNGER_EAT_THRESHOLD,
  isWinter,
  type PlanSource,
  type Position,
  STARVATION_HEALTH_PER_DAY,
  TICKS_PER_DAY,
  type Tile,
  TREE_REGROWTH_CAP,
  TREE_REGROWTH_PER_DAY,
  WOOD_BURN_PER_AGENT_PER_DAY,
  type WorldState,
} from "@agent-town/shared";

import { findNearestReachable } from "./astar.js";
import { stepAgent } from "./executor.js";
import type { Planner } from "./fakePlanner.js";

const HUNGER_DECAY_PER_TICK = HUNGER_DECAY_PER_DAY / TICKS_PER_DAY;
const FATIGUE_DECAY_PER_TICK = FATIGUE_DECAY_PER_DAY / TICKS_PER_DAY;
const STARVATION_HEALTH_PER_TICK = STARVATION_HEALTH_PER_DAY / TICKS_PER_DAY;

function decayNeeds(agent: AgentState): void {
  agent.hunger = Math.max(0, agent.hunger - HUNGER_DECAY_PER_TICK);
  agent.fatigue = Math.max(0, agent.fatigue - FATIGUE_DECAY_PER_TICK);
}

function applyStarvation(agent: AgentState): void {
  if (agent.hunger === 0) {
    agent.health = Math.max(0, agent.health - STARVATION_HEALTH_PER_TICK);
  }
}

function findNearestFood(world: WorldState, from: Position): Position | null {
  const candidates: Position[] = [];

  for (const [index, tile] of world.tiles.entries()) {
    if (tile.resource?.kind !== "food" || tile.resource.amount <= 0) continue;
    candidates.push({ x: index % world.width, y: Math.floor(index / world.width) });
  }

  return findNearestReachable(world, from, candidates);
}

function maybeInterruptForHunger(world: WorldState, agent: AgentState): void {
  const head = agent.tasks[0];
  if (agent.hunger >= HUNGER_EAT_THRESHOLD || head?.kind === "eat" || head?.kind === "forage") {
    return;
  }

  let foodTask: AgentTask | undefined;
  if (world.stockpile.food >= FOOD_PER_MEAL) {
    foodTask = { kind: "eat" };
  } else {
    const target = findNearestFood(world, agent.pos);
    if (target !== null) foodTask = { kind: "forage", target };
  }
  if (foodTask === undefined) return;

  agent.tasks.unshift(foodTask);
  agent.activity = { kind: "idle" };
}

function snapshotResources(tiles: Tile[]): (string | null)[] {
  return tiles.map(({ resource }) =>
    resource === null ? null : `${resource.kind}:${resource.amount}`,
  );
}

function captureBerryCaps(tiles: Tile[]): (number | null)[] {
  return tiles.map(({ resource }) => (resource?.kind === "food" ? resource.amount : null));
}

function regrowBerries(tile: Tile, initialAmount: number): void {
  if (tile.resource === null) {
    tile.resource = { kind: "food", amount: Math.min(BERRY_REGROWTH_PER_DAY, initialAmount) };
    return;
  }
  if (tile.resource.kind !== "food") return;
  tile.resource.amount = Math.min(tile.resource.amount + BERRY_REGROWTH_PER_DAY, initialAmount);
}

function regrowTree(tile: Tile): void {
  if (tile.terrain !== "forest") return;
  if (tile.resource === null) {
    tile.resource = { kind: "wood", amount: TREE_REGROWTH_PER_DAY };
    return;
  }
  if (tile.resource.kind !== "wood") return;
  if (tile.resource.amount >= TREE_REGROWTH_CAP) return;
  tile.resource.amount = Math.min(tile.resource.amount + TREE_REGROWTH_PER_DAY, TREE_REGROWTH_CAP);
}

function regrowResources(world: WorldState, berryCaps: (number | null)[]): void {
  if (isWinter(world.tick)) return;
  for (const [index, tile] of world.tiles.entries()) {
    const berryCap = berryCaps[index];
    if (berryCap !== null && berryCap !== undefined) regrowBerries(tile, berryCap);
    regrowTree(tile);
  }
}

function isPositiveDayBoundary(tick: number): boolean {
  return tick > 0 && tick % TICKS_PER_DAY === 0;
}

function removeIfDead(
  world: WorldState,
  agent: AgentState,
  cause: WorldState["deaths"][number]["cause"],
): boolean {
  if (agent.health > 0) return false;
  const index = world.agents.indexOf(agent);
  if (index >= 0) world.agents.splice(index, 1);
  world.deaths.push({ name: agent.name, tick: world.tick, cause });
  return true;
}

function applyColdDamage(world: WorldState): void {
  for (const agent of [...world.agents]) {
    agent.health = Math.max(0, agent.health - COLD_HEALTH_PER_DAY);
    removeIfDead(world, agent, "cold");
  }
}

function burnWinterWood(world: WorldState): void {
  if (!isWinter(world.tick)) return;
  const requiredWood = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY;
  const isShort = world.stockpile.wood < requiredWood;
  world.stockpile.wood = Math.max(0, world.stockpile.wood - requiredWood);
  if (isShort) applyColdDamage(world);
}

function runDailyHooks(world: WorldState, berryCaps: (number | null)[]): void {
  regrowResources(world, berryCaps);
  burnWinterWood(world);
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

function advanceAgent(world: WorldState, agent: AgentState, planner: Planner): void {
  decayNeeds(agent);
  applyStarvation(agent);
  if (removeIfDead(world, agent, "starvation")) return;
  maybeInterruptForHunger(world, agent);
  if (agent.tasks.length === 0) agent.tasks.push(...planner.plan(world, agent));
  stepAgent(world, agent);
}

export function createEngine(world: WorldState, planner: Planner, rng: () => number): Engine {
  void rng;
  const dirtyTileIndexes = new Set<number>();
  const berryCaps = captureBerryCaps(world.tiles);

  return {
    world,
    step(): void {
      const resourcesBefore = snapshotResources(world.tiles);
      for (const agent of [...world.agents]) {
        advanceAgent(world, agent, planner);
      }
      world.tick += 1;
      if (isPositiveDayBoundary(world.tick)) runDailyHooks(world, berryCaps);
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
      return isPositiveDayBoundary(world.tick);
    },
  };
}
