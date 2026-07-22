import {
  type AgentState,
  type AgentTask,
  COLD_HEALTH_PER_DAY,
  DAYS_PER_SEASON,
  HEALTH_MAX,
  type PlanSource,
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
      (_world: WorldState, _agent: AgentState): Promise<PlanResult> => pending.promise,
    );
    const broker = new ThoughtBroker({ engine, llmAgentIds: [agent.id], planFn });
    const tasks: AgentTask[] = [{ kind: "deposit" }];

    broker.onTick();

    expect(planFn).toHaveBeenCalledOnce();
    expect(planFn).toHaveBeenCalledWith(engine.world, agent);
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
      (_world: WorldState, _agent: AgentState): Promise<PlanResult> => pending.promise,
    );
    const broker = new ThoughtBroker({ engine, llmAgentIds: [agent.id], planFn });

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
      (_world: WorldState, _agent: AgentState): Promise<PlanResult> => pending.promise,
    );
    const broker = new ThoughtBroker({ engine, llmAgentIds: [observer.id], planFn });

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

  it("respects the per-agent cooldown after a plan resolves", async () => {
    const engine = createTestEngine();
    const agent = getAgent(engine, 0);
    engine.world.tick = 10;
    const requests: DeferredPlan[] = [];
    const planFn = vi.fn((_world: WorldState, _agent: AgentState): Promise<PlanResult> => {
      const request = createDeferredPlan();
      requests.push(request);
      return request.promise;
    });
    const broker = new ThoughtBroker({ engine, llmAgentIds: [agent.id], planFn });

    broker.onTick();
    const first = requests[0];
    if (first === undefined) throw new Error("first plan was not dispatched");
    first.resolve({ tasks: [{ kind: "deposit" }], source: "llm" });
    await first.promise;
    agent.tasks = [];

    engine.world.tick = 10 + THINK_COOLDOWN_TICKS - 1;
    broker.onTick();
    expect(planFn).toHaveBeenCalledOnce();

    engine.world.tick = 10 + THINK_COOLDOWN_TICKS;
    broker.onTick();
    expect(planFn).toHaveBeenCalledTimes(2);

    const second = requests[1];
    if (second === undefined) throw new Error("second plan was not dispatched");
    second.resolve({ tasks: [{ kind: "deposit" }], source: "fake" });
    await second.promise;
  });

  it("limits planning to one in-flight request while queueing other agents", async () => {
    const engine = createTestEngine();
    const firstAgent = getAgent(engine, 0);
    const secondAgent = getAgent(engine, 1);
    const requests: DeferredPlan[] = [];
    const planFn = vi.fn((_world: WorldState, _agent: AgentState): Promise<PlanResult> => {
      const request = createDeferredPlan();
      requests.push(request);
      return request.promise;
    });
    const broker = new ThoughtBroker({
      engine,
      llmAgentIds: [firstAgent.id, secondAgent.id],
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
});
