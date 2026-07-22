import {
  type AgentState,
  type AgentTask,
  type PlanSource,
  THINK_COOLDOWN_TICKS,
  type WorldState,
} from "@agent-town/shared";

import type { Engine } from "../sim/engine.js";

interface ThoughtBrokerOptions {
  engine: Engine;
  llmAgentIds: string[];
  planFn: (
    world: WorldState,
    agent: AgentState,
  ) => Promise<{ tasks: AgentTask[]; source: PlanSource }>;
}

export class ThoughtBroker {
  private readonly queuedAgentIds: string[] = [];
  private readonly cooldownUntil = new Map<string, number>();
  private requestInFlight = false;

  constructor(private readonly opts: ThoughtBrokerOptions) {}

  private managedAgent(agentId: string): AgentState | undefined {
    return this.opts.engine.world.agents.find(({ id }) => id === agentId);
  }

  private cooldownElapsed(agent: AgentState): boolean {
    const nextPlanTick = this.cooldownUntil.get(agent.id);
    return nextPlanTick === undefined || this.opts.engine.world.tick >= nextPlanTick;
  }

  private shouldQueue(agent: AgentState): boolean {
    const triggered = this.opts.engine.isDayBoundary() || agent.tasks.length === 0;
    return !agent.thinking && this.cooldownElapsed(agent) && triggered;
  }

  private finishRequest(agentId: string, result: { tasks: AgentTask[]; source: PlanSource }): void {
    this.opts.engine.applyPlan(agentId, result.tasks, result.source);
    this.cooldownUntil.set(agentId, this.opts.engine.world.tick + THINK_COOLDOWN_TICKS);
    this.requestInFlight = false;
    this.dispatchNext();
  }

  private dispatchNext(): void {
    if (this.requestInFlight) return;
    const agentId = this.queuedAgentIds.shift();
    if (agentId === undefined) return;
    const agent = this.managedAgent(agentId);
    if (agent === undefined) {
      this.dispatchNext();
      return;
    }

    this.requestInFlight = true;
    void this.opts
      .planFn(this.opts.engine.world, agent)
      .then((result) => this.finishRequest(agentId, result));
  }

  onTick(): void {
    for (const agentId of this.opts.llmAgentIds) {
      const agent = this.managedAgent(agentId);
      if (agent === undefined || !this.shouldQueue(agent)) continue;
      agent.thinking = true;
      this.queuedAgentIds.push(agent.id);
    }
    this.dispatchNext();
  }

  inFlightCount(): number {
    return this.requestInFlight ? 1 : 0;
  }
}
