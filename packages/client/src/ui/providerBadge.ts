import type { AgentState, LlmProvider } from "@agent-town/shared";

export interface ProviderBadge {
  label: string;
  tone: "fake" | "llm";
}

type ProviderState = Pick<AgentState, "planSource" | "llmProvider">;

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  claude: "クロード",
  codex: "コーデックス",
};

export function buildProviderBadge(agent: ProviderState): ProviderBadge {
  if (agent.llmProvider === null) return { label: "自律", tone: "fake" };
  const provider = PROVIDER_LABELS[agent.llmProvider];
  return agent.planSource === "llm"
    ? { label: provider, tone: "llm" }
    : { label: `${provider} → 自律`, tone: "fake" };
}
