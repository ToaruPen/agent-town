import type { AgentState } from "@agent-town/shared";

export function makeAgentFixture(overrides: Partial<AgentState> = {}): AgentState {
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
    rationStrain: 0,
    lastRationTick: null,
    ...overrides,
  };
}
