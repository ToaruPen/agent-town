import {
  DAYS_PER_SEASON,
  HOUSE_WOOD_COST,
  isHouse,
  SEASONS,
  TICKS_PER_DAY,
  WOOD_BURN_PER_AGENT_PER_DAY,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { createEngine } from "../src/sim/engine.js";
import { FakePlanner } from "../src/sim/fakePlanner.js";
import { createRng } from "../src/sim/rng.js";
import { generateWorld } from "../src/sim/worldGen.js";

const TICKS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length * TICKS_PER_DAY;

describe("settlement growth", () => {
  it.each([7, 42])(
    "builds a house and grows beyond its founding population for seed %i",
    (seed) => {
      const rng = createRng(seed);
      const world = generateWorld(seed);
      const foundingPopulation = world.agents.length;
      const buildThreshold =
        HOUSE_WOOD_COST + foundingPopulation * WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;
      const engine = createEngine(world, new FakePlanner(rng), rng);
      let maximumWood = world.stockpile.wood;

      for (let step = 0; step < TICKS_PER_YEAR; step += 1) {
        engine.step();
        maximumWood = Math.max(maximumWood, world.stockpile.wood);
      }

      const completedHouses = world.buildings.filter(isHouse).filter(({ complete }) => complete);
      const diagnostic = `maximum wood ${maximumWood}, build threshold ${buildThreshold}`;
      expect(completedHouses.length, diagnostic).toBeGreaterThan(0);
      expect(world.agents.length, diagnostic).toBeGreaterThan(foundingPopulation);
    },
    90_000,
  );
});
