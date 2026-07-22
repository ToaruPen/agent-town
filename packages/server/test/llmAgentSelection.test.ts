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
    hunger: 100,
    fatigue: 100,
    health: 100,
  };
}

const agents = [agent("agent-0", "Ash"), agent("agent-1", "Birch"), agent("agent-2", "Cedar")];

describe("parseLlmAgentSelection", () => {
  it("keeps undefined and all settings dynamic as residents immigrate", () => {
    const defaultSelection = parseLlmAgentSelection(undefined, agents);
    const allSelection = parseLlmAgentSelection("all", agents);
    const residents = [...agents, agent("agent-3", "Dahlia")];

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
    const selection = parseLlmAgentSelection(" Cedar, Ash ", agents);
    const residents = [...agents, agent("agent-3", "Dahlia")];

    expect(llmAgentIdsForWorld(selection, residents)).toEqual(["agent-2", "agent-0"]);
  });

  it.each(["", "Ash,", ",Ash", "Ash,,Birch", "all,Ash", "Ash,Ash", "Unknown"])(
    "rejects malformed or unknown setting %j",
    (setting) => {
      expect(() => parseLlmAgentSelection(setting, agents)).toThrow(/LLM_AGENTS/);
    },
  );
});
