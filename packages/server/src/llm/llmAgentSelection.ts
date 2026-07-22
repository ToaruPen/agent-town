import type { AgentState } from "@agent-town/shared";

export type LlmAgentSelection = { kind: "all" } | { kind: "selected"; agentIds: string[] };

function selectionError(detail: string): Error {
  return new Error(`invalid LLM_AGENTS: ${detail}`);
}

export function parseLlmAgentSelection(
  setting: string | undefined,
  agents: AgentState[],
): LlmAgentSelection {
  if (setting === undefined || setting.trim() === "all") {
    return { kind: "all" };
  }

  const rawNames = setting.split(",");
  const names = rawNames.map((name) => name.trim());
  if (names.some((name) => name.length === 0)) {
    throw selectionError("expected 'all' or a comma-separated list of agent names");
  }
  if (names.includes("all")) {
    throw selectionError("'all' cannot be combined with agent names");
  }
  if (new Set(names).size !== names.length) {
    throw selectionError("agent names must not be repeated");
  }

  const agentIds = names.map((name) => {
    const agent = agents.find((candidate) => candidate.name === name);
    if (agent === undefined) throw selectionError(`unknown agent name '${name}'`);
    return agent.id;
  });
  return { kind: "selected", agentIds };
}

export function llmAgentIdsForWorld(selection: LlmAgentSelection, agents: AgentState[]): string[] {
  return selection.kind === "all" ? agents.map(({ id }) => id) : selection.agentIds;
}
