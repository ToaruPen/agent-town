import type { AgentState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { llmAgentIdsForWorld, parseLlmAgentSelection } from "../src/llm/llmAgentSelection.js";

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
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
  };
}

const agents = [
  agent("agent-0", "トネリコ"),
  agent("agent-1", "シラカバ"),
  agent("agent-2", "スギ"),
];

describe("parseLlmAgentSelection", () => {
  it("keeps undefined and all settings dynamic as residents immigrate", () => {
    const defaultSelection = parseLlmAgentSelection(undefined, agents);
    const allSelection = parseLlmAgentSelection("all", agents);
    const residents = [...agents, agent("agent-3", "ダリア")];

    expect(llmAgentIdsForWorld(defaultSelection, residents)).toEqual([
      "agent-0",
      "agent-1",
      "agent-2",
      "agent-3",
    ]);
    expect(llmAgentIdsForWorld(allSelection, residents)).toEqual([
      "agent-0",
      "agent-1",
      "agent-2",
      "agent-3",
    ]);
  });

  it("keeps comma-separated names fixed to their startup IDs", () => {
    const selection = parseLlmAgentSelection(" スギ, トネリコ ", agents);
    const residents = [...agents, agent("agent-3", "ダリア")];

    expect(llmAgentIdsForWorld(selection, residents)).toEqual(["agent-2", "agent-0"]);
  });

  it.each([
    "",
    "トネリコ,",
    ",トネリコ",
    "トネリコ,,シラカバ",
    "all,トネリコ",
    "トネリコ,トネリコ",
    "Unknown",
  ])("rejects malformed or unknown setting %j", (setting) => {
    expect(() => parseLlmAgentSelection(setting, agents)).toThrow(/LLM_AGENTS/);
  });
});
