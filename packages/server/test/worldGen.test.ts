import {
  AGENT_COUNT,
  FATIGUE_MAX,
  FOOD_RESOURCE_MAX,
  FOOD_RESOURCE_MIN,
  HEALTH_MAX,
  HUNGER_MAX,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Position,
  WOOD_RESOURCE_MAX,
  WOOD_RESOURCE_MIN,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { createRng } from "../src/sim/rng.js";
import { generateWorld } from "../src/sim/worldGen.js";

function tileAt(tiles: ReturnType<typeof generateWorld>["tiles"], pos: Position) {
  return tiles[pos.y * MAP_WIDTH + pos.x];
}

describe("generateWorld", () => {
  it("produces deeply equal worlds for the same seed", () => {
    expect(generateWorld(42)).toEqual(generateWorld(42));
  });

  it("produces different tile layouts for different seeds", () => {
    expect(generateWorld(42).tiles).not.toEqual(generateWorld(43).tiles);
  });

  it("places the stockpile on a walkable plains tile", () => {
    const world = generateWorld(42);

    expect(tileAt(world.tiles, world.stockpile.pos)?.terrain).toBe("plains");
  });

  it("spawns every agent on a distinct walkable tile", () => {
    const world = generateWorld(42);
    const spawnKeys = new Set(world.agents.map(({ pos }) => `${pos.x},${pos.y}`));

    expect(world.agents).toHaveLength(AGENT_COUNT);
    expect(spawnKeys.size).toBe(AGENT_COUNT);
    for (const agent of world.agents) {
      expect(["plains", "forest"]).toContain(tileAt(world.tiles, agent.pos)?.terrain);
    }
  });

  it("creates a complete row-major tile array", () => {
    expect(generateWorld(42).tiles).toHaveLength(MAP_WIDTH * MAP_HEIGHT);
  });

  it("places wood resources on forest tiles", () => {
    const forestTiles = generateWorld(42).tiles.filter(({ terrain }) => terrain === "forest");

    expect(forestTiles.length).toBeGreaterThan(0);
    for (const tile of forestTiles) {
      expect(tile.resource?.kind).toBe("wood");
      expect(tile.resourceOrigin).toBe("wood");
    }
  });

  it("records an immutable origin only for generated resource tiles", () => {
    const world = generateWorld(42);

    for (const tile of world.tiles) {
      expect(tile.resourceOrigin ?? null).toBe(tile.resource?.kind ?? null);
    }
  });

  it("does not share position references between generated worlds", () => {
    const first = generateWorld(42);
    const second = generateWorld(42);

    expect(first.stockpile.pos).not.toBe(second.stockpile.pos);
    for (let index = 0; index < AGENT_COUNT; index += 1) {
      expect(first.agents[index]?.pos).not.toBe(second.agents[index]?.pos);
    }
  });

  it("guarantees at least one water and one rock patch", () => {
    const terrains = new Set(generateWorld(2809).tiles.map(({ terrain }) => terrain));

    expect(terrains).toContain("water");
    expect(terrains).toContain("rock");
  });

  it("keeps wood and food amounts within their configured ranges", () => {
    const resources = generateWorld(42).tiles.flatMap(({ resource }) =>
      resource === null ? [] : [resource],
    );
    const woodAmounts = resources.filter(({ kind }) => kind === "wood").map(({ amount }) => amount);
    const foodAmounts = resources.filter(({ kind }) => kind === "food").map(({ amount }) => amount);

    expect(woodAmounts.length).toBeGreaterThan(0);
    expect(foodAmounts.length).toBeGreaterThan(0);
    for (const amount of woodAmounts) {
      expect(amount).toBeGreaterThanOrEqual(WOOD_RESOURCE_MIN);
      expect(amount).toBeLessThanOrEqual(WOOD_RESOURCE_MAX);
    }
    for (const amount of foodAmounts) {
      expect(amount).toBeGreaterThanOrEqual(FOOD_RESOURCE_MIN);
      expect(amount).toBeLessThanOrEqual(FOOD_RESOURCE_MAX);
    }
  });

  it("initializes tick zero with idle agents and empty task queues", () => {
    const world = generateWorld(42);

    expect(world.tick).toBe(0);
    for (const agent of world.agents) {
      expect(agent.activity).toEqual({ kind: "idle" });
      expect(agent.tasks).toEqual([]);
    }
  });

  it("initializes agents with fake planning state and no last thought", () => {
    const world = generateWorld(42);

    for (const agent of world.agents) {
      expect(agent.planSource).toBe("fake");
      expect(agent.thinking).toBe(false);
      expect(agent.lastThought).toBeNull();
    }
  });

  it("initializes every agent with full survival gauges", () => {
    const world = generateWorld(42);

    for (const agent of world.agents) {
      expect(agent.hunger).toBe(HUNGER_MAX);
      expect(agent.fatigue).toBe(FATIGUE_MAX);
      expect(agent.health).toBe(HEALTH_MAX);
    }
  });

  it("starts with an empty death history", () => {
    expect(generateWorld(42).deaths).toEqual([]);
  });

  it("starts without buildings", () => {
    expect(generateWorld(42).buildings).toEqual([]);
  });
});

describe("createRng", () => {
  it("produces the same sequence for the same seed", () => {
    const first = createRng(42);
    const second = createRng(42);

    expect(Array.from({ length: 10 }, first)).toEqual(Array.from({ length: 10 }, second));
  });
});
