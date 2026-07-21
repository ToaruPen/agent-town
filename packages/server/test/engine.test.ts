import type { WorldState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { createEngine } from "../src/sim/engine.js";
import { FakePlanner } from "../src/sim/fakePlanner.js";
import { createRng } from "../src/sim/rng.js";
import { generateWorld } from "../src/sim/worldGen.js";

const ACCEPTANCE_STEPS = 3000;

function expectAgentsOnWalkableTiles(world: WorldState): void {
  for (const agent of world.agents) {
    const tile = world.tiles[agent.pos.y * world.width + agent.pos.x];
    expect(tile?.terrain).toBeOneOf(["plains", "forest"]);
  }
}

function runAcceptance(seed: number): WorldState {
  const rng = createRng(seed);
  const engine = createEngine(generateWorld(seed), new FakePlanner(rng), rng);

  for (let step = 0; step < ACCEPTANCE_STEPS; step += 1) {
    engine.step();
    expectAgentsOnWalkableTiles(engine.world);
  }

  return engine.world;
}

describe("createEngine", () => {
  it("gathers wood and food safely and deterministically over 3000 steps", () => {
    const first = runAcceptance(42);
    const second = runAcceptance(42);

    expect(first.tick).toBe(ACCEPTANCE_STEPS);
    expect(first.stockpile.wood).toBeGreaterThan(0);
    expect(first.stockpile.food).toBeGreaterThan(0);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
