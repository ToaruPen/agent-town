import type { AgentState, Tile } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  agentFacingScale,
  agentSpritePath,
  resourceSpritePath,
  SPRITE_ASSETS,
  terrainSpritePath,
} from "../src/render/sprites.js";

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
    thinking: false,
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
