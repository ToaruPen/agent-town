import type { AgentState, Tile } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  agentDepth,
  agentFacingScale,
  agentSpritePath,
  agentTileOffset,
  layoutAgentsOnTiles,
  objectDepth,
  resourceSpritePath,
  SPRITE_ASSETS,
  terrainSpritePath,
  terrainTint,
  undergrowthSpritePath,
} from "../src/render/sprites.js";

describe("agentTileOffset", () => {
  it("keeps one agent centered and separates same-tile occupants deterministically", () => {
    expect(agentTileOffset(0, 1)).toEqual({ x: 0, y: 0 });
    expect([agentTileOffset(0, 2), agentTileOffset(1, 2)]).toEqual([
      { x: -4, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(Array.from({ length: 4 }, (_, index) => agentTileOffset(index, 4))).toEqual([
      { x: -4, y: -4 },
      { x: 4, y: -4 },
      { x: -4, y: 4 },
      { x: 4, y: 4 },
    ]);
  });
});

describe("objectDepth", () => {
  it("places agents over same-tile features and every lower row over the row above", () => {
    expect(objectDepth(4, "resource")).toBeLessThan(objectDepth(4, "agent"));
    expect(objectDepth(4, "agent")).toBeLessThan(objectDepth(5, "resource"));
  });

  it("stacks an institution above the houses around it and below an old-world landmark", () => {
    expect(objectDepth(4, "house")).toBeLessThan(objectDepth(4, "facility"));
    expect(objectDepth(4, "facility")).toBeLessThan(objectDepth(4, "landmark"));
    expect(objectDepth(4, "agent")).toBeLessThan(objectDepth(5, "resource"));
  });

  it("places old-world landmarks above resources but below residents", () => {
    const landmarkDepth = objectDepth(4, "landmark" as Parameters<typeof objectDepth>[1]);

    expect(objectDepth(4, "resource")).toBeLessThan(landmarkDepth);
    expect(landmarkDepth).toBeLessThan(objectDepth(4, "agent"));
  });
});

describe("agentDepth", () => {
  it("sorts five same-tile agents by their jittered visual y position", () => {
    const agents = Array.from({ length: 5 }, (_, index) => ({
      ...movingAgent(5),
      id: `agent-${index}`,
    }));
    const placements = layoutAgentsOnTiles(agents);
    const upper = placements.find(({ offset }) => offset.y === -4);
    const lower = placements.find(({ offset }) => offset.y === 4);

    expect(upper).toBeDefined();
    expect(lower).toBeDefined();
    expect(agentDepth(2, upper?.offset.y ?? 0)).toBeLessThan(agentDepth(2, lower?.offset.y ?? 0));
    expect(agentDepth(2, lower?.offset.y ?? 0)).toBeLessThan(objectDepth(3, "resource"));
  });
});

function movingAgent(nextX: number): AgentState {
  return {
    id: "agent-1",
    name: "Ada",
    pos: { x: 4, y: 2 },
    carrying: null,
    activity: {
      kind: "moving",
      path: [{ x: nextX, y: 2 }],
      ticksIntoStep: 0,
    },
    tasks: [],
    planSource: "fake",
    llmProvider: null,
    thinking: false,
    lastThought: null,
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
    rationStrain: 0,
    lastRationTick: null,
  };
}

describe("agentFacingScale", () => {
  it("flips a moving agent only when its next step is to the left", () => {
    expect(agentFacingScale(movingAgent(3))).toBe(-1);
    expect(agentFacingScale(movingAgent(5))).toBe(1);
  });
});

describe("agentSpritePath", () => {
  it("assigns the first three agents distinct character sprites", () => {
    const firstThree = [0, 1, 2].map(agentSpritePath);

    expect(new Set(firstThree).size).toBe(3);
    expect(agentSpritePath(3)).toBe(firstThree[0]);
  });
});

describe("resourceSpritePath", () => {
  it("shows a tree only while a wood resource remains", () => {
    const growing: Tile = {
      terrain: "forest",
      resource: { kind: "wood", amount: 1 },
    };
    const depleted: Tile = { terrain: "forest", resource: null };

    expect(resourceSpritePath(growing)).toBe(SPRITE_ASSETS.resource.tree);
    expect(resourceSpritePath(depleted)).toBeNull();
  });

  it("shows the food plant only while food remains", () => {
    const growing: Tile = {
      terrain: "plains",
      resource: { kind: "food", amount: 1 },
    };
    const depleted: Tile = {
      terrain: "plains",
      resource: { kind: "food", amount: 0 },
    };

    expect(resourceSpritePath(growing)).toBe(SPRITE_ASSETS.resource.food);
    expect(resourceSpritePath(depleted)).toBeNull();
  });
});

describe("terrainSpritePath", () => {
  it("uses grass for walkable ground, dirt for rock, and Graphics for water", () => {
    expect(terrainSpritePath("plains", 0)).toBe(SPRITE_ASSETS.terrain.grass[0]);
    expect(terrainSpritePath("forest", 1)).toBe(SPRITE_ASSETS.terrain.grass[1]);
    expect(terrainSpritePath("rock", 0)).toBe(SPRITE_ASSETS.terrain.rock[0]);
    expect(terrainSpritePath("water", 0)).toBeNull();
  });
});

describe("terrainTint", () => {
  it("leaves plains unchanged, cools forests, and shifts rock toward slate", () => {
    const plains = terrainTint("plains");
    const forest = terrainTint("forest");
    const rock = terrainTint("rock");

    expect(plains).toBe(0xffffff);
    expect((forest >> 8) & 0xff).toBeLessThan((plains >> 8) & 0xff);
    expect(rock & 0xff).toBeGreaterThan((rock >> 16) & 0xff);
  });
});

describe("undergrowthSpritePath", () => {
  it("adds stable undergrowth only to depleted forest", () => {
    const depletedForest: Tile = { terrain: "forest", resource: null };
    const growingForest: Tile = {
      terrain: "forest",
      resource: { kind: "wood", amount: 1 },
    };
    const depletedPlains: Tile = { terrain: "plains", resource: null };

    expect(undergrowthSpritePath(growingForest, 3)).toBeNull();
    expect(undergrowthSpritePath(depletedPlains, 3)).toBeNull();
    expect(undergrowthSpritePath(depletedForest, 3)).not.toBeNull();
    expect(undergrowthSpritePath(depletedForest, 3)).toBe(undergrowthSpritePath(depletedForest, 3));
  });
});
