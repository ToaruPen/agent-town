import {
  type AgentState,
  type AgentTask,
  FOOD_PER_MEAL,
  HOUSE_BUILD_TICKS,
  HOUSE_WOOD_COST,
  MAX_PLAN_TASKS,
  type Position,
  type Tile,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { normalizePlan } from "../src/llm/normalizePlan.js";
import {
  validateNormalizedPlanExecutability,
  validatePlanExecutability,
} from "../src/llm/planSchema.js";

function createAgent(pos: Position = { x: 0, y: 0 }): AgentState {
  return {
    id: "agent-1",
    name: "Ash",
    pos,
    carrying: null,
    activity: { kind: "idle" },
    tasks: [],
    planSource: "fake",
    llmProvider: null,
    thinking: false,
    lastThought: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
  };
}

function createWorld(agent: AgentState): WorldState {
  const width = 4;
  const height = 2;
  const tiles: Tile[] = Array.from({ length: width * height }, () => ({
    terrain: "plains",
    resource: null,
  }));
  tiles[2] = { terrain: "forest", resource: { kind: "wood", amount: 4 } };
  return {
    tick: 0,
    width,
    height,
    tiles,
    agents: [agent],
    stockpile: { pos: { x: 3, y: 0 }, wood: 0, food: FOOD_PER_MEAL },
    buildings: [
      {
        kind: "house",
        pos: { x: 3, y: 1 },
        progress: HOUSE_BUILD_TICKS,
        complete: true,
      },
    ],
    deaths: [],
  };
}

describe("normalizePlan", () => {
  it.each<{
    name: string;
    task: AgentTask;
    destination: Position;
  }>([
    {
      name: "gather",
      task: { kind: "gather", resource: "wood", target: { x: 2, y: 0 } },
      destination: { x: 1, y: 0 },
    },
    {
      name: "forage",
      task: { kind: "forage", target: { x: 2, y: 0 } },
      destination: { x: 2, y: 0 },
    },
    {
      name: "eat",
      task: { kind: "eat" },
      destination: { x: 3, y: 0 },
    },
    {
      name: "build",
      task: { kind: "build", pos: { x: 2, y: 0 } },
      destination: { x: 1, y: 0 },
    },
    {
      name: "rest",
      task: { kind: "rest" },
      destination: { x: 3, y: 1 },
    },
  ])("inserts movement before a distant $name task", ({ task, destination }) => {
    const agent = createAgent();

    expect(normalizePlan(createWorld(agent), agent, [task])).toEqual({
      ok: true,
      tasks: [{ kind: "moveTo", dest: destination }, task],
    });
  });

  it("uses the stockpile as the rest target when there is no completed house", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.buildings = [];

    expect(normalizePlan(world, agent, [{ kind: "rest" }])).toEqual({
      ok: true,
      tasks: [{ kind: "moveTo", dest: world.stockpile.pos }, { kind: "rest" }],
    });
  });

  it("does not duplicate movement when the tracked position is already adjacent", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const tasks: AgentTask[] = [
      { kind: "moveTo", dest: { x: 1, y: 0 } },
      { kind: "gather", resource: "wood", target: { x: 2, y: 0 } },
    ];

    expect(normalizePlan(world, agent, tasks)).toEqual({ ok: true, tasks });
  });

  it("does not search for an approach when already on an incomplete build site", () => {
    const agent = createAgent({ x: 1, y: 1 });
    const world = createWorld(agent);
    world.buildings = [{ kind: "house", pos: agent.pos, progress: 1, complete: false }];
    world.tiles[1] = { terrain: "water", resource: null };
    world.tiles[4] = { terrain: "water", resource: null };
    world.tiles[6] = { terrain: "water", resource: null };
    const tasks: AgentTask[] = [{ kind: "build", pos: agent.pos }];

    expect(normalizePlan(world, agent, tasks)).toEqual({ ok: true, tasks });
  });

  it("moves onto an adjacent forage target because forage requires the exact tile", () => {
    const agent = createAgent({ x: 1, y: 0 });
    const world = createWorld(agent);
    world.tiles[2] = { terrain: "forest", resource: { kind: "food", amount: FOOD_PER_MEAL } };

    expect(normalizePlan(world, agent, [{ kind: "forage", target: { x: 2, y: 0 } }])).toEqual({
      ok: true,
      tasks: [
        { kind: "moveTo", dest: { x: 2, y: 0 } },
        { kind: "forage", target: { x: 2, y: 0 } },
      ],
    });
  });

  it("moves onto an adjacent rest target because rest requires the exact tile", () => {
    const agent = createAgent({ x: 2, y: 1 });
    const world = createWorld(agent);

    expect(normalizePlan(world, agent, [{ kind: "rest" }])).toEqual({
      ok: true,
      tasks: [{ kind: "moveTo", dest: { x: 3, y: 1 } }, { kind: "rest" }],
    });
  });

  it("tracks a forage destination for the following positional task", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const tasks: AgentTask[] = [{ kind: "forage", target: { x: 2, y: 0 } }, { kind: "eat" }];

    expect(normalizePlan(world, agent, tasks)).toEqual({
      ok: true,
      tasks: [{ kind: "moveTo", dest: { x: 2, y: 0 } }, tasks[0], tasks[1]],
    });
  });

  it("makes a gather-only plan executable without changing the raw validation rule", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const tasks: AgentTask[] = [{ kind: "gather", resource: "wood", target: { x: 2, y: 0 } }];

    expect(validatePlanExecutability(world, agent, tasks)).toEqual({
      ok: false,
      error: "agent agent-1 task[0]: gather requires an explicit position beside its target",
    });
    const normalized = normalizePlan(world, agent, tasks);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(validateNormalizedPlanExecutability(world, agent, normalized.tasks)).toEqual({
      ok: true,
    });
  });

  it("approaches gather from beside the target so the depleted site can be built on", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.stockpile.wood = HOUSE_WOOD_COST;
    const gather: AgentTask = {
      kind: "gather",
      resource: "wood",
      target: { x: 2, y: 0 },
    };
    const build: AgentTask = { kind: "build", pos: gather.target };

    const normalized = normalizePlan(world, agent, [gather, build]);

    expect(normalized).toEqual({
      ok: true,
      tasks: [{ kind: "moveTo", dest: { x: 1, y: 0 } }, gather, build],
    });
    if (!normalized.ok) return;
    expect(validateNormalizedPlanExecutability(world, agent, normalized.tasks)).toEqual({
      ok: true,
    });
  });

  it("keeps rejecting an out-of-bounds positional target after normalization", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const tasks: AgentTask[] = [
      { kind: "gather", resource: "wood", target: { x: world.width, y: 0 } },
    ];

    const normalized = normalizePlan(world, agent, tasks);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(validateNormalizedPlanExecutability(world, agent, normalized.tasks).ok).toBe(false);
  });

  it("keeps rejecting an unwalkable positional target after normalization", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.tiles[2] = { terrain: "water", resource: { kind: "food", amount: FOOD_PER_MEAL } };
    const tasks: AgentTask[] = [{ kind: "forage", target: { x: 2, y: 0 } }];

    const normalized = normalizePlan(world, agent, tasks);
    expect(normalized.ok).toBe(false);
    if (normalized.ok) return;
    expect(normalized.error).toContain("unreachable");
  });

  it("keeps rejecting a gather target without its resource after normalization", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const tasks: AgentTask[] = [{ kind: "gather", resource: "wood", target: { x: 3, y: 1 } }];

    const normalized = normalizePlan(world, agent, tasks);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(validateNormalizedPlanExecutability(world, agent, normalized.tasks).ok).toBe(false);
  });

  it("keeps rejecting an unaffordable build after normalization", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const tasks: AgentTask[] = [{ kind: "build", pos: { x: 2, y: 1 } }];

    const normalized = normalizePlan(world, agent, tasks);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(validateNormalizedPlanExecutability(world, agent, normalized.tasks).ok).toBe(false);
  });

  it("keeps rejecting a build with no walkable approach after normalization", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.stockpile.wood = HOUSE_WOOD_COST;
    world.tiles[1] = { terrain: "water", resource: null };
    world.tiles[4] = { terrain: "water", resource: null };
    world.tiles[6] = { terrain: "water", resource: null };
    const tasks: AgentTask[] = [{ kind: "build", pos: { x: 1, y: 1 } }];

    const normalized = normalizePlan(world, agent, tasks);
    expect(normalized.ok).toBe(false);
    if (normalized.ok) return;
    expect(normalized.error).toContain("unreachable");
  });

  it.each<{
    name: string;
    prepare: (world: WorldState) => AgentTask;
  }>([
    {
      name: "gather",
      prepare: () => ({ kind: "gather", resource: "wood", target: { x: 2, y: 0 } }),
    },
    {
      name: "forage",
      prepare: (world) => {
        world.tiles[2] = {
          terrain: "forest",
          resource: { kind: "food", amount: FOOD_PER_MEAL },
        };
        return { kind: "forage", target: { x: 2, y: 0 } };
      },
    },
    { name: "eat", prepare: () => ({ kind: "eat" }) },
    {
      name: "build",
      prepare: (world) => {
        world.stockpile.wood = HOUSE_WOOD_COST;
        return { kind: "build", pos: { x: 2, y: 1 } };
      },
    },
    { name: "rest", prepare: () => ({ kind: "rest" }) },
  ])("rejects a $name destination separated by a water wall", ({ prepare }) => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.tiles[1] = { terrain: "water", resource: null };
    world.tiles[5] = { terrain: "water", resource: null };

    const result = normalizePlan(world, agent, [prepare(world)]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("unreachable");
  });

  it("rejects an authored moveTo destination separated by a water wall", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.tiles[1] = { terrain: "water", resource: null };
    world.tiles[5] = { terrain: "water", resource: null };

    expect(normalizePlan(world, agent, [{ kind: "moveTo", dest: { x: 2, y: 0 } }])).toEqual({
      ok: false,
      error: "task[0] moveTo destination is unreachable",
    });
  });

  it.each<{
    name: string;
    prepare: (world: WorldState, agent: AgentState) => AgentTask[];
  }>([
    {
      name: "eat",
      prepare: (world, agent) => {
        agent.pos = world.stockpile.pos;
        agent.carrying = { kind: "wood", amount: 1 };
        return [{ kind: "eat" }, { kind: "deposit" }];
      },
    },
    {
      name: "build",
      prepare: (world, agent) => {
        agent.pos = { x: 1, y: 0 };
        world.stockpile.wood = HOUSE_WOOD_COST;
        return [
          { kind: "build", pos: { x: 1, y: 1 } },
          { kind: "gather", resource: "wood", target: { x: 2, y: 0 } },
        ];
      },
    },
    {
      name: "rest",
      prepare: (_world, agent) => {
        agent.pos = { x: 3, y: 1 };
        agent.carrying = { kind: "wood", amount: 1 };
        return [{ kind: "rest" }, { kind: "deposit" }];
      },
    },
  ])("preserves the known cursor after normalized $name", ({ prepare }) => {
    const agent = createAgent();
    const world = createWorld(agent);
    const tasks = prepare(world, agent);
    const normalized = normalizePlan(world, agent, tasks);

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(validatePlanExecutability(world, agent, normalized.tasks).ok).toBe(false);
    expect(validateNormalizedPlanExecutability(world, agent, normalized.tasks)).toEqual({
      ok: true,
    });
  });

  it("accepts more than MAX_PLAN_TASKS after preserving all authored positional tasks", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const targets = [
      { x: 0, y: 1 },
      { x: 2, y: 0 },
    ];
    world.tiles[4] = {
      terrain: "plains",
      resource: { kind: "food", amount: FOOD_PER_MEAL * (MAX_PLAN_TASKS / 2) },
    };
    world.tiles[2] = {
      terrain: "forest",
      resource: { kind: "food", amount: FOOD_PER_MEAL * (MAX_PLAN_TASKS / 2) },
    };
    const authored: AgentTask[] = Array.from({ length: MAX_PLAN_TASKS }, (_, index) => ({
      kind: "forage",
      target: targets[index % targets.length] ?? targets[0] ?? { x: 0, y: 0 },
    }));

    const normalized = normalizePlan(world, agent, authored);

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.tasks.filter(({ kind }) => kind === "forage")).toHaveLength(MAX_PLAN_TASKS);
    expect(normalized.tasks.length).toBeGreaterThan(MAX_PLAN_TASKS);
    expect(validatePlanExecutability(world, agent, normalized.tasks).ok).toBe(false);
    expect(validateNormalizedPlanExecutability(world, agent, normalized.tasks)).toEqual({
      ok: true,
    });
  });
});
