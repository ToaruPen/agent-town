import {
  AGENT_NAMES,
  type AgentTask,
  BERRY_REGROWTH_PER_DAY,
  CARRY_CAPACITY,
  COLD_HEALTH_PER_DAY,
  DAYS_PER_SEASON,
  EAT_TICKS,
  FATIGUE_DECAY_PER_DAY,
  FATIGUE_MAX,
  FATIGUE_REST_THRESHOLD,
  FATIGUE_SLOWDOWN,
  FOOD_PER_MEAL,
  HEALTH_MAX,
  HOUSE_BUILD_TICKS,
  HOUSE_CAPACITY,
  HUNGER_DECAY_PER_DAY,
  HUNGER_EAT_THRESHOLD,
  HUNGER_MAX,
  HUNGER_PER_MEAL,
  IMMIGRANT_NAMES,
  IMMIGRATION_FOOD_DAYS_MIN,
  MAX_POPULATION,
  MOVE_TICKS_PER_TILE,
  SEASONS,
  STARVATION_HEALTH_PER_DAY,
  TICKS_PER_DAY,
  TREE_REGROWTH_CAP,
  TREE_REGROWTH_PER_DAY,
  WOOD_BURN_PER_AGENT_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEngine } from "../src/sim/engine.js";
import { FakePlanner, type Planner } from "../src/sim/fakePlanner.js";
import { createRng } from "../src/sim/rng.js";
import { generateWorld } from "../src/sim/worldGen.js";

const ACCEPTANCE_STEPS = 3000;
const idlePlanner: Planner = { plan: () => [] };
const TICKS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length * TICKS_PER_DAY;

afterEach(() => {
  vi.restoreAllMocks();
});

function expectAgentsOnWalkableTiles(world: WorldState): void {
  for (const agent of world.agents) {
    const tile = world.tiles[agent.pos.y * world.width + agent.pos.x];
    expect(tile?.terrain).toBeOneOf(["plains", "forest"]);
  }
}

function runAcceptance(seed: number): WorldState {
  const rng = createRng(seed);
  const engine = createEngine(generateWorld(seed), new FakePlanner(rng), rng);

  for (let step = 0; step < ACCEPTANCE_STEPS; step += 1) {
    engine.step();
    expectAgentsOnWalkableTiles(engine.world);
  }

  return engine.world;
}

function runSingleAgentYear(wood: number): WorldState {
  const world = generateWorld(42);
  const agent = world.agents[0];
  if (agent === undefined) throw new Error("missing test agent");
  world.width = 1;
  world.height = 1;
  world.tiles = [{ terrain: "plains", resource: null }];
  world.agents = [agent];
  world.stockpile = {
    pos: { x: 0, y: 0 },
    wood,
    food: DAYS_PER_SEASON * SEASONS.length * FOOD_PER_MEAL,
  };
  agent.pos = { x: 0, y: 0 };
  agent.tasks = [];
  const engine = createEngine(world, idlePlanner, () => 0);
  const ticksPerYear = DAYS_PER_SEASON * SEASONS.length * TICKS_PER_DAY;

  for (let step = 0; step < ticksPerYear; step += 1) engine.step();
  return world;
}

function setFoodDays(world: WorldState, days: number): void {
  const dailyNeed =
    Math.max(world.agents.length, 1) * FOOD_PER_MEAL * (HUNGER_DECAY_PER_DAY / HUNGER_PER_MEAL);
  world.stockpile.food = dailyNeed * days;
}

function immigrationWorld(): WorldState {
  const world = generateWorld(42);
  const agent = world.agents[0];
  if (agent === undefined) throw new Error("missing test agent");
  world.width = 3;
  world.height = 3;
  world.tiles = Array.from({ length: 9 }, () => ({ terrain: "plains", resource: null }));
  world.agents = [agent];
  world.stockpile = { pos: { x: 1, y: 1 }, wood: 0, food: 0 };
  world.buildings = [
    {
      kind: "house",
      pos: { x: 2, y: 2 },
      progress: HOUSE_BUILD_TICKS,
      complete: true,
    },
  ];
  agent.pos = { x: 1, y: 0 };
  agent.tasks = [{ kind: "deposit" }];
  setFoodDays(world, IMMIGRATION_FOOD_DAYS_MIN);
  world.tick = TICKS_PER_YEAR - 1;
  return world;
}

