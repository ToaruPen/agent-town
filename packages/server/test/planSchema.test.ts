import {
  type AgentState,
  type AgentTask,
  CARRY_CAPACITY,
  FOOD_PER_MEAL,
  HOUSE_BUILD_TICKS,
  HOUSE_WOOD_COST,
  MAX_PLAN_REASONING_CHARS,
  MAX_PLAN_TASKS,
  type Tile,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  type PlanParseResult,
  parsePlanResponse,
  validatePlanExecutability,
} from "../src/llm/planSchema.js";

function createAgent(): AgentState {
  return {
    id: "agent-1",
    name: "トネリコ",
    pos: { x: 0, y: 0 },
    carrying: null,
    activity: { kind: "idle" },
    tasks: [],
    planSource: "fake",
    llmProvider: null,
    thinking: false,
    lastThought: null,
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
  };
}

function createWorld(agent: AgentState): WorldState {
  const tiles: Tile[] = [
    { terrain: "plains", resource: null },
    { terrain: "water", resource: null },
    { terrain: "forest", resource: { kind: "wood", amount: 4 } },
    { terrain: "plains", resource: { kind: "food", amount: 5 } },
    { terrain: "rock", resource: null },
    { terrain: "plains", resource: null },
  ];
  return {
    tick: 0,
    width: 3,
    height: 2,
    tiles,
    agents: [agent],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
    },
  };
}

function expectParseFailure(result: PlanParseResult): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
}

