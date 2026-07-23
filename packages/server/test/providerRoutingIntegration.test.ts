import type { AgentState, LlmProvider } from "@agent-town/shared";
import { describe, expect, it, vi } from "vitest";

import type { LlmRunner } from "../src/llm/llmRunner.js";
import { createThoughtBroker } from "../src/net/wsServer.js";
import { createEngine } from "../src/sim/engine.js";
import { FakePlanner } from "../src/sim/fakePlanner.js";
import { createRng } from "../src/sim/rng.js";
import { generateWorld } from "../src/sim/worldGen.js";

function runner(run: LlmRunner["run"]): LlmRunner {
  return { run };
}

function setup() {
  const rng = createRng(42);
  const fallback = new FakePlanner(rng);
  const engine = createEngine(generateWorld(42), fallback, rng);
  engine.world.agents = engine.world.agents.slice(0, 2);
  for (const agent of engine.world.agents) agent.tasks = [];
  return { engine, fallback };
}

const validPlan = JSON.stringify({ reasoning: "Observe the town.", plan: [{ kind: "rest" }] });

describe("provider routing integration", () => {
  it("routes Ash only to Claude and Birch only to Codex", async () => {
    const { engine, fallback } = setup();
    const claudeRun = vi.fn(async () => ({ ok: true as const, text: validPlan }));
    const codexRun = vi.fn(async () => ({ ok: true as const, text: validPlan }));
    const runners: Readonly<Record<LlmProvider, LlmRunner>> = {
      claude: runner(claudeRun),
      codex: runner(codexRun),
    };
    const broker = createThoughtBroker({
      enabled: true,
      engine,
      fallback,
      llmAgents: "all",
      llmRoutes: "Ash:claude,*:codex",
      runners,
    });

    broker?.onTick();
    await vi.waitFor(() => expect(broker?.inFlightCount()).toBe(0));

    expect(claudeRun).toHaveBeenCalledOnce();
    expect(codexRun).toHaveBeenCalledOnce();
    expect(claudeRun.mock.calls[0]?.[0]).toContain("Ash");
    expect(codexRun.mock.calls[0]?.[0]).toContain("Birch");
    expect(engine.world.agents.map(({ llmProvider }) => llmProvider)).toEqual(["claude", "codex"]);
  });

  it("does not cross providers when Claude falls back", async () => {
    const { engine, fallback } = setup();
    const claudeRun = vi.fn(async () => ({ ok: false as const, error: "rate limited" }));
    const codexRun = vi.fn(async () => ({ ok: true as const, text: validPlan }));
    const broker = createThoughtBroker({
      enabled: true,
      engine,
      fallback,
      llmAgents: "all",
      llmRoutes: "Ash:claude,*:codex",
      runners: { claude: runner(claudeRun), codex: runner(codexRun) },
    });

    broker?.onTick();
    await vi.waitFor(() => expect(broker?.inFlightCount()).toBe(0));

    const ash = engine.world.agents[0] as AgentState;
    const birch = engine.world.agents[1] as AgentState;
    expect(claudeRun).toHaveBeenCalledTimes(2);
    expect(codexRun).toHaveBeenCalledOnce();
    expect({ provider: ash.llmProvider, source: ash.planSource }).toEqual({
      provider: "claude",
      source: "fake",
    });
    expect({ provider: birch.llmProvider, source: birch.planSource }).toEqual({
      provider: "codex",
      source: "llm",
    });
  });

  it("does not parse provider routes when planning is disabled", () => {
    const { engine, fallback } = setup();

    expect(
      createThoughtBroker({
        enabled: false,
        engine,
        fallback,
        llmRoutes: "invalid",
      }),
    ).toBeUndefined();
  });
});
