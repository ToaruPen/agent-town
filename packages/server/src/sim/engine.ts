import type { WorldState } from "@agent-town/shared";

import { stepAgent } from "./executor.js";
import type { Planner } from "./fakePlanner.js";

export function createEngine(world: WorldState, planner: Planner, rng: () => number) {
  void rng;

  return {
    world,
    step(): void {
      for (const agent of world.agents) {
        if (agent.tasks.length === 0) agent.tasks.push(...planner.plan(world, agent));
        stepAgent(world, agent);
      }
      world.tick += 1;
    },
  };
}