describe("parsePlanResponse", () => {
  const response = {
    reasoning: "冬に備えて近くの木材を集める。",
    plan: [
      { kind: "moveTo", dest: { x: 2, y: 0 } },
      { kind: "gather", resource: "wood", target: { x: 2, y: 0 } },
      { kind: "deposit" },
    ],
  };

  it("accepts a clean JSON response", () => {
    expect(parsePlanResponse(JSON.stringify(response))).toEqual({
      ok: true,
      reasoning: response.reasoning,
      tasks: response.plan,
    });
  });

  it("accepts JSON in a Markdown code fence", () => {
    expect(parsePlanResponse(`\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``)).toEqual({
      ok: true,
      reasoning: response.reasoning,
      tasks: response.plan,
    });
  });

  it("accepts JSON with prose around it", () => {
    expect(parsePlanResponse(`Here is the plan:\n${JSON.stringify(response)}\nGood luck.`)).toEqual(
      {
        ok: true,
        reasoning: response.reasoning,
        tasks: response.plan,
      },
    );
  });

  it("rejects garbage without a JSON object", () => {
    expectParseFailure(parsePlanResponse("move somewhere and gather wood"));
  });

  it("rejects structurally invalid task kinds", () => {
    expectParseFailure(
      parsePlanResponse(JSON.stringify({ reasoning: "眠る。", plan: [{ kind: "sleep" }] })),
    );
  });

  it("rejects plans longer than MAX_PLAN_TASKS", () => {
    const plan = Array.from({ length: MAX_PLAN_TASKS + 1 }, () => ({ kind: "deposit" }));

    expectParseFailure(parsePlanResponse(JSON.stringify({ reasoning: "多すぎる。", plan })));
  });

  it("accepts reasoning exactly at the Unicode code point limit", () => {
    const reasoning = "🧠".repeat(MAX_PLAN_REASONING_CHARS);

    expect(parsePlanResponse(JSON.stringify({ reasoning, plan: [] }))).toEqual({
      ok: true,
      reasoning,
      tasks: [],
    });
  });

  it("rejects reasoning one astral Unicode code point over the limit", () => {
    const reasoning = "🧠".repeat(MAX_PLAN_REASONING_CHARS + 1);

    expect(parsePlanResponse(JSON.stringify({ reasoning, plan: [] }))).toEqual({
      ok: false,
      error: `reasoning exceeds ${MAX_PLAN_REASONING_CHARS} characters`,
    });
  });

  it("parses every survival task kind", () => {
    const plan = [
      { kind: "eat" },
      { kind: "forage", target: { x: 0, y: 1 } },
      { kind: "build", pos: { x: 2, y: 1 } },
      { kind: "rest" },
    ];

    expect(parsePlanResponse(JSON.stringify({ reasoning: "生き延びる。", plan }))).toEqual({
      ok: true,
      reasoning: "生き延びる。",
      tasks: plan,
    });
  });
});

describe("validatePlanExecutability", () => {
  it("rejects an out-of-bounds destination", () => {
    const agent = createAgent();
    const result = validatePlanExecutability(createWorld(agent), agent, [
      { kind: "moveTo", dest: { x: 3, y: 0 } },
    ]);

    expect(result.ok).toBe(false);
  });

  it("rejects a destination on water", () => {
    const agent = createAgent();
    const result = validatePlanExecutability(createWorld(agent), agent, [
      { kind: "moveTo", dest: { x: 1, y: 0 } },
    ]);

    expect(result.ok).toBe(false);
  });

  it("rejects a depleted gather target", () => {
    const agent = createAgent();
    const result = validatePlanExecutability(createWorld(agent), agent, [
      { kind: "gather", resource: "wood", target: { x: 2, y: 1 } },
    ]);

    expect(result.ok).toBe(false);
  });

  it("rejects an empty plan", () => {
    const agent = createAgent();

    expect(validatePlanExecutability(createWorld(agent), agent, []).ok).toBe(false);
  });

  it("rejects plans longer than MAX_PLAN_TASKS", () => {
    const agent = createAgent();
    const tasks: AgentTask[] = Array.from({ length: MAX_PLAN_TASKS + 1 }, () => ({
      kind: "deposit",
    }));

    expect(validatePlanExecutability(createWorld(agent), agent, tasks).ok).toBe(false);
  });

  it("accepts a valid wood run", () => {
    const agent = createAgent();
    const tasks: AgentTask[] = [
      { kind: "moveTo", dest: { x: 2, y: 0 } },
      { kind: "gather", resource: "wood", target: { x: 2, y: 0 } },
      { kind: "moveTo", dest: { x: 0, y: 0 } },
      { kind: "deposit" },
    ];

    expect(validatePlanExecutability(createWorld(agent), agent, tasks)).toEqual({ ok: true });
  });

  it("accepts eat only when every planned meal is funded", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.stockpile.food = FOOD_PER_MEAL * 2;

    expect(validatePlanExecutability(world, agent, [{ kind: "eat" }, { kind: "eat" }])).toEqual({
      ok: true,
    });
    expect(
      validatePlanExecutability(world, agent, [{ kind: "eat" }, { kind: "eat" }, { kind: "eat" }])
        .ok,
    ).toBe(false);
  });

  it("funds a later eat from carried food deposited earlier in the plan", () => {
    const agent = createAgent();
    agent.carrying = { kind: "food", amount: FOOD_PER_MEAL };
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "moveTo", dest: world.stockpile.pos },
        { kind: "deposit" },
        { kind: "eat" },
      ]),
    ).toEqual({ ok: true });
  });

  it("funds a later build from carried wood deposited earlier in the plan", () => {
    const agent = createAgent();
    agent.carrying = { kind: "wood", amount: HOUSE_WOOD_COST };
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "deposit" },
        { kind: "build", pos: { x: 2, y: 1 } },
      ]),
    ).toEqual({ ok: true });
  });

  it("applies the current carried resource to the budget at most once", () => {
    const agent = createAgent();
    agent.carrying = { kind: "food", amount: FOOD_PER_MEAL };
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "deposit" },
        { kind: "eat" },
        { kind: "deposit" },
        { kind: "eat" },
      ]).ok,
    ).toBe(false);
  });

  it("does not increase the budget when depositing empty hands", () => {
    const agent = createAgent();
    const world = createWorld(agent);

    expect(validatePlanExecutability(world, agent, [{ kind: "deposit" }, { kind: "eat" }]).ok).toBe(
      false,
    );
    expect(
      validatePlanExecutability(world, agent, [
        { kind: "deposit" },
        { kind: "build", pos: { x: 2, y: 1 } },
      ]).ok,
    ).toBe(false);
  });

  it("rejects remotely depositing carried food before eat", () => {
    const agent = createAgent();
    agent.pos = { x: 2, y: 1 };
    agent.carrying = { kind: "food", amount: FOOD_PER_MEAL };
    const world = createWorld(agent);

    expect(validatePlanExecutability(world, agent, [{ kind: "deposit" }, { kind: "eat" }]).ok).toBe(
      false,
    );
  });

  it("rejects remotely gathering and depositing food", () => {
    const agent = createAgent();
    agent.pos = { x: 2, y: 1 };
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "eat" },
      ]).ok,
    ).toBe(false);
  });

  it("accepts explicit movement before gather and deposit", () => {
    const agent = createAgent();
    agent.pos = { x: 2, y: 1 };
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "moveTo", dest: { x: 0, y: 1 } },
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "moveTo", dest: world.stockpile.pos },
        { kind: "deposit" },
        { kind: "eat" },
      ]),
    ).toEqual({ ok: true });
  });

  it("rejects position-dependent credit after an autonomous action", () => {
    const agent = createAgent();
    agent.carrying = { kind: "food", amount: FOOD_PER_MEAL };
    const world = createWorld(agent);
    world.stockpile.food = FOOD_PER_MEAL;

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "eat" },
        { kind: "deposit" },
        { kind: "eat" },
      ]).ok,
    ).toBe(false);
  });

  it("uses forage exact target as the cursor for an adjacent deposit", () => {
    const agent = createAgent();
    agent.pos = { x: 2, y: 0 };
    agent.carrying = { kind: "wood", amount: HOUSE_WOOD_COST };
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "forage", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "build", pos: { x: 2, y: 1 } },
      ]),
    ).toEqual({ ok: true });
  });

  it("overwrites initial carrying when gather precedes deposit", () => {
    const agent = createAgent();
    agent.carrying = { kind: "wood", amount: HOUSE_WOOD_COST };
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "build", pos: { x: 2, y: 1 } },
      ]).ok,
    ).toBe(false);
  });

  it("funds eat from food gathered and deposited earlier in the plan", () => {
    const agent = createAgent();
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "eat" },
      ]),
    ).toEqual({ ok: true });
  });

  it("caps planned gather carrying before deposit", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const foodTile = world.tiles[3];
    if (foodTile?.resource?.kind !== "food") throw new Error("missing food fixture");
    foodTile.resource.amount = CARRY_CAPACITY * 2;

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "eat" },
        { kind: "eat" },
      ]).ok,
    ).toBe(false);
  });

  it("tracks deposit, gather, and deposit as sequential carrying states", () => {
    const agent = createAgent();
    agent.carrying = { kind: "wood", amount: HOUSE_WOOD_COST };
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "deposit" },
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "eat" },
        { kind: "build", pos: { x: 2, y: 1 } },
      ]),
    ).toEqual({ ok: true });
  });

  it("rejects gathering the same depleted food target twice", () => {
    const agent = createAgent();
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "eat" },
        { kind: "eat" },
      ]).ok,
    ).toBe(false);
  });

  it("rejects gathering a food target depleted by forage", () => {
    const agent = createAgent();
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "forage", target: { x: 0, y: 1 } },
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
      ]).ok,
    ).toBe(false);
  });

  it("rejects repeated forage at a depleted target", () => {
    const agent = createAgent();
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "forage", target: { x: 0, y: 1 } },
        { kind: "forage", target: { x: 0, y: 1 } },
      ]).ok,
    ).toBe(false);
  });

  it("keeps carrying unchanged while forage consumes its target", () => {
    const agent = createAgent();
    agent.carrying = { kind: "wood", amount: HOUSE_WOOD_COST };
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "forage", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "build", pos: { x: 2, y: 1 } },
      ]),
    ).toEqual({ ok: true });
  });

  it("allows two gathers when a target holds two carry loads", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const foodTile = world.tiles[3];
    if (foodTile?.resource?.kind !== "food") throw new Error("missing food fixture");
    foodTile.resource.amount = CARRY_CAPACITY * 2;

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "eat" },
        { kind: "eat" },
      ]),
    ).toEqual({ ok: true });
  });

  it("tracks resource remaining independently by tile", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.tiles[5] = {
      terrain: "plains",
      resource: { kind: "food", amount: FOOD_PER_MEAL },
    };

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "deposit" },
        { kind: "moveTo", dest: { x: 2, y: 1 } },
        { kind: "gather", resource: "food", target: { x: 2, y: 1 } },
        { kind: "moveTo", dest: world.stockpile.pos },
        { kind: "deposit" },
        { kind: "eat" },
        { kind: "eat" },
      ]),
    ).toEqual({ ok: true });
  });

  it("allows a new build on a resource site depleted earlier in the plan", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.stockpile.wood = HOUSE_WOOD_COST;

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
        { kind: "build", pos: { x: 0, y: 1 } },
      ]),
    ).toEqual({ ok: true });
  });

  it("does not mutate world resources while validating planned depletion", () => {
    const agent = createAgent();
    const world = createWorld(agent);

    validatePlanExecutability(world, agent, [
      { kind: "gather", resource: "food", target: { x: 0, y: 1 } },
      { kind: "deposit" },
    ]);

    expect(world.tiles[3]?.resource).toEqual({ kind: "food", amount: FOOD_PER_MEAL });
  });

  it("validates forage targets as live food tiles", () => {
    const agent = createAgent();
    const world = createWorld(agent);

    expect(
      validatePlanExecutability(world, agent, [{ kind: "forage", target: { x: 0, y: 1 } }]),
    ).toEqual({ ok: true });
    expect(
      validatePlanExecutability(world, agent, [{ kind: "forage", target: { x: 2, y: 0 } }]).ok,
    ).toBe(false);
    expect(
      validatePlanExecutability(world, agent, [{ kind: "forage", target: { x: 3, y: 0 } }]).ok,
    ).toBe(false);
  });

  it("accepts rest without a position", () => {
    const agent = createAgent();

    expect(validatePlanExecutability(createWorld(agent), agent, [{ kind: "rest" }])).toEqual({
      ok: true,
    });
  });

  it("accepts affordable new builds and charges the validation budget cumulatively", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.stockpile.wood = HOUSE_WOOD_COST * 2;
    world.tiles[4] = { terrain: "plains", resource: null };

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "build", pos: { x: 2, y: 1 } },
        { kind: "build", pos: { x: 1, y: 1 } },
      ]),
    ).toEqual({ ok: true });

    world.stockpile.wood -= 1;
    expect(
      validatePlanExecutability(world, agent, [
        { kind: "build", pos: { x: 2, y: 1 } },
        { kind: "build", pos: { x: 1, y: 1 } },
      ]).ok,
    ).toBe(false);
  });

  it("rejects moveTo onto a site that a build action navigates to itself", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.stockpile.wood = HOUSE_WOOD_COST;

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "moveTo", dest: { x: 2, y: 1 } },
        { kind: "build", pos: { x: 2, y: 1 } },
      ]).ok,
    ).toBe(false);
  });

  it("rejects forage onto a site used by a later build", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.stockpile.wood = HOUSE_WOOD_COST;

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "forage", target: { x: 0, y: 1 } },
        { kind: "build", pos: { x: 0, y: 1 } },
      ]).ok,
    ).toBe(false);
  });

  it("allows forage and build at different valid positions", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.stockpile.wood = HOUSE_WOOD_COST;

    expect(
      validatePlanExecutability(world, agent, [
        { kind: "forage", target: { x: 0, y: 1 } },
        { kind: "build", pos: { x: 2, y: 1 } },
      ]),
    ).toEqual({ ok: true });
  });

  it("rejects invalid new build sites", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.stockpile.wood = HOUSE_WOOD_COST;
    const other = { ...createAgent(), id: "agent-2", pos: { x: 2, y: 1 } };

    expect(
      validatePlanExecutability(world, agent, [{ kind: "build", pos: world.stockpile.pos }]).ok,
    ).toBe(false);
    expect(
      validatePlanExecutability(world, agent, [{ kind: "build", pos: { x: 2, y: 0 } }]).ok,
    ).toBe(false);
    expect(
      validatePlanExecutability({ ...world, agents: [agent, other] }, agent, [
        { kind: "build", pos: other.pos },
      ]).ok,
    ).toBe(false);
    expect(
      validatePlanExecutability(world, agent, [{ kind: "build", pos: { x: 3, y: 0 } }]).ok,
    ).toBe(false);
  });

  it("allows incomplete-house resume for free but rejects complete houses", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.buildings = [
      { kind: "house", pos: { x: 2, y: 1 }, progress: 20, complete: false },
      { kind: "house", pos: { x: 1, y: 1 }, progress: HOUSE_BUILD_TICKS, complete: true },
    ];

    expect(
      validatePlanExecutability(world, agent, [{ kind: "build", pos: { x: 2, y: 1 } }]),
    ).toEqual({ ok: true });
    expect(
      validatePlanExecutability(world, agent, [{ kind: "build", pos: { x: 1, y: 1 } }]).ok,
    ).toBe(false);
  });
});
