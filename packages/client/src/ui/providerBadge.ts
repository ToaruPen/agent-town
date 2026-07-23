import type { AgentState } from "@agent-town/shared";

export interface ProviderBadge {
  label: string;
  tone: "fake" | "llm";
}

type ProviderState = Pick<AgentState, "planSource" | "llmProvider">;

export function buildProviderBadge(agent: ProviderState): ProviderBadge {
  if (agent.llmProvider === null) return { label: "FAKE", tone: "fake" };
  const provider = agent.llmProvider.toUpperCase();
  return agent.planSource === "llm"
    ? { label: provider, tone: "llm" }
    : { label: `${provider} → FAKE`, tone: "fake" };
}
