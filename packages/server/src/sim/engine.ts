import {
  type AgentState,
  type AgentTask,
  BERRY_REGROWTH_PER_DAY,
  COLD_HEALTH_PER_DAY,
  DAYS_PER_SEASON,
  FATIGUE_DECAY_PER_DAY,
  FATIGUE_MAX,
  FATIGUE_REST_THRESHOLD,
  FATIGUE_SLOWDOWN,
  FOOD_PER_MEAL,
  foodDaysRemaining,
  HEALTH_MAX,
  HOUSE_CAPACITY,
  HUNGER_DECAY_PER_DAY,
  HUNGER_EAT_THRESHOLD,
  HUNGER_MAX,
  IMMIGRANT_NAMES,
  IMMIGRATION_FOOD_DAYS_MIN,
  isWinter,
  MAX_POPULATION,
  type PlanSource,
  type Position,
  SEASONS,
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
import { updateFoodSecurityDesires } from "./foodAnxiety.js";
import { advanceSociety, createSocietyMemory } from "./society.js";

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

function maybeInterruptForHunger(world: WorldState, agent: AgentState): boolean {
  const head = agent.tasks[0];
  if (agent.hunger >= HUNGER_EAT_THRESHOLD || head?.kind === "eat" || head?.kind === "forage") {
    return false;
  }

  let foodTask: AgentTask | undefined;
  if (world.stockpile.food >= FOOD_PER_MEAL) {
    foodTask = { kind: "eat" };
  } else {
    const target = findNearestFood(world, agent.pos);
    if (target !== null) foodTask = { kind: "forage", target };
  }
  if (foodTask === undefined) return false;

  agent.tasks.unshift(foodTask);
  agent.activity = { kind: "idle" };
  return true;
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
  maybeImmigrate(world);
}

const TICKS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length * TICKS_PER_DAY;

function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function isOccupied(world: WorldState, pos: Position): boolean {
  return (
    world.agents.some((agent) => positionsEqual(agent.pos, pos)) ||
    world.buildings.some((building) => positionsEqual(building.pos, pos))
  );
}

function findImmigrantSpawn(world: WorldState): Position | null {
  const candidates: Position[] = [];
  for (let index = 0; index < world.tiles.length; index += 1) {
    const pos = { x: index % world.width, y: Math.floor(index / world.width) };
    if (positionsEqual(pos, world.stockpile.pos) || isOccupied(world, pos)) continue;
    candidates.push(pos);
  }
  return findNearestReachable(world, world.stockpile.pos, candidates);
}

function nextImmigrantName(world: WorldState): string {
  const usedNames = new Set(world.agents.map(({ name }) => name));
  for (let round = 1; round <= world.agents.length + 1; round += 1) {
    for (const baseName of IMMIGRANT_NAMES) {
      const candidate = round === 1 ? baseName : `${baseName} ${round}`;
      if (!usedNames.has(candidate)) return candidate;
    }
  }
  throw new Error("immigrant name selection exhausted unexpectedly");
}

function nextAgentId(world: WorldState): string {
  const usedIds = new Set(world.agents.map(({ id }) => id));
  let sequence = world.agents.length + world.deaths.length + 1;
  while (usedIds.has(`agent-${sequence}`)) sequence += 1;
  return `agent-${sequence}`;
}

function hasImmigrationCapacity(world: WorldState): boolean {
  const completedHouses = world.buildings.filter(({ complete }) => complete).length;
  return completedHouses * HOUSE_CAPACITY > world.agents.length;
}

function maybeImmigrate(world: WorldState): void {
  if (world.tick % TICKS_PER_YEAR !== 0) return;
  if (world.agents.length >= MAX_POPULATION || !hasImmigrationCapacity(world)) return;
  const foodDays = foodDaysRemaining(world);
  if (!Number.isFinite(foodDays) || foodDays < IMMIGRATION_FOOD_DAYS_MIN) return;
  const name = nextImmigrantName(world);
  const pos = findImmigrantSpawn(world);
  if (pos === null) return;
  world.agents.push({
    id: nextAgentId(world),
    name,
    pos,
    carrying: null,
    activity: { kind: "idle" },
    tasks: [],
    planSource: "fake",
    llmProvider: null,
    thinking: false,
    lastThought: null,
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    hunger: HUNGER_MAX,
    fatigue: FATIGUE_MAX,
    health: HEALTH_MAX,
  });
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
  if (maybeInterruptForHunger(world, agent)) {
    agent.lastHungerInterruptTick = world.tick;
  }
  if (agent.tasks.length === 0) agent.tasks.push(...planner.plan(world, agent));
  const speed = agent.fatigue < FATIGUE_REST_THRESHOLD ? FATIGUE_SLOWDOWN : 1;
  stepAgent(world, agent, speed);
}

export function createEngine(world: WorldState, planner: Planner, rng: () => number): Engine {
  void rng;
  const dirtyTileIndexes = new Set<number>();
  const berryCaps = captureBerryCaps(world.tiles);
  const societyMemory = createSocietyMemory();

  return {
    world,
    step(): void {
      const resourcesBefore = snapshotResources(world.tiles);
      for (const agent of [...world.agents]) {
        advanceAgent(world, agent, planner);
      }
      world.tick += 1;
      updateFoodSecurityDesires(world);
      advanceSociety(world, societyMemory);
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
