import type { WorldState } from "@agent-town/shared";
import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";

import { WATER_SHALLOW_COLOR } from "../src/render/colors.js";
import { drawRockCluster, drawWater } from "../src/render/terrainDecor.js";
import { makeTrailCellsFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

function makeWorld(terrains: WorldState["tiles"][number]["terrain"][]): WorldState {
  const width = 3;
  const height = 3;
  if (terrains.length !== width * height) throw new Error("terrain fixture must be 3x3");
  return {
    tick: 0,
    width,
    height,
    tiles: terrains.map((terrain) => ({ terrain, resource: null })),
    agents: [],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [],
    trailCells: makeTrailCellsFixture(width, height),
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
      worldMap: makeWorldMapFixture(),
    },
  };
}

function fillColors(graphics: Graphics): number[] {
  return graphics.context.instructions.flatMap((instruction) =>
    instruction.action === "fill" ? [instruction.data.style.color] : [],
  );
}

function instructionSignature(graphics: Graphics): string[] {
  return graphics.context.instructions.map((instruction) => {
    if (instruction.action !== "fill") return instruction.action;
    return `${instruction.action}:${instruction.data.style.color}:${instruction.data.style.alpha}`;
  });
}

describe("drawWater", () => {
  it("bands all four inside edges when one water tile is surrounded by land", () => {
    const world = makeWorld([
      "plains",
      "plains",
      "plains",
      "plains",
      "water",
      "plains",
      "plains",
      "plains",
      "plains",
    ]);
    const graphics = new Graphics();

    drawWater(graphics, world);

    expect(fillColors(graphics).filter((color) => color === WATER_SHALLOW_COLOR)).toHaveLength(4);
  });

  it("adds no shallow band to water enclosed by water", () => {
    const world = makeWorld(Array.from({ length: 9 }, () => "water"));
    const graphics = new Graphics();

    drawWater(graphics, world);

    expect(fillColors(graphics)).not.toContain(WATER_SHALLOW_COLOR);
  });
});

describe("terrain decoration determinism", () => {
  it("draws the same water and rock instructions twice for the same world", () => {
    const world = makeWorld([
      "rock",
      "plains",
      "water",
      "plains",
      "water",
      "plains",
      "rock",
      "plains",
      "rock",
    ]);
    const firstWater = new Graphics();
    const secondWater = new Graphics();
    const firstRock = new Graphics();
    const secondRock = new Graphics();

    drawWater(firstWater, world);
    drawWater(secondWater, world);
    drawRockCluster(firstRock, world);
    drawRockCluster(secondRock, world);

    expect(instructionSignature(firstWater)).toEqual(instructionSignature(secondWater));
    expect(instructionSignature(firstRock)).toEqual(instructionSignature(secondRock));
  });
});
