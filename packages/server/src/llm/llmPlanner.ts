import type { AgentState, AgentTask, PlanSource, WorldState } from "@agent-town/shared";

import type { Planner } from "../sim/fakePlanner.js";
import type { ClaudeRunner } from "./claudeRunner.js";
import { buildPlanPrompt } from "./planPrompt.js";
import { parsePlanResponse, validatePlanExecutability } from "./planSchema.js";

const PLAN_ATTEMPTS = 2;

interface AsyncPlanResult {
  tasks: AgentTask[];
  source: PlanSource;
  reasoning?: string;
}

function logAttempt(agent: AgentState, outcome: "llm" | "error", error?: string): void {
  const line =
    error === undefined
      ? { at: "llmPlanner", agent: agent.id, outcome }
      : { at: "llmPlanner", agent: agent.id, outcome, error };
  console.log(JSON.stringify(line));
}

export class LlmPlanner {
  constructor(
    private readonly runner: ClaudeRunner,
    private readonly fallback: Planner,
    _rng: () => number,
  ) {}

  async planAsync(world: WorldState, agent: AgentState): Promise<AsyncPlanResult> {
    for (let attempt = 0; attempt < PLAN_ATTEMPTS; attempt += 1) {
      const runnerResult = await this.runner.run(buildPlanPrompt(world, agent));
      if (!runnerResult.ok) {
        logAttempt(agent, "error", runnerResult.error);
        continue;
      }

      const parsed = parsePlanResponse(runnerResult.text);
      if (!parsed.ok) {
        logAttempt(agent, "error", parsed.error);
        continue;
      }

      const executable = validatePlanExecutability(world, agent, parsed.tasks);
      if (!executable.ok) {
        logAttempt(agent, "error", executable.error);
        continue;
      }

      logAttempt(agent, "llm");
      return { tasks: parsed.tasks, source: "llm", reasoning: parsed.reasoning };
    }

    return { tasks: this.fallback.plan(world, agent), source: "fake" };
  }
}
