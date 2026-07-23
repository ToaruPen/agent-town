import { WS_PORT } from "@agent-town/shared";

import { startServer } from "./net/wsServer.js";

function optionalPositiveInteger(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new Error(`invalid ${name}: ${value}; expected a positive integer`);
  }
  return parsed;
}

const llmPlannerEnabled = process.env.LLM_PLANNER === "1";
const configuredPort = process.env.PORT;
const port = configuredPort === undefined ? WS_PORT : Number(configuredPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`invalid PORT: ${configuredPort}`);
}
const staticDir = process.env.STATIC_DIR;
const llmAgents = process.env.LLM_AGENTS;
const llmRoutes = process.env.LLM_ROUTES;
const llmClaudeModel = process.env.LLM_CLAUDE_MODEL;
const llmCooldownTicks = optionalPositiveInteger(
  "LLM_COOLDOWN_TICKS",
  process.env.LLM_COOLDOWN_TICKS,
);
const llmMaxCallsPerHour = optionalPositiveInteger(
  "LLM_MAX_CALLS_PER_HOUR",
  process.env.LLM_MAX_CALLS_PER_HOUR,
);

startServer({
  port,
  seed: Date.now() % 2 ** 31,
  llmPlannerEnabled,
  ...(staticDir === undefined ? {} : { staticDir }),
  ...(llmAgents === undefined ? {} : { llmAgents }),
  ...(llmRoutes === undefined ? {} : { llmRoutes }),
  ...(llmClaudeModel === undefined ? {} : { llmClaudeModel }),
  ...(llmCooldownTicks === undefined ? {} : { llmCooldownTicks }),
  ...(llmMaxCallsPerHour === undefined ? {} : { llmMaxCallsPerHour }),
});
