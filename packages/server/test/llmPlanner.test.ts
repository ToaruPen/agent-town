import {
  type AgentState,
  type AgentTask,
  FOOD_PER_MEAL,
  MAX_PLAN_TASKS,
  type Tile,
  type WorldState,
} from "@agent-town/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LlmPlanner } from "../src/llm/llmPlanner.js";
import type { LlmRunner } from "../src/llm/llmRunner.js";
import type { Planner } from "../src/sim/fakePlanner.js";

function createAgent(): AgentState {
  return {
    id: "agent-1",
    name: "Ash",
    pos: { x: 0, y: 0 },
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
  const tiles: Tile[] = [
    { terrain: "plains", resource: null },
    { terrain: "water", resource: null },
    { terrain: "forest", resource: { kind: "wood", amount: 4 } },
  ];
  return {
    tick: 0,
    width: 3,
    height: 1,
    tiles,
    agents: [agent],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
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

function validResponse(tasks: AgentTask[]): string {
  return JSON.stringify({ reasoning: "Gather nearby wood.", plan: tasks });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LlmPlanner", () => {
  it("inserts movement before validating a gather-only LLM plan", async () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.tiles[1] = { terrain: "plains", resource: null };
    const gather: AgentTask = {
      kind: "gather",
      resource: "wood",
      target: { x: 2, y: 0 },
    };
    const run = vi.fn(async () => ({ ok: true as const, text: validResponse([gather]) }));
    const runner: LlmRunner = { run };
    const fallback: Planner = { plan: vi.fn((): AgentTask[] => [{ kind: "deposit" }]) };
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new LlmPlanner("claude", runner, fallback).planAsync(world, agent);

    expect(result).toEqual({
      tasks: [{ kind: "moveTo", dest: { x: 1, y: 0 } }, gather],
      source: "llm",
      reasoning: "Gather nearby wood.",
    });
    expect(run).toHaveBeenCalledOnce();
    expect(fallback.plan).not.toHaveBeenCalled();
  });

  it("returns executable tasks and reasoning from a valid LLM response", async () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.tiles[1] = { terrain: "plains", resource: null };
    const tasks: AgentTask[] = [
      { kind: "moveTo", dest: { x: 2, y: 0 } },
      { kind: "gather", resource: "wood", target: { x: 2, y: 0 } },
    ];
    const run = vi.fn(async () => ({ ok: true as const, text: validResponse(tasks) }));
    const runner: LlmRunner = { run };
    const fallback: Planner = { plan: vi.fn((): AgentTask[] => [{ kind: "deposit" }]) };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new LlmPlanner("codex", runner, fallback).planAsync(world, agent);

    expect(result).toEqual({
      tasks,
      source: "llm",
      reasoning: "Gather nearby wood.",
    });
    expect(run).toHaveBeenCalledOnce();
    expect(fallback.plan).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        at: "llmPlanner",
        agent: agent.id,
        provider: "codex",
        attempt: 1,
        outcome: "llm",
      }),
    );
  });

  it("sanitizes extra ok fields on authored positions before normalization", async () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.tiles[1] = { terrain: "plains", resource: null };
    const run = vi.fn(async () => ({
      ok: true as const,
      text: JSON.stringify({
        reasoning: "Move beside the wood and gather it.",
        plan: [
          { kind: "moveTo", dest: { x: 1, y: 0, ok: true } },
          { kind: "gather", resource: "wood", target: { x: 2, y: 0, ok: true } },
        ],
      }),
    }));
    const runner: LlmRunner = { run };
    const fallback: Planner = { plan: vi.fn((): AgentTask[] => [{ kind: "deposit" }]) };
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new LlmPlanner("claude", runner, fallback).planAsync(world, agent);

    expect(result).toEqual({
      tasks: [
        { kind: "moveTo", dest: { x: 1, y: 0 } },
        { kind: "gather", resource: "wood", target: { x: 2, y: 0 } },
      ],
      source: "llm",
      reasoning: "Move beside the wood and gather it.",
    });
    expect(run).toHaveBeenCalledOnce();
    expect(fallback.plan).not.toHaveBeenCalled();
  });

  it("never calls the runner with an empty prompt", async () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const tasks: AgentTask[] = [{ kind: "moveTo", dest: { x: 2, y: 0 } }];
    const run = vi.fn(async (_prompt: string) => ({
      ok: true as const,
      text: validResponse(tasks),
    }));
    const runner: LlmRunner = { run };
    const fallback: Planner = { plan: vi.fn((): AgentTask[] => [{ kind: "deposit" }]) };
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await new LlmPlanner("claude", runner, fallback).planAsync(world, agent);

    expect(run).toHaveBeenCalledWith(expect.stringContaining("Ash"));
  });

  it("retries garbage twice before returning fallback tasks with fake source", async () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const fallbackTasks: AgentTask[] = [{ kind: "deposit" }];
    const run = vi.fn(async () => ({ ok: true as const, text: "not JSON" }));
    const runner: LlmRunner = { run };
    const fallbackPlan = vi.fn((): AgentTask[] => fallbackTasks);
    const fallback: Planner = { plan: fallbackPlan };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new LlmPlanner("claude", runner, fallback).planAsync(world, agent);

    expect(result).toEqual({ tasks: fallbackTasks, source: "fake" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(fallbackPlan).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({
        at: "llmPlanner",
        agent: agent.id,
        provider: "claude",
        attempt: 1,
        outcome: "error",
        error: "response has no balanced JSON object",
      }),
    );
    expect(log).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({
        at: "llmPlanner",
        agent: agent.id,
        provider: "claude",
        attempt: 2,
        outcome: "error",
        error: "response has no balanced JSON object",
      }),
    );
    expect(log).toHaveBeenLastCalledWith(
      JSON.stringify({ at: "llmPlanner", agent: agent.id, provider: "claude", outcome: "fake" }),
    );
  });

  it("retries runner rejections twice before returning fallback tasks", async () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const fallbackTasks: AgentTask[] = [{ kind: "deposit" }];
    const run = vi
      .fn<LlmRunner["run"]>()
      .mockRejectedValue(new Error("sensitive prompt and credential details"));
    const fallbackPlan = vi.fn((): AgentTask[] => fallbackTasks);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new LlmPlanner("claude", { run }, { plan: fallbackPlan }).planAsync(
      world,
      agent,
    );

    expect(result).toEqual({ tasks: fallbackTasks, source: "fake" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(fallbackPlan).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledTimes(3);
    for (const attempt of [1, 2]) {
      expect(log).toHaveBeenNthCalledWith(
        attempt,
        JSON.stringify({
          at: "llmPlanner",
          agent: agent.id,
          provider: "claude",
          attempt,
          outcome: "error",
          error: "runner rejected",
        }),
      );
    }
    expect(log).toHaveBeenLastCalledWith(
      JSON.stringify({ at: "llmPlanner", agent: agent.id, provider: "claude", outcome: "fake" }),
    );
    expect(log.mock.calls.flat().join("\n")).not.toContain("sensitive");
  });

  it("returns LLM tasks when garbage is followed by a valid response", async () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.tiles[1] = { terrain: "plains", resource: null };
    const tasks: AgentTask[] = [{ kind: "moveTo", dest: { x: 2, y: 0 } }];
    const run = vi
      .fn<LlmRunner["run"]>()
      .mockResolvedValueOnce({ ok: true, text: "not JSON" })
      .mockResolvedValueOnce({ ok: true, text: validResponse(tasks) });
    const runner: LlmRunner = { run };
    const fallbackPlan = vi.fn((): AgentTask[] => [{ kind: "deposit" }]);
    const fallback: Planner = { plan: fallbackPlan };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new LlmPlanner("claude", runner, fallback).planAsync(world, agent);

    expect(result).toEqual({
      tasks,
      source: "llm",
      reasoning: "Gather nearby wood.",
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(fallbackPlan).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({
        at: "llmPlanner",
        agent: agent.id,
        provider: "claude",
        attempt: 1,
        outcome: "error",
        error: "response has no balanced JSON object",
      }),
    );
    expect(log).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({
        at: "llmPlanner",
        agent: agent.id,
        provider: "claude",
        attempt: 2,
        outcome: "llm",
      }),
    );
  });

  it("retries unexecutable plans before falling back", async () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const fallbackTasks: AgentTask[] = [{ kind: "deposit" }];
    const unexecutableTasks: AgentTask[] = [{ kind: "moveTo", dest: { x: 1, y: 0 } }];
    const run = vi.fn(async () => ({
      ok: true as const,
      text: validResponse(unexecutableTasks),
    }));
    const runner: LlmRunner = { run };
    const fallback: Planner = { plan: vi.fn((): AgentTask[] => fallbackTasks) };
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new LlmPlanner("claude", runner, fallback).planAsync(world, agent);

    expect(result).toEqual({ tasks: fallbackTasks, source: "fake" });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries plans whose authored movement cannot reach its destination", async () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const fallbackTasks: AgentTask[] = [{ kind: "deposit" }];
    const run = vi.fn(async () => ({
      ok: true as const,
      text: validResponse([{ kind: "moveTo", dest: { x: 2, y: 0 } }]),
    }));
    const runner: LlmRunner = { run };
    const fallback: Planner = { plan: vi.fn((): AgentTask[] => fallbackTasks) };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new LlmPlanner("claude", runner, fallback).planAsync(world, agent);

    expect(result).toEqual({ tasks: fallbackTasks, source: "fake" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(3);
    for (const [line] of log.mock.calls.slice(0, 2)) expect(line).toContain("unreachable");
    expect(log).toHaveBeenLastCalledWith(
      JSON.stringify({ at: "llmPlanner", agent: agent.id, provider: "claude", outcome: "fake" }),
    );
  });

  it("accepts MAX_PLAN_TASKS authored actions when normalization inserts extra movement", async () => {
    const agent = createAgent();
    const world = createWorld(agent);
    world.tiles = [
      { terrain: "plains", resource: { kind: "food", amount: FOOD_PER_MEAL * 4 } },
      { terrain: "plains", resource: null },
      { terrain: "forest", resource: { kind: "food", amount: FOOD_PER_MEAL * 4 } },
    ];
    const authored: AgentTask[] = Array.from({ length: MAX_PLAN_TASKS }, (_, index) => ({
      kind: "forage",
      target: index % 2 === 0 ? { x: 2, y: 0 } : { x: 0, y: 0 },
    }));
    const run = vi.fn(async () => ({ ok: true as const, text: validResponse(authored) }));
    const runner: LlmRunner = { run };
    const fallback: Planner = { plan: vi.fn((): AgentTask[] => [{ kind: "deposit" }]) };
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await new LlmPlanner("claude", runner, fallback).planAsync(world, agent);

    expect(result.source).toBe("llm");
    expect(result.tasks.filter(({ kind }) => kind === "forage")).toHaveLength(MAX_PLAN_TASKS);
    expect(result.tasks.length).toBeGreaterThan(MAX_PLAN_TASKS);
    expect(run).toHaveBeenCalledOnce();
    expect(fallback.plan).not.toHaveBeenCalled();
  });
});
