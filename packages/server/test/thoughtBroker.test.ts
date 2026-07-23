import {
  type AgentState,
  type AgentTask,
  COLD_HEALTH_PER_DAY,
  DAYS_PER_SEASON,
  HEALTH_MAX,
  HOUSE_BUILD_TICKS,
  HUNGER_EAT_THRESHOLD,
  IMMIGRANT_NAMES,
  type LlmProvider,
  type PlanSource,
  SEASONS,
  THINK_COOLDOWN_TICKS,
  TICKS_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it, vi } from "vitest";

import { ThoughtBroker } from "../src/llm/thoughtBroker.js";
import { createEngine, type Engine } from "../src/sim/engine.js";
import { FakePlanner } from "../src/sim/fakePlanner.js";
import { createRng } from "../src/sim/rng.js";
import { generateWorld } from "../src/sim/worldGen.js";

interface PlanResult {
  tasks: AgentTask[];
  source: PlanSource;
  reasoning?: string;
}

interface DeferredPlan {
  promise: Promise<PlanResult>;
  resolve(result: PlanResult): void;
}

function createDeferredPlan(): DeferredPlan {
  let resolvePromise: ((result: PlanResult) => void) | undefined;
  const promise = new Promise<PlanResult>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(result: PlanResult): void {
      if (resolvePromise === undefined) throw new Error("deferred plan is not initialized");
      resolvePromise(result);
    },
  };
}

function createTestEngine(seed = 42): Engine {
  const rng = createRng(seed);
  return createEngine(generateWorld(seed), new FakePlanner(rng), rng);
}

function getAgent(engine: Engine, index: number): AgentState {
  const agent = engine.world.agents[index];
  if (agent === undefined) throw new Error(`missing test agent at index ${index}`);
  return agent;
}

