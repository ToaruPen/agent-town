import type {
  AgentState,
  AgentTask,
  LlmProvider,
  PlanSource,
  WorldState,
} from "@agent-town/shared";

import type { Planner } from "../sim/fakePlanner.js";
import type { LlmRunner } from "./llmRunner.js";
import { normalizePlan } from "./normalizePlan.js";
import { buildPlanPrompt } from "./planPrompt.js";
import { parsePlanResponse, validateNormalizedPlanExecutability } from "./planSchema.js";

const PLAN_ATTEMPTS = 2;

interface AsyncPlanResult {
  tasks: AgentTask[];
  source: PlanSource;
  reasoning?: string;
}

type PlannerOutcome = "llm" | "error" | "fake";

function logAttempt(
  agent: AgentState,
  provider: LlmProvider,
  outcome: PlannerOutcome,
  attempt?: number,
  error?: string,
): void {
  const line = {
    at: "llmPlanner",
    agent: agent.id,
    provider,
    ...(attempt === undefined ? {} : { attempt }),
    outcome,
    ...(error === undefined ? {} : { error }),
  };
  console.log(JSON.stringify(line));
}

export class LlmPlanner {
  constructor(
    private readonly provider: LlmProvider,
    private readonly runner: LlmRunner,
    private readonly fallback: Planner,
  ) {}

  async planAsync(world: WorldState, agent: AgentState): Promise<AsyncPlanResult> {
    for (let attempt = 1; attempt <= PLAN_ATTEMPTS; attempt += 1) {
      const runnerResult = await this.runner.run(buildPlanPrompt(world, agent));
      if (!runnerResult.ok) {
        logAttempt(agent, this.provider, "error", attempt, runnerResult.error);
        continue;
      }

      const parsed = parsePlanResponse(runnerResult.text);
      if (!parsed.ok) {
        logAttempt(agent, this.provider, "error", attempt, parsed.error);
        continue;
      }

      const normalized = normalizePlan(world, agent, parsed.tasks);
      if (!normalized.ok) {
        logAttempt(agent, this.provider, "error", attempt, normalized.error);
        continue;
      }
      const executable = validateNormalizedPlanExecutability(world, agent, normalized.tasks);
      if (!executable.ok) {
        logAttempt(agent, this.provider, "error", attempt, executable.error);
        continue;
      }

      logAttempt(agent, this.provider, "llm", attempt);
      return { tasks: normalized.tasks, source: "llm", reasoning: parsed.reasoning };
    }

    logAttempt(agent, this.provider, "fake");
    return { tasks: this.fallback.plan(world, agent), source: "fake" };
  }
}
