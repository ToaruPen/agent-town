import { type CropStage, type Field, isField, type WorldState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { createEngine } from "../src/sim/engine.js";
import { FakePlanner } from "../src/sim/fakePlanner.js";
import { advanceCrops } from "../src/sim/farming.js";
import { createRng } from "../src/sim/rng.js";
import { generateWorld } from "../src/sim/worldGen.js";

function worldWithField(stage: CropStage): WorldState {
  const world = generateWorld(42);
  world.buildings = [
    {
      kind: "field",
      pos: { x: 1, y: 1 },
      progress: 30,
      complete: true,
      stage,
    },
  ];
  return world;
}

function fieldOf(world: WorldState): Field {
  const field = world.buildings.find(isField);
  if (field === undefined) throw new Error("missing test field");
  return field;
}

function runWorld(seed: number, ticks: number): WorldState {
  const rng = createRng(seed);
  const world = generateWorld(seed);
  const engine = createEngine(world, new FakePlanner(rng), rng);

  for (let tick = 0; tick < ticks; tick += 1) engine.step();
  return world;
}

describe("crop seasons", () => {
  it("carries a sown field through to ripe across the year", () => {
    const world = worldWithField("sown");

    advanceCrops(world, "summer");
    expect(fieldOf(world).stage).toBe("growing");

    advanceCrops(world, "autumn");
    expect(fieldOf(world).stage).toBe("ripe");
  });

  it("kills an unharvested crop at the turn of winter", () => {
    for (const stage of ["sown", "growing", "ripe"] as const) {
      const world = worldWithField(stage);

      advanceCrops(world, "winter");

      expect(fieldOf(world).stage).toBe("fallow");
    }
  });

  it("never sows a fallow field on its own", () => {
    for (const season of ["spring", "summer", "autumn", "winter"] as const) {
      const world = worldWithField("fallow");

      advanceCrops(world, season);

      expect(fieldOf(world).stage).toBe("fallow");
    }
  });

  it("leaves an incomplete field alone", () => {
    const world = worldWithField("sown");
    fieldOf(world).complete = false;

    advanceCrops(world, "summer");

    expect(fieldOf(world).stage).toBe("sown");
  });

  it("gives two runs of the same seed identical fields", () => {
    const first = runWorld(7, 12_000);
    const second = runWorld(7, 12_000);

    expect(first.buildings.filter(isField)).toEqual(second.buildings.filter(isField));
  }, 30_000);
});