describe("ThoughtBroker", () => {
  it("dispatches for an empty task queue and applies the resolved plan", async () => {
    const engine = createTestEngine();
    const agent = getAgent(engine, 0);
    const pending = createDeferredPlan();
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> =>
        pending.promise,
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [agent.id],
      providerForAgent: () => "claude",
      planFn,
    });
    const tasks: AgentTask[] = [{ kind: "deposit" }];

    broker.onTick();

    expect(planFn).toHaveBeenCalledOnce();
    expect(planFn).toHaveBeenCalledWith(engine.world, agent, "claude");
    expect(agent.llmProvider).toBe("claude");
    expect(agent.thinking).toBe(true);
    expect(broker.inFlightCount()).toBe(1);

    pending.resolve({ tasks, source: "llm", reasoning: "Return the gathered supplies." });
    await pending.promise;

    expect(agent.tasks).toEqual(tasks);
    expect(agent.planSource).toBe("llm");
    expect(agent.thinking).toBe(false);
    expect(agent.lastThought).toBe("Return the gathered supplies.");
    expect(broker.inFlightCount()).toBe(0);
  });

  it("dispatches at a day boundary even when tasks remain", async () => {
    const engine = createTestEngine();
    const agent = getAgent(engine, 0);
    agent.tasks = [{ kind: "deposit" }];
    engine.world.tick = TICKS_PER_DAY;
    const pending = createDeferredPlan();
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> =>
        pending.promise,
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [agent.id],
      providerForAgent: () => "claude",
      planFn,
    });

    broker.onTick();

    expect(planFn).toHaveBeenCalledOnce();
    expect(agent.thinking).toBe(true);

    pending.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await pending.promise;
  });

  it("observes winter hooks after engine step returns at the day boundary", async () => {
    const engine = createTestEngine();
    const doomed = getAgent(engine, 0);
    const observer = getAgent(engine, 1);
    engine.world.agents = [doomed, observer];
    doomed.health = COLD_HEALTH_PER_DAY;
    doomed.tasks = [{ kind: "deposit" }];
    observer.tasks = [{ kind: "deposit" }];
    engine.world.stockpile.wood = 1;
    const winterStart = 3 * DAYS_PER_SEASON * TICKS_PER_DAY;
    engine.world.tick = winterStart - 1;
    const pending = createDeferredPlan();
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> =>
        pending.promise,
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [observer.id],
      providerForAgent: () => "claude",
      planFn,
    });

    engine.step();
    broker.onTick();

    expect(planFn).toHaveBeenCalledOnce();
    const observedWorld = planFn.mock.calls[0]?.[0];
    expect(observedWorld?.tick).toBe(winterStart);
    expect(observedWorld?.stockpile.wood).toBe(0);
    expect(observer.health).toBe(HEALTH_MAX - COLD_HEALTH_PER_DAY);
    expect(observedWorld?.deaths).toEqual([
      { name: doomed.name, tick: winterStart, cause: "cold" },
    ]);

    pending.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await pending.promise;
  });

  it("observes a spring-boundary immigrant in the same step", async () => {
    const engine = createTestEngine();
    const agent = getAgent(engine, 0);
    engine.world.agents = [agent];
    agent.tasks = [{ kind: "deposit" }];
    engine.world.stockpile.food = 1_000;
    engine.world.buildings = [
      {
        kind: "house",
        pos: { x: engine.world.stockpile.pos.x + 2, y: engine.world.stockpile.pos.y },
        progress: HOUSE_BUILD_TICKS,
        complete: true,
      },
    ];
    engine.world.tick = DAYS_PER_SEASON * SEASONS.length * TICKS_PER_DAY - 1;
    const pending = createDeferredPlan();
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> =>
        pending.promise,
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [agent.id],
      providerForAgent: () => "claude",
      planFn,
    });

    engine.step();
    broker.onTick();

    expect(planFn.mock.calls[0]?.[0].agents.map(({ name }) => name)).toEqual([
      "Ash",
      IMMIGRANT_NAMES[0],
    ]);

    pending.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await pending.promise;
  });

  it("uses a 1,200-tick cooldown after a plan resolves by default", async () => {
    const engine = createTestEngine();
    const agent = getAgent(engine, 0);
    engine.world.tick = 10;
    const requests: DeferredPlan[] = [];
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> => {
        const request = createDeferredPlan();
        requests.push(request);
        return request.promise;
      },
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [agent.id],
      providerForAgent: () => "claude",
      planFn,
    });

    broker.onTick();
    const first = requests[0];
    if (first === undefined) throw new Error("first plan was not dispatched");
    first.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await first.promise;
    agent.tasks = [];

    engine.world.tick = 10 + 1_200 - 1;
    broker.onTick();
    expect(planFn).toHaveBeenCalledOnce();

    engine.world.tick = 10 + 1_200;
    broker.onTick();
    expect(planFn).toHaveBeenCalledTimes(2);

    const second = requests[1];
    if (second === undefined) throw new Error("second plan was not dispatched");
    second.resolve({ tasks: [{ kind: "deposit" }], source: "fake" });
    await second.promise;
  });

  it("uses the configured cooldown", async () => {
    const engine = createTestEngine();
    const agent = getAgent(engine, 0);
    engine.world.tick = 10;
    const requests: DeferredPlan[] = [];
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> => {
        const request = createDeferredPlan();
        requests.push(request);
        return request.promise;
      },
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [agent.id],
      providerForAgent: () => "claude",
      planFn,
      cooldownTicks: 4,
    });

    broker.onTick();
    const first = requests[0];
    if (first === undefined) throw new Error("first plan was not dispatched");
    first.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await first.promise;
    agent.tasks = [];

    engine.world.tick = 13;
    broker.onTick();
    expect(planFn).toHaveBeenCalledOnce();

    engine.world.tick = 14;
    broker.onTick();
    expect(planFn).toHaveBeenCalledTimes(2);

    const second = requests[1];
    if (second === undefined) throw new Error("second plan was not dispatched");
    second.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await second.promise;
  });

  it("limits planning to one in-flight request while queueing other agents", async () => {
    const engine = createTestEngine();
    const firstAgent = getAgent(engine, 0);
    const secondAgent = getAgent(engine, 1);
    const requests: DeferredPlan[] = [];
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> => {
        const request = createDeferredPlan();
        requests.push(request);
        return request.promise;
      },
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [firstAgent.id, secondAgent.id],
      providerForAgent: () => "claude",
      planFn,
    });

    broker.onTick();

    expect(planFn).toHaveBeenCalledOnce();
    expect(planFn.mock.calls[0]?.[1]).toBe(firstAgent);
    expect(firstAgent.thinking).toBe(true);
    expect(secondAgent.thinking).toBe(true);
    expect(broker.inFlightCount()).toBe(1);

    const first = requests[0];
    if (first === undefined) throw new Error("first plan was not dispatched");
    first.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await first.promise;

    expect(planFn).toHaveBeenCalledTimes(2);
    expect(planFn.mock.calls[1]?.[1]).toBe(secondAgent);
    expect(broker.inFlightCount()).toBe(1);

    const second = requests[1];
    if (second === undefined) throw new Error("second plan was not dispatched");
    second.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await second.promise;

    expect(broker.inFlightCount()).toBe(0);
  });

  it("blocks the next global call inside the hourly window and allows it after the window slides", async () => {
    const engine = createTestEngine();
    const firstAgent = getAgent(engine, 0);
    const secondAgent = getAgent(engine, 1);
    const thirdAgent = getAgent(engine, 2);
    let managedAgentIds = [firstAgent.id, secondAgent.id, thirdAgent.id];
    const requests: DeferredPlan[] = [];
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> => {
        const request = createDeferredPlan();
        requests.push(request);
        return request.promise;
      },
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: () => managedAgentIds,
      providerForAgent: (agent) => (agent === secondAgent ? "codex" : "claude"),
      planFn,
      maxCallsPerHour: 2,
    });

    broker.onTick();
    const first = requests[0];
    if (first === undefined) throw new Error("first plan was not dispatched");
    first.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await first.promise;

    const second = requests[1];
    if (second === undefined) throw new Error("second plan was not dispatched");
    second.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await second.promise;

    expect(planFn).toHaveBeenCalledTimes(2);
    expect(planFn.mock.calls.map(([, , provider]) => provider)).toEqual(["claude", "codex"]);
    expect(thirdAgent.thinking).toBe(false);
    expect(broker.inFlightCount()).toBe(0);

    managedAgentIds = [thirdAgent.id];
    engine.world.tick = 36_000;
    broker.onTick();

    expect(planFn).toHaveBeenCalledTimes(3);
    const third = requests[2];
    if (third === undefined) throw new Error("third plan was not dispatched");
    third.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await third.promise;
  });

  it("logs budget exhaustion at most once per 1,000 ticks", async () => {
    const engine = createTestEngine();
    const firstAgent = getAgent(engine, 0);
    const secondAgent = getAgent(engine, 1);
    let managedAgentIds = [firstAgent.id, secondAgent.id];
    const first = createDeferredPlan();
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> =>
        first.promise,
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: () => managedAgentIds,
      providerForAgent: () => "claude",
      planFn,
      maxCallsPerHour: 1,
    });

    broker.onTick();
    first.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await first.promise;
    managedAgentIds = [secondAgent.id];

    engine.world.tick = 999;
    broker.onTick();
    engine.world.tick = 1_000;
    broker.onTick();

    expect(log.mock.calls).toEqual([
      [JSON.stringify({ at: "thoughtBroker", outcome: "budget-exhausted", tick: 0 })],
      [JSON.stringify({ at: "thoughtBroker", outcome: "budget-exhausted", tick: 1_000 })],
    ]);
  });

  it("advances the queue and cools down the current agent when planning rejects", async () => {
    const engine = createTestEngine();
    const firstAgent = getAgent(engine, 0);
    const secondAgent = getAgent(engine, 1);
    const secondPlan = createDeferredPlan();
    const planFn = vi.fn(
      (_world: WorldState, agent: AgentState, _provider: LlmProvider): Promise<PlanResult> =>
        agent === firstAgent
          ? Promise.reject(new Error("sensitive prompt and credential details"))
          : secondPlan.promise,
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [firstAgent.id, secondAgent.id],
      providerForAgent: (agent) => (agent === firstAgent ? "claude" : "codex"),
      planFn,
    });

    broker.onTick();
    await vi.waitFor(() => expect(planFn).toHaveBeenCalledTimes(2));

    expect(firstAgent.thinking).toBe(false);
    expect(secondAgent.thinking).toBe(true);
    expect(broker.inFlightCount()).toBe(1);
    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      JSON.stringify({
        at: "thoughtBroker",
        agent: firstAgent.id,
        provider: "claude",
        outcome: "error",
        error: "planning failed",
      }),
    );
    expect(errorLog.mock.calls.flat().join("\n")).not.toContain("sensitive");

    secondPlan.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await secondPlan.promise;
    await vi.waitFor(() => expect(broker.inFlightCount()).toBe(0));

    broker.onTick();
    expect(planFn).toHaveBeenCalledTimes(2);
  });

  it("advances the queue when planning throws synchronously", async () => {
    const engine = createTestEngine();
    const firstAgent = getAgent(engine, 0);
    const secondAgent = getAgent(engine, 1);
    const secondPlan = createDeferredPlan();
    const planFn = vi.fn(
      (_world: WorldState, agent: AgentState, _provider: LlmProvider): Promise<PlanResult> => {
        if (agent === firstAgent) throw new Error("sensitive synchronous details");
        return secondPlan.promise;
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [firstAgent.id, secondAgent.id],
      providerForAgent: () => "claude",
      planFn,
    });

    broker.onTick();

    expect(planFn).toHaveBeenCalledTimes(2);
    expect(firstAgent.thinking).toBe(false);
    expect(secondAgent.thinking).toBe(true);
    expect(broker.inFlightCount()).toBe(1);

    secondPlan.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await secondPlan.promise;
    await vi.waitFor(() => expect(broker.inFlightCount()).toBe(0));
  });

  it("advances the queue when applying a resolved plan throws", async () => {
    const engine = createTestEngine();
    const firstAgent = getAgent(engine, 0);
    const secondAgent = getAgent(engine, 1);
    const secondPlan = createDeferredPlan();
    const planFn = vi.fn(
      (_world: WorldState, agent: AgentState, _provider: LlmProvider): Promise<PlanResult> =>
        agent === firstAgent
          ? Promise.resolve({ tasks: [{ kind: "deposit" }], source: "llm" })
          : secondPlan.promise,
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(engine, "applyPlan").mockImplementationOnce(() => {
      throw new Error("apply failed with sensitive details");
    });
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [firstAgent.id, secondAgent.id],
      providerForAgent: () => "claude",
      planFn,
    });

    broker.onTick();
    await vi.waitFor(() => expect(planFn).toHaveBeenCalledTimes(2));

    expect(firstAgent.thinking).toBe(false);
    expect(secondAgent.thinking).toBe(true);
    expect(broker.inFlightCount()).toBe(1);

    secondPlan.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await secondPlan.promise;
    await vi.waitFor(() => expect(broker.inFlightCount()).toBe(0));
  });

  it("dispatches once when hunger crosses below the eat threshold", async () => {
    const engine = createTestEngine();
    const agent = getAgent(engine, 0);
    agent.tasks = [{ kind: "deposit" }];
    agent.hunger = HUNGER_EAT_THRESHOLD;
    const requests: DeferredPlan[] = [];
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> => {
        const request = createDeferredPlan();
        requests.push(request);
        return request.promise;
      },
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [agent.id],
      providerForAgent: () => "claude",
      planFn,
    });

    broker.onTick();
    expect(planFn).not.toHaveBeenCalled();

    agent.hunger = HUNGER_EAT_THRESHOLD - 1;
    broker.onTick();
    expect(planFn).toHaveBeenCalledOnce();
    const first = requests[0];
    if (first === undefined) throw new Error("hunger plan was not dispatched");
    first.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await first.promise;

    engine.world.tick += THINK_COOLDOWN_TICKS;
    broker.onTick();
    expect(planFn).toHaveBeenCalledOnce();
  });

  it("does not trigger for an agent first observed below the threshold", () => {
    const engine = createTestEngine();
    const missingId = "future-agent";
    const planFn = vi.fn(
      async (
        _world: WorldState,
        _agent: AgentState,
        _provider: LlmProvider,
      ): Promise<PlanResult> => ({ tasks: [], source: "llm" }),
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [missingId],
      providerForAgent: () => "claude",
      planFn,
    });
    const newcomer = { ...getAgent(engine, 0), id: missingId, tasks: [{ kind: "deposit" }] };
    newcomer.hunger = HUNGER_EAT_THRESHOLD - 1;
    engine.world.agents.push(newcomer);

    broker.onTick();

    expect(planFn).not.toHaveBeenCalled();
  });

  it("dynamically queues a new managed resident without breaking single-flight", async () => {
    const engine = createTestEngine();
    const firstAgent = getAgent(engine, 0);
    engine.world.agents = [firstAgent];
    const requests: DeferredPlan[] = [];
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> => {
        const request = createDeferredPlan();
        requests.push(request);
        return request.promise;
      },
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: () => engine.world.agents.map(({ id }) => id),
      providerForAgent: (agent) => (agent.name === "Dahlia" ? "codex" : "claude"),
      planFn,
    });

    broker.onTick();
    expect(planFn).toHaveBeenCalledOnce();

    const newcomer = {
      ...getAgent(createTestEngine(), 0),
      id: "agent-new",
      name: "Dahlia",
      hunger: HUNGER_EAT_THRESHOLD - 1,
      tasks: [{ kind: "deposit" } as const],
    };
    engine.world.agents.push(newcomer);
    broker.onTick();
    expect(newcomer.llmProvider).toBe("codex");
    expect(newcomer.thinking).toBe(false);
    expect(planFn).toHaveBeenCalledOnce();

    newcomer.tasks = [];
    broker.onTick();
    expect(newcomer.thinking).toBe(true);
    expect(planFn).toHaveBeenCalledOnce();

    const first = requests[0];
    if (first === undefined) throw new Error("first plan was not dispatched");
    first.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await first.promise;

    expect(planFn).toHaveBeenCalledTimes(2);
    expect(planFn.mock.calls[1]?.[1]).toBe(newcomer);
    expect(planFn.mock.calls[1]?.[2]).toBe("codex");
    const second = requests[1];
    if (second === undefined) throw new Error("newcomer plan was not dispatched");
    second.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await second.promise;
  });

  it("consumes a crossing suppressed by cooldown without repeatedly triggering", async () => {
    const engine = createTestEngine();
    const agent = getAgent(engine, 0);
    agent.hunger = HUNGER_EAT_THRESHOLD;
    const requests: DeferredPlan[] = [];
    const planFn = vi.fn(
      (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> => {
        const request = createDeferredPlan();
        requests.push(request);
        return request.promise;
      },
    );
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [agent.id],
      providerForAgent: () => "claude",
      planFn,
    });

    broker.onTick();
    const initial = requests[0];
    if (initial === undefined) throw new Error("initial plan was not dispatched");
    initial.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await initial.promise;

    agent.hunger = HUNGER_EAT_THRESHOLD - 1;
    engine.world.tick += 1;
    broker.onTick();
    engine.world.tick += THINK_COOLDOWN_TICKS;
    broker.onTick();

    expect(planFn).toHaveBeenCalledOnce();
  });
});
