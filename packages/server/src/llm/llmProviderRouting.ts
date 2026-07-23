import type { AgentState, LlmProvider } from "@agent-town/shared";

import type { LlmAgentSelection } from "./llmAgentSelection.js";

const DEFAULT_ROUTES = "*:codex";

export interface LlmProviderRoutes {
  readonly exact: ReadonlyMap<string, LlmProvider>;
  readonly wildcard: LlmProvider | null;
}

function routeError(detail: string): Error {
  return new Error(`invalid LLM_ROUTES: ${detail}`);
}

function parseProvider(value: string): LlmProvider {
  if (value === "claude" || value === "codex") return value;
  throw routeError(`unknown provider '${value}'`);
}

function selectedResidents(selection: LlmAgentSelection, agents: AgentState[]): AgentState[] {
  if (selection.kind === "all") return agents;

  return selection.agentIds.map((agentId) => {
    const resident = agents.find((agent) => agent.id === agentId);
    if (resident === undefined)
      throw routeError(`selected resident ID '${agentId}' is not in the startup world`);
    return resident;
  });
}

function parseRouteEntry(
  rawEntry: string,
  knownNames: ReadonlySet<string>,
  exact: Map<string, LlmProvider>,
  wildcard: LlmProvider | null,
): LlmProvider | null {
  const entry = rawEntry.trim();
  const parts = entry.split(":");
  if (parts.length !== 2) throw routeError(`expected '<selector>:<provider>' in '${entry}'`);

  const selector = (parts[0] ?? "").trim();
  const providerValue = (parts[1] ?? "").trim();
  if (selector === "" || providerValue === "")
    throw routeError("selector and provider must not be empty");
  const provider = parseProvider(providerValue);

  if (selector === "*") {
    if (wildcard !== null) throw routeError("wildcard selector must not be repeated");
    return provider;
  }

  if (!knownNames.has(selector)) throw routeError(`unknown resident name '${selector}'`);
  if (exact.has(selector)) throw routeError(`resident selector '${selector}' must not be repeated`);
  exact.set(selector, provider);
  return wildcard;
}

export function llmProviderForAgent(routes: LlmProviderRoutes, agent: AgentState): LlmProvider {
  const provider = routes.exact.get(agent.name) ?? routes.wildcard;
  if (provider === null || provider === undefined)
    throw routeError(`missing route for resident '${agent.name}'`);
  return provider;
}

export function parseLlmProviderRoutes(
  setting: string | undefined,
  agents: AgentState[],
  selection: LlmAgentSelection,
): LlmProviderRoutes {
  const routeSetting = setting ?? DEFAULT_ROUTES;
  if (routeSetting.trim() === "") throw routeError("setting must not be empty");

  const knownNames = new Set(agents.map((agent) => agent.name));
  const exact = new Map<string, LlmProvider>();
  let wildcard: LlmProvider | null = null;

  for (const rawEntry of routeSetting.split(",")) {
    wildcard = parseRouteEntry(rawEntry, knownNames, exact, wildcard);
  }

  if (selection.kind === "all" && wildcard === null) {
    throw routeError("a wildcard route is required when LLM_AGENTS is all");
  }

  const routes: LlmProviderRoutes = { exact, wildcard };
  for (const resident of selectedResidents(selection, agents))
    llmProviderForAgent(routes, resident);
  return routes;
}
