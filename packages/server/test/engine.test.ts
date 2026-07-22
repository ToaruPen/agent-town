import {
  type AgentTask,
  EAT_TICKS,
  FATIGUE_DECAY_PER_DAY,
  FATIGUE_MAX,
  FOOD_PER_MEAL,
  HEALTH_MAX,
  HUNGER_DECAY_PER_DAY,
  HUNGER_EAT_THRESHOLD,
  HUNGER_MAX,
  MOVE_TICKS_PER_TILE,
  STARVATION_HEALTH_PER_DAY,
  TICKS_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEngine } from "../src/sim/engine.js";
import { FakePlanner, type Planner } from "../src/sim/fakePlanner.js";
import { createRng } from "../src/sim/rng.js";
import { generateWorld } from "../src/sim/worldGen.js";

const ACCEPTANCE_STEPS = 3000;
const idlePlanner: Planner = { plan: () => [] };

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
});
