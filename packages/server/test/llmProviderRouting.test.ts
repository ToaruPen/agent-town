import type { AgentState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { llmProviderForAgent, parseLlmProviderRoutes } from "../src/llm/llmProviderRouting.js";

function agent(id: string, name: string): AgentState {
  return {
    id,
    name,
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

const agents = [agent("agent-0", "Ash"), agent("agent-1", "Birch"), agent("agent-2", "Cedar")];

describe("parseLlmProviderRoutes", () => {
  it("defaults current and future residents to Claude", () => {
    const routes = parseLlmProviderRoutes(undefined, agents, { kind: "all" });

    expect(llmProviderForAgent(routes, agents[0])).toBe("claude");
    expect(llmProviderForAgent(routes, agent("agent-3", "Dahlia"))).toBe("claude");
  });

  it("trims routes and uses the wildcard for other and future residents", () => {
    const routes = parseLlmProviderRoutes(" Ash : claude , * : codex ", agents, { kind: "all" });

    expect(llmProviderForAgent(routes, agents[0])).toBe("claude");
    expect(llmProviderForAgent(routes, agents[1])).toBe("codex");
    expect(llmProviderForAgent(routes, agent("agent-3", "Dahlia"))).toBe("codex");
  });

  it("allows a fixed selection to use exact routes without a wildcard", () => {
    const routes = parseLlmProviderRoutes("Ash:claude,Birch:codex", agents, {
      kind: "selected",
      agentIds: ["agent-0", "agent-1"],
    });

    expect(llmProviderForAgent(routes, agents[0])).toBe("claude");
    expect(llmProviderForAgent(routes, agents[1])).toBe("codex");
  });

  it.each([
    "",
    "Ash",
    ":claude",
    "Ash:",
    "Ash:openai",
    "Ash:claude:codex",
    "Ash:claude,",
    ",Ash:claude",
    "Ash:claude,,*:codex",
    "Ash:claude,Ash:codex",
    "*:claude,*:codex",
    "Unknown:claude",
  ])("rejects invalid route setting %j", (setting) => {
    expect(() => parseLlmProviderRoutes(setting, agents, { kind: "all" })).toThrow(/LLM_ROUTES/);
  });

  it("requires a wildcard for all residents", () => {
    expect(() =>
      parseLlmProviderRoutes("Ash:claude,Birch:codex,Cedar:claude", agents, { kind: "all" }),
    ).toThrow(/LLM_ROUTES/);
  });

  it("requires routes for every fixed selected resident", () => {
    expect(() =>
      parseLlmProviderRoutes("Ash:claude", agents, {
        kind: "selected",
        agentIds: ["agent-0", "agent-1"],
      }),
    ).toThrow(/LLM_ROUTES/);
  });

  it("allows exact routes for known unmanaged residents", () => {
    const routes = parseLlmProviderRoutes("Ash:claude,Cedar:codex", agents, {
      kind: "selected",
      agentIds: ["agent-0"],
    });

    expect(llmProviderForAgent(routes, agents[2])).toBe("codex");
  });
});