describe("createEngine", () => {
  it("gathers wood and food safely and deterministically over 3000 steps", () => {
    const first = runAcceptance(42);
    const second = runAcceptance(42);

    expect(first.tick).toBe(ACCEPTANCE_STEPS);
    expect(first.stockpile.wood).toBeGreaterThan(0);
    expect(first.stockpile.food).toBeGreaterThan(0);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("identifies positive day-boundary ticks", () => {
    const rng = createRng(42);
    const engine = createEngine(generateWorld(42), new FakePlanner(rng), rng);

    engine.world.tick = 0;
    expect(engine.isDayBoundary()).toBe(false);
    engine.world.tick = TICKS_PER_DAY;
    expect(engine.isDayBoundary()).toBe(true);
    engine.world.tick = TICKS_PER_DAY + 1;
    expect(engine.isDayBoundary()).toBe(false);
  });

  it("runs daily resource hooks only at positive day-boundary ticks", () => {
    const world = generateWorld(42);
    world.width = 1;
    world.height = 1;
    world.tiles = [{ terrain: "plains", resource: { kind: "food", amount: 10 } }];
    world.agents = [];
    const engine = createEngine(world, idlePlanner, () => 0);
    const resource = world.tiles[0]?.resource;
    if (resource === null || resource === undefined) throw new Error("missing test resource");
    resource.amount = 1;

    engine.step();
    expect(resource.amount).toBe(1);

    world.tick = TICKS_PER_DAY - 2;
    engine.step();
    expect(resource.amount).toBe(1);

    engine.step();
    expect(world.tick).toBe(TICKS_PER_DAY);
    expect(resource.amount).toBe(1 + BERRY_REGROWTH_PER_DAY);
    expect(engine.drainDirtyTiles()).toEqual([0]);

    engine.step();
    expect(resource.amount).toBe(1 + BERRY_REGROWTH_PER_DAY);
    expect(engine.drainDirtyTiles()).toEqual([]);
  });

  it("regrows berries up to each tile's captured initial amount, including depleted tiles", () => {
    const world = generateWorld(42);
    world.width = 3;
    world.height = 1;
    world.tiles = [
      { terrain: "plains", resource: { kind: "food", amount: 10 } },
      { terrain: "plains", resource: { kind: "food", amount: 10 } },
      { terrain: "plains", resource: { kind: "food", amount: 3 } },
    ];
    world.agents = [];
    const engine = createEngine(world, idlePlanner, () => 0);
    world.tiles[0] = { terrain: "plains", resource: { kind: "food", amount: 8 } };
    world.tiles[1] = { terrain: "plains", resource: null };
    world.tiles[2] = { terrain: "plains", resource: null };
    world.tick = TICKS_PER_DAY - 1;

    engine.step();

    expect(world.tiles.map(({ resource }) => resource)).toEqual([
      { kind: "food", amount: 10 },
      { kind: "food", amount: BERRY_REGROWTH_PER_DAY },
      { kind: "food", amount: 3 },
    ]);
    expect(engine.drainDirtyTiles()).toEqual([0, 1, 2]);
  });

  it("marks both preceding agent gathering and boundary regrowth as dirty", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    const woodTarget = { x: 1, y: 0 };
    world.width = 2;
    world.height = 1;
    world.tiles = [
      { terrain: "plains", resource: { kind: "food", amount: 10 } },
      { terrain: "forest", resource: { kind: "wood", amount: 10 } },
    ];
    world.agents = [agent];
    agent.pos = { x: 0, y: 0 };
    agent.tasks = [{ kind: "gather", resource: "wood", target: woodTarget }];
    agent.activity = { kind: "gathering", target: woodTarget, ticksRemaining: 1 };
    const engine = createEngine(world, idlePlanner, () => 0);
    const food = world.tiles[0]?.resource;
    if (food === null || food === undefined) throw new Error("missing test food");
    food.amount = 1;
    world.tick = TICKS_PER_DAY - 1;

    engine.step();

    expect(world.tiles.map(({ resource }) => resource)).toEqual([
      { kind: "food", amount: 1 + BERRY_REGROWTH_PER_DAY },
      { kind: "wood", amount: 10 - CARRY_CAPACITY + TREE_REGROWTH_PER_DAY },
    ]);
    expect(engine.drainDirtyTiles()).toEqual([0, 1]);
  });

  it("regrows trees only up to the tree cap without reducing larger initial amounts", () => {
    const world = generateWorld(42);
    world.width = 4;
    world.height = 1;
    world.tiles = [
      { terrain: "forest", resource: { kind: "wood", amount: TREE_REGROWTH_CAP + 10 } },
      { terrain: "forest", resource: { kind: "wood", amount: TREE_REGROWTH_CAP } },
      { terrain: "forest", resource: { kind: "wood", amount: TREE_REGROWTH_CAP - 1 } },
      { terrain: "forest", resource: null },
    ];
    world.agents = [];
    const engine = createEngine(world, idlePlanner, () => 0);
    world.tick = TICKS_PER_DAY - 1;

    engine.step();

    expect(world.tiles.map(({ resource }) => resource)).toEqual([
      { kind: "wood", amount: TREE_REGROWTH_CAP + 10 },
      { kind: "wood", amount: TREE_REGROWTH_CAP },
      { kind: "wood", amount: TREE_REGROWTH_CAP },
      { kind: "wood", amount: TREE_REGROWTH_PER_DAY },
    ]);
    expect(engine.drainDirtyTiles()).toEqual([2, 3]);
  });

  it("pauses berry and tree regrowth during winter", () => {
    const world = generateWorld(42);
    world.width = 2;
    world.height = 1;
    world.tiles = [
      { terrain: "plains", resource: { kind: "food", amount: 10 } },
      { terrain: "forest", resource: { kind: "wood", amount: 10 } },
    ];
    world.agents = [];
    const engine = createEngine(world, idlePlanner, () => 0);
    world.tiles[0] = { terrain: "plains", resource: { kind: "food", amount: 1 } };
    world.tiles[1] = { terrain: "forest", resource: null };
    world.tick = 3 * DAYS_PER_SEASON * TICKS_PER_DAY - 1;

    engine.step();

    expect(world.tiles.map(({ resource }) => resource)).toEqual([
      { kind: "food", amount: 1 },
      null,
    ]);
    expect(engine.drainDirtyTiles()).toEqual([]);
  });

  it("burns the exact population requirement at each winter day boundary and never outside winter", () => {
    const world = generateWorld(42);
    const dailyRequirement = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY;
    world.stockpile.wood = dailyRequirement * 3;
    const engine = createEngine(world, idlePlanner, () => 0);
    world.tick = 2 * DAYS_PER_SEASON * TICKS_PER_DAY - 1;

    engine.step();
    expect(world.stockpile.wood).toBe(dailyRequirement * 3);

    world.tick = 3 * DAYS_PER_SEASON * TICKS_PER_DAY - 1;
    engine.step();
    expect(world.stockpile.wood).toBe(dailyRequirement * 2);

    world.tick += TICKS_PER_DAY - 1;
    engine.step();
    expect(world.stockpile.wood).toBe(dailyRequirement);
  });

  it("consumes remaining wood and damages every living agent when the winter requirement is short", () => {
    const world = generateWorld(42);
    const dailyRequirement = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY;
    world.stockpile.wood = dailyRequirement - 1;
    world.tick = 3 * DAYS_PER_SEASON * TICKS_PER_DAY - 1;
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(world.stockpile.wood).toBe(0);
    expect(world.agents.map(({ health }) => health)).toEqual(
      world.agents.map(() => HEALTH_MAX - COLD_HEALTH_PER_DAY),
    );
  });

  it("does not cause cold damage when the full winter wood requirement is available", () => {
    const world = generateWorld(42);
    world.stockpile.wood = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY;
    world.tick = 3 * DAYS_PER_SEASON * TICKS_PER_DAY - 1;
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(world.agents.map(({ health }) => health)).toEqual(world.agents.map(() => HEALTH_MAX));
  });

  it("applies winter cold and records multiple deaths before returning at the boundary tick", () => {
    const world = generateWorld(42);
    const [first, second, survivor] = world.agents;
    if (first === undefined || second === undefined || survivor === undefined) {
      throw new Error("missing test agents");
    }
    first.health = COLD_HEALTH_PER_DAY;
    second.health = COLD_HEALTH_PER_DAY - 1;
    survivor.health = COLD_HEALTH_PER_DAY + 1;
    world.stockpile.wood = 0;
    const winterStart = 3 * DAYS_PER_SEASON * TICKS_PER_DAY;
    world.tick = winterStart - 1;
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(world.tick).toBe(winterStart);
    expect(world.agents).toEqual([survivor]);
    expect(survivor.health).toBe(1);
    expect(world.deaths).toEqual([
      { name: first.name, tick: winterStart, cause: "cold" },
      { name: second.name, tick: winterStart, cause: "cold" },
    ]);
  });

  it("excludes a preceding-tick starvation death from winter burn population", () => {
    const world = generateWorld(42);
    const [doomed, survivor] = world.agents;
    if (doomed === undefined || survivor === undefined) throw new Error("missing test agents");
    world.agents = [doomed, survivor];
    doomed.hunger = 0;
    doomed.health = STARVATION_HEALTH_PER_DAY / TICKS_PER_DAY / 2;
    world.stockpile.wood = WOOD_BURN_PER_AGENT_PER_DAY;
    const winterStart = 3 * DAYS_PER_SEASON * TICKS_PER_DAY;
    world.tick = winterStart - 1;
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(world.tick).toBe(winterStart);
    expect(world.stockpile.wood).toBe(0);
    expect(world.agents).toEqual([survivor]);
    expect(survivor.health).toBe(HEALTH_MAX);
    expect(world.deaths).toEqual([
      { name: doomed.name, tick: winterStart - 1, cause: "starvation" },
    ]);
  });

  it("keeps a stocked colony alive through a full deterministic eight-day year", () => {
    const winterReserve = DAYS_PER_SEASON * WOOD_BURN_PER_AGENT_PER_DAY;

    const first = runSingleAgentYear(winterReserve);
    const second = runSingleAgentYear(winterReserve);

    expect(first.agents).toHaveLength(1);
    expect(first.agents[0]?.health).toBe(HEALTH_MAX);
    expect(first.deaths).toEqual([]);
    expect(first.stockpile.wood).toBe(0);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("makes an unprepared colony lose health during the winter of a full year", () => {
    const world = runSingleAgentYear(0);

    expect(world.agents).toHaveLength(1);
    expect(world.agents[0]?.health).toBe(HEALTH_MAX - DAYS_PER_SEASON * COLD_HEALTH_PER_DAY);
    expect(world.deaths).toEqual([]);
  });

  it("derives fractional per-tick gauge decay from per-day constants", () => {
    const engine = createEngine(generateWorld(42), idlePlanner, () => 0);

    engine.step();

    for (const agent of engine.world.agents) {
      expect(agent.hunger).toBeCloseTo(HUNGER_MAX - HUNGER_DECAY_PER_DAY / TICKS_PER_DAY, 10);
      expect(agent.fatigue).toBeCloseTo(FATIGUE_MAX - FATIGUE_DECAY_PER_DAY / TICKS_PER_DAY, 10);
    }
  });

  it("matches per-day gauge decay after one day within floating-point rounding", () => {
    const engine = createEngine(generateWorld(42), idlePlanner, () => 0);

    for (let tick = 0; tick < TICKS_PER_DAY; tick += 1) engine.step();

    for (const agent of engine.world.agents) {
      expect(agent.hunger).toBeCloseTo(HUNGER_MAX - HUNGER_DECAY_PER_DAY, 10);
      expect(agent.fatigue).toBeCloseTo(FATIGUE_MAX - FATIGUE_DECAY_PER_DAY, 10);
    }
  });

  it("clamps survival gauges at zero", () => {
    const engine = createEngine(generateWorld(42), idlePlanner, () => 0);
    for (const agent of engine.world.agents) {
      agent.hunger = HUNGER_DECAY_PER_DAY / TICKS_PER_DAY / 2;
      agent.fatigue = FATIGUE_DECAY_PER_DAY / TICKS_PER_DAY / 2;
    }

    engine.step();

    for (const agent of engine.world.agents) {
      expect(agent.hunger).toBe(0);
      expect(agent.fatigue).toBe(0);
    }
  });

  it("prepends one stockpile meal after decay makes an agent hungry", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.agents = [agent];
    world.stockpile.food = FOOD_PER_MEAL;
    agent.hunger = HUNGER_EAT_THRESHOLD;
    agent.tasks = [{ kind: "deposit" }];
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();
    engine.step();

    expect(agent.tasks).toEqual([{ kind: "eat" }, { kind: "deposit" }]);
  });

  it("prepends forage for the first nearest food tile when the stockpile is short", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.width = 5;
    world.height = 1;
    world.tiles = [
      { terrain: "plains", resource: { kind: "food", amount: FOOD_PER_MEAL } },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: { kind: "food", amount: FOOD_PER_MEAL } },
    ];
    world.agents = [agent];
    world.stockpile = { pos: { x: 2, y: 0 }, wood: 0, food: FOOD_PER_MEAL - 1 };
    agent.pos = { x: 2, y: 0 };
    agent.hunger = HUNGER_EAT_THRESHOLD;
    agent.tasks = [{ kind: "deposit" }];
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(agent.tasks).toEqual([{ kind: "forage", target: { x: 0, y: 0 } }, { kind: "deposit" }]);
  });

  it("skips a closer unreachable food tile for a reachable forage target", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.width = 5;
    world.height = 5;
    world.tiles = Array.from({ length: 25 }, () => ({ terrain: "plains", resource: null }));
    world.tiles[2] = {
      terrain: "plains",
      resource: { kind: "food", amount: FOOD_PER_MEAL },
    };
    world.tiles[15] = {
      terrain: "plains",
      resource: { kind: "food", amount: FOOD_PER_MEAL },
    };
    world.tiles[1] = { terrain: "water", resource: null };
    world.tiles[7] = { terrain: "water", resource: null };
    world.tiles[3] = { terrain: "water", resource: null };
    world.agents = [agent];
    world.stockpile = { pos: { x: 0, y: 0 }, wood: 0, food: FOOD_PER_MEAL - 1 };
    agent.pos = { x: 0, y: 0 };
    agent.hunger = HUNGER_EAT_THRESHOLD;
    agent.tasks = [{ kind: "deposit" }];
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(agent.tasks).toEqual([{ kind: "forage", target: { x: 0, y: 3 } }, { kind: "deposit" }]);
  });

  it("selects Birch's reachable forage target in generated seed 6761", () => {
    const world = generateWorld(6761);
    const agent = world.agents.find(({ name }) => name === "Birch");
    if (agent === undefined) throw new Error("missing Birch");
    world.agents = [agent];
    world.stockpile.food = 0;
    agent.hunger = HUNGER_EAT_THRESHOLD;
    agent.tasks = [{ kind: "deposit" }];
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(agent.tasks[0]).toEqual({ kind: "forage", target: { x: 28, y: 23 } });
  });

  it("preserves the current plan when no food exists", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.width = 3;
    world.height = 1;
    world.tiles = Array.from({ length: 3 }, () => ({ terrain: "plains", resource: null }));
    world.agents = [agent];
    world.stockpile = { pos: { x: 0, y: 0 }, wood: 0, food: 0 };
    agent.pos = { x: 0, y: 0 };
    agent.hunger = HUNGER_EAT_THRESHOLD;
    agent.tasks = [{ kind: "moveTo", dest: { x: 2, y: 0 } }];
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(agent.tasks).toEqual([{ kind: "moveTo", dest: { x: 2, y: 0 } }]);
  });

  it("continues the current plan when all food tiles are unreachable", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.width = 3;
    world.height = 3;
    world.tiles = Array.from({ length: 9 }, () => ({ terrain: "plains", resource: null }));
    world.tiles[2] = {
      terrain: "plains",
      resource: { kind: "food", amount: FOOD_PER_MEAL },
    };
    world.tiles[1] = { terrain: "water", resource: null };
    world.tiles[5] = { terrain: "water", resource: null };
    world.agents = [agent];
    world.stockpile = { pos: { x: 0, y: 0 }, wood: 0, food: 0 };
    agent.pos = { x: 0, y: 0 };
    agent.hunger = HUNGER_EAT_THRESHOLD;
    agent.tasks = [{ kind: "moveTo", dest: { x: 0, y: 2 } }];
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(agent.tasks).toEqual([{ kind: "moveTo", dest: { x: 0, y: 2 } }]);
    expect(agent.activity).toMatchObject({ kind: "moving", ticksIntoStep: 1 });
  });

  it("reduces health per tick as soon as hunger reaches zero", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.agents = [agent];
    world.tiles = world.tiles.map((tile) =>
      tile.resource?.kind === "food" ? { ...tile, resource: null } : tile,
    );
    world.stockpile.food = 0;
    agent.hunger = HUNGER_DECAY_PER_DAY / TICKS_PER_DAY / 2;
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(agent.health).toBeCloseTo(HEALTH_MAX - STARVATION_HEALTH_PER_DAY / TICKS_PER_DAY, 10);
  });

  it("removes a starved agent and records its name, cause, and death tick", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.tick = 17;
    world.agents = [agent];
    world.tiles = world.tiles.map((tile) =>
      tile.resource?.kind === "food" ? { ...tile, resource: null } : tile,
    );
    world.stockpile.food = 0;
    agent.hunger = 0;
    agent.health = STARVATION_HEALTH_PER_DAY / TICKS_PER_DAY / 2;
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(world.agents).toEqual([]);
    expect(world.deaths).toEqual([{ name: agent.name, tick: 17, cause: "starvation" }]);
  });

  it("does not skip consecutive agents when removing multiple deaths", () => {
    const world = generateWorld(42);
    const [first, second, survivor] = world.agents;
    if (first === undefined || second === undefined || survivor === undefined) {
      throw new Error("missing test agents");
    }
    world.tiles = world.tiles.map((tile) =>
      tile.resource?.kind === "food" ? { ...tile, resource: null } : tile,
    );
    world.stockpile.food = 0;
    for (const agent of [first, second]) {
      agent.hunger = 0;
      agent.health = STARVATION_HEALTH_PER_DAY / TICKS_PER_DAY / 2;
    }
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(world.agents.map(({ name }) => name)).toEqual([survivor.name]);
    expect(world.deaths).toEqual([
      { name: first.name, tick: 0, cause: "starvation" },
      { name: second.name, tick: 0, cause: "starvation" },
    ]);
  });

  it("kills an agent without any food at the deterministic starvation tick", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.width = 1;
    world.height = 1;
    world.tiles = [{ terrain: "plains", resource: null }];
    world.agents = [agent];
    world.stockpile = { pos: { x: 0, y: 0 }, wood: 0, food: 0 };
    agent.pos = { x: 0, y: 0 };
    agent.hunger = HUNGER_MAX;
    agent.health = HEALTH_MAX;
    agent.tasks = [];
    const engine = createEngine(world, idlePlanner, () => 0);
    const deathAfterSteps =
      (HUNGER_MAX / HUNGER_DECAY_PER_DAY + HEALTH_MAX / STARVATION_HEALTH_PER_DAY) * TICKS_PER_DAY;

    for (let step = 1; step < deathAfterSteps; step += 1) engine.step();
    expect(world.agents).toEqual([agent]);
    engine.step();

    expect(world.tick).toBe(deathAfterSteps);
    expect(world.agents).toEqual([]);
    expect(world.deaths).toEqual([
      { name: agent.name, tick: deathAfterSteps - 1, cause: "starvation" },
    ]);
  });

  it("keeps a well-fed agent alive and healthy for three simulated days", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.width = 1;
    world.height = 1;
    world.tiles = [{ terrain: "plains", resource: null }];
    world.agents = [agent];
    world.stockpile = { pos: { x: 0, y: 0 }, wood: 0, food: 3 * FOOD_PER_MEAL };
    agent.pos = { x: 0, y: 0 };
    agent.tasks = [];
    const engine = createEngine(world, idlePlanner, () => 0);

    for (let step = 0; step < 3 * TICKS_PER_DAY; step += 1) engine.step();

    expect(world.agents).toEqual([agent]);
    expect(agent.health).toBe(HEALTH_MAX);
    expect(world.deaths).toEqual([]);
  });

  it("deposits carried food before using it for a hungry agent's meal", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.width = 2;
    world.height = 1;
    world.tiles = Array.from({ length: 2 }, () => ({ terrain: "plains", resource: null }));
    world.agents = [agent];
    world.stockpile = { pos: { x: 1, y: 0 }, wood: 0, food: 0 };
    agent.pos = { x: 0, y: 0 };
    agent.carrying = { kind: "food", amount: FOOD_PER_MEAL };
    agent.hunger = HUNGER_EAT_THRESHOLD - 1;
    agent.tasks = [];
    const engine = createEngine(world, new FakePlanner(() => 0), () => 0);

    for (let step = 0; step < MOVE_TICKS_PER_TILE + 1; step += 1) engine.step();

    expect(agent.carrying).toBeNull();
    expect(world.stockpile.food).toBe(FOOD_PER_MEAL);

    for (let step = 0; step < EAT_TICKS; step += 1) engine.step();

    expect(world.stockpile.food).toBe(0);
    expect(agent.hunger).toBeGreaterThan(HUNGER_EAT_THRESHOLD);
  });

  it("applies a plan by replacing tasks and storing its reasoning", () => {
    const rng = createRng(42);
    const engine = createEngine(generateWorld(42), new FakePlanner(rng), rng);
    const agent = engine.world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    agent.tasks = [{ kind: "deposit" }];
    agent.thinking = true;
    const tasks: AgentTask[] = [{ kind: "moveTo", dest: { x: 5, y: 6 } }];

    engine.applyPlan(agent.id, tasks, "llm", "Gather nearby wood.");

    expect(agent.tasks).toEqual(tasks);
    expect(agent.planSource).toBe("llm");
    expect(agent.thinking).toBe(false);
    expect(agent.lastThought).toBe("Gather nearby wood.");
  });

  it("clears the last thought when applying a plan without reasoning", () => {
    const rng = createRng(42);
    const engine = createEngine(generateWorld(42), new FakePlanner(rng), rng);
    const agent = engine.world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    agent.lastThought = "Gather nearby wood.";

    engine.applyPlan(agent.id, [{ kind: "deposit" }], "fake");

    expect(agent.lastThought).toBeNull();
  });

  it("warns once and changes nothing when applying a plan to an unknown agent", () => {
    const rng = createRng(42);
    const engine = createEngine(generateWorld(42), new FakePlanner(rng), rng);
    const before = JSON.stringify(engine.world.agents);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    engine.applyPlan("missing-agent", [{ kind: "deposit" }], "llm");

    expect(JSON.stringify(engine.world.agents)).toBe(before);
    expect(warn).toHaveBeenCalledOnce();
    const warning = warn.mock.calls[0]?.[0];
    expect(JSON.parse(String(warning))).toMatchObject({
      at: "engine.applyPlan",
      agent: "missing-agent",
    });
  });

  it("uses fatigue slowdown only when fatigue is below the threshold after decay", () => {
    const world = generateWorld(42);
    const [normal, slow] = world.agents;
    if (normal === undefined || slow === undefined) throw new Error("missing test agents");
    world.width = 2;
    world.height = 1;
    world.tiles = Array.from({ length: 2 }, () => ({ terrain: "plains", resource: null }));
    world.agents = [normal, slow];
    for (const agent of world.agents) {
      agent.pos = { x: 0, y: 0 };
      agent.tasks = [{ kind: "moveTo", dest: { x: 1, y: 0 } }];
    }
    normal.fatigue = FATIGUE_REST_THRESHOLD + FATIGUE_DECAY_PER_DAY / TICKS_PER_DAY;
    slow.fatigue = normal.fatigue - 0.001;
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(normal.fatigue).toBeCloseTo(FATIGUE_REST_THRESHOLD, 10);
    expect(normal.activity).toMatchObject({ kind: "moving", ticksIntoStep: 1 });
    expect(slow.activity).toMatchObject({ kind: "moving", ticksIntoStep: FATIGUE_SLOWDOWN });
  });

  it("nets exactly FATIGUE_MAX fatigue restoration per day while resting", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.agents = [agent];
    agent.pos = world.stockpile.pos;
    agent.fatigue = 50;
    agent.tasks = [{ kind: "rest" }];
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(agent.fatigue).toBeCloseTo(50 + FATIGUE_MAX / TICKS_PER_DAY, 10);
  });

  it("spawns one fully initialized immigrant on the positive spring year boundary", () => {
    const world = immigrationWorld();
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();

    expect(world.tick).toBe(TICKS_PER_YEAR);
    expect(world.agents).toHaveLength(2);
    const immigrant = world.agents.find(({ name }) => name === IMMIGRANT_NAMES[0]);
    expect(immigrant?.llmProvider).toBeNull();
    expect(world.agents[1]).toEqual({
      id: "agent-2",
      name: IMMIGRANT_NAMES[0],
      pos: { x: 0, y: 1 },
      carrying: null,
      activity: { kind: "idle" },
      tasks: [],
      planSource: "fake",
      llmProvider: null,
      thinking: false,
      lastThought: null,
      hunger: HUNGER_MAX,
      fatigue: FATIGUE_MAX,
      health: HEALTH_MAX,
    });
  });

  it("accepts the exact food threshold and rejects a value below it", () => {
    const exact = immigrationWorld();
    const below = immigrationWorld();
    below.stockpile.food -= 0.001;

    createEngine(exact, idlePlanner, () => 0).step();
    createEngine(below, idlePlanner, () => 0).step();

    expect(exact.agents).toHaveLength(2);
    expect(below.agents).toHaveLength(1);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a nonfinite food-days forecast from stockpile food %s",
    (food) => {
      const world = immigrationWorld();
      world.stockpile.food = food;

      createEngine(world, idlePlanner, () => 0).step();

      expect(world.agents).toHaveLength(1);
    },
  );

  it("does not spawn on the stockpile when every non-stockpile tile is occupied", () => {
    const world = immigrationWorld();
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.width = 2;
    world.height = 1;
    world.tiles = Array.from({ length: 2 }, () => ({ terrain: "plains", resource: null }));
    world.stockpile.pos = { x: 0, y: 0 };
    agent.pos = { x: 1, y: 0 };
    world.buildings = [
      {
        kind: "house",
        pos: { x: 1, y: 0 },
        progress: HOUSE_BUILD_TICKS,
        complete: true,
      },
    ];

    createEngine(world, idlePlanner, () => 0).step();

    expect(world.agents).toEqual([agent]);
    expect(world.agents.some(({ pos }) => pos.x === 0 && pos.y === 0)).toBe(false);
  });

  it("does not immigrate at tick zero or an ordinary positive day boundary", () => {
    const atTickZero = immigrationWorld();
    atTickZero.tick = 0;
    const ordinaryBoundary = immigrationWorld();
    ordinaryBoundary.tick = TICKS_PER_DAY - 1;

    createEngine(atTickZero, idlePlanner, () => 0).step();
    createEngine(ordinaryBoundary, idlePlanner, () => 0).step();

    expect(atTickZero.tick).toBe(1);
    expect(atTickZero.agents).toHaveLength(1);
    expect(ordinaryBoundary.tick).toBe(TICKS_PER_DAY);
    expect(ordinaryBoundary.agents).toHaveLength(1);
  });

  it("requires strictly free completed housing capacity", () => {
    const equalCapacity = immigrationWorld();
    const second = { ...equalCapacity.agents[0], id: "agent-2", name: "Birch" };
    equalCapacity.agents.push(second);
    setFoodDays(equalCapacity, IMMIGRATION_FOOD_DAYS_MIN);
    expect(HOUSE_CAPACITY).toBe(equalCapacity.agents.length);

    const incomplete = immigrationWorld();
    const house = incomplete.buildings[0];
    if (house === undefined) throw new Error("missing test house");
    house.complete = false;

    createEngine(equalCapacity, idlePlanner, () => 0).step();
    createEngine(incomplete, idlePlanner, () => 0).step();

    expect(equalCapacity.agents).toHaveLength(2);
    expect(incomplete.agents).toHaveLength(1);
  });

  it("respects MAX_POPULATION even with excess housing and food", () => {
    const world = immigrationWorld();
    const template = world.agents[0];
    if (template === undefined) throw new Error("missing test agent");
    world.agents = Array.from({ length: MAX_POPULATION }, (_, index) => ({
      ...template,
      id: `agent-${index + 1}`,
      name: `Resident ${index + 1}`,
      pos: { x: index % world.width, y: Math.floor(index / world.width) % world.height },
    }));
    world.buildings = Array.from({ length: MAX_POPULATION }, (_, index) => ({
      kind: "house" as const,
      pos: { x: index % world.width, y: Math.floor(index / world.width) % world.height },
      progress: HOUSE_BUILD_TICKS,
      complete: true,
    }));
    setFoodDays(world, IMMIGRATION_FOOD_DAYS_MIN);

    createEngine(world, idlePlanner, () => 0).step();

    expect(world.agents).toHaveLength(MAX_POPULATION);
  });

  it("uses immigrant names in order while skipping names of living agents", () => {
    const livingSkip = immigrationWorld();
    const first = livingSkip.agents[0];
    if (first === undefined) throw new Error("missing test agent");
    first.name = IMMIGRANT_NAMES[0];

    createEngine(livingSkip, idlePlanner, () => 0).step();

    expect(livingSkip.agents[1]?.name).toBe(IMMIGRANT_NAMES[1]);
  });

  it("reuses the first available name even when it appears in death history", () => {
    const world = immigrationWorld();
    world.deaths.push({ name: IMMIGRANT_NAMES[0], tick: 1, cause: "starvation" });

    createEngine(world, idlePlanner, () => 0).step();

    expect(world.agents[1]?.name).toBe(IMMIGRANT_NAMES[0]);
  });

  it("ignores an exhausted death-history pool when selecting a living-unique name", () => {
    const world = immigrationWorld();
    world.deaths = IMMIGRANT_NAMES.map((name) => ({ name, tick: 1, cause: "starvation" }));

    createEngine(world, idlePlanner, () => 0).step();

    expect(world.agents[1]?.name).toBe(IMMIGRANT_NAMES[0]);
    expect(new Set(world.agents.map(({ id }) => id)).size).toBe(world.agents.length);
  });

  it("starts a deterministic second name round when every base immigrant name is living", () => {
    const world = immigrationWorld();
    const template = world.agents[0];
    if (template === undefined) throw new Error("missing test agent");
    const livingPositions = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ];
    world.width = 4;
    world.height = 4;
    world.tiles = Array.from({ length: 16 }, () => ({ terrain: "plains", resource: null }));
    world.stockpile.pos = { x: 1, y: 1 };
    world.agents = IMMIGRANT_NAMES.map((name, index) => ({
      ...template,
      id: `agent-${index + 1}`,
      name,
      pos: livingPositions[index] ?? { x: 0, y: 0 },
      activity: { kind: "idle" },
      tasks: [{ kind: "deposit" }],
    }));
    world.buildings = Array.from({ length: 4 }, (_, x) => ({
      kind: "house" as const,
      pos: { x, y: 3 },
      progress: HOUSE_BUILD_TICKS,
      complete: true,
    }));
    world.deaths = AGENT_NAMES.map((name) => ({ name, tick: 1, cause: "starvation" }));
    setFoodDays(world, IMMIGRATION_FOOD_DAYS_MIN);

    createEngine(world, idlePlanner, () => 0).step();

    expect(world.agents).toHaveLength(8);
    expect(world.agents[7]?.name).toBe("Dahlia 2");
  });

  it("spawns at most one immigrant at each yearly boundary", () => {
    const world = immigrationWorld();
    world.buildings.push({
      kind: "house",
      pos: { x: 2, y: 1 },
      progress: HOUSE_BUILD_TICKS,
      complete: true,
    });
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();
    expect(world.agents.map(({ name }) => name)).toEqual(["Ash", IMMIGRANT_NAMES[0]]);

    world.tick = 2 * TICKS_PER_YEAR - 1;
    setFoodDays(world, IMMIGRATION_FOOD_DAYS_MIN);
    engine.step();
    expect(world.agents.map(({ name }) => name)).toEqual([
      "Ash",
      IMMIGRANT_NAMES[0],
      IMMIGRANT_NAMES[1],
    ]);
  });
});
