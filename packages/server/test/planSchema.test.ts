import {
  type AgentState,
  type AgentTask,
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
    name: "Ash",
    pos: { x: 0, y: 0 },
    carrying: null,
    activity: { kind: "idle" },
    tasks: [],
    planSource: "fake",
    thinking: false,
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
  };
}

function expectParseFailure(result: PlanParseResult): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
}

describe("parsePlanResponse", () => {
  const response = {
    reasoning: "Gather nearby wood before winter.",
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
      parsePlanResponse(JSON.stringify({ reasoning: "Sleep.", plan: [{ kind: "sleep" }] })),
    );
  });

  it("rejects plans longer than MAX_PLAN_TASKS", () => {
    const plan = Array.from({ length: MAX_PLAN_TASKS + 1 }, () => ({ kind: "deposit" }));

    expectParseFailure(parsePlanResponse(JSON.stringify({ reasoning: "Too much.", plan })));
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
});
