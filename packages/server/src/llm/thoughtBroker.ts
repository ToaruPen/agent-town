import {
  type AgentState,
  type AgentTask,
  HUNGER_EAT_THRESHOLD,
  type PlanSource,
  THINK_COOLDOWN_TICKS,
  type WorldState,
} from "@agent-town/shared";

import type { Engine } from "../sim/engine.js";

interface ThoughtBrokerOptions {
  engine: Engine;
  llmAgentIds: string[] | (() => string[]);
  planFn: (
    world: WorldState,
    agent: AgentState,
  ) => Promise<{ tasks: AgentTask[]; source: PlanSource; reasoning?: string }>;
}

export class ThoughtBroker {
  private readonly queuedAgentIds: string[] = [];
  private readonly cooldownUntil = new Map<string, number>();
  private readonly observedHunger = new Map<string, number>();
  private requestInFlight = false;

  constructor(private readonly opts: ThoughtBrokerOptions) {
    for (const agentId of this.currentLlmAgentIds()) {
      const agent = this.managedAgent(agentId);
      if (agent !== undefined) this.observedHunger.set(agentId, agent.hunger);
    }
  }

  private currentLlmAgentIds(): string[] {
    return typeof this.opts.llmAgentIds === "function"
      ? this.opts.llmAgentIds()
      : this.opts.llmAgentIds;
  }

  private managedAgent(agentId: string): AgentState | undefined {
    return this.opts.engine.world.agents.find(({ id }) => id === agentId);
  }

  private cooldownElapsed(agent: AgentState): boolean {
    const nextPlanTick = this.cooldownUntil.get(agent.id);
    return nextPlanTick === undefined || this.opts.engine.world.tick >= nextPlanTick;
  }

  private shouldQueue(agent: AgentState, hungerCrossed: boolean): boolean {
    const triggered = this.opts.engine.isDayBoundary() || agent.tasks.length === 0 || hungerCrossed;
    return !agent.thinking && this.cooldownElapsed(agent) && triggered;
  }

  private observeHungerCrossing(agent: AgentState): boolean {
    const previous = this.observedHunger.get(agent.id);
    this.observedHunger.set(agent.id, agent.hunger);
    return (
      previous !== undefined &&
      previous >= HUNGER_EAT_THRESHOLD &&
      agent.hunger < HUNGER_EAT_THRESHOLD
    );
  }

  private finishRequest(
    agentId: string,
    result: { tasks: AgentTask[]; source: PlanSource; reasoning?: string },
  ): void {
    this.opts.engine.applyPlan(agentId, result.tasks, result.source, result.reasoning);
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
    for (const agentId of this.currentLlmAgentIds()) {
      const agent = this.managedAgent(agentId);
      if (agent === undefined) {
        this.observedHunger.delete(agentId);
        continue;
      }
      const hungerCrossed = this.observeHungerCrossing(agent);
      if (!this.shouldQueue(agent, hungerCrossed)) continue;
      agent.thinking = true;
      this.queuedAgentIds.push(agent.id);
    }
    this.dispatchNext();
  }

  inFlightCount(): number {
    return this.requestInFlight ? 1 : 0;
  }
}
