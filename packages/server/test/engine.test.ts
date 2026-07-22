import {
  type AgentTask,
  FATIGUE_DECAY_PER_DAY,
  FATIGUE_MAX,
  HUNGER_DECAY_PER_DAY,
  HUNGER_MAX,
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
