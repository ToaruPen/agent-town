import { DAYS_PER_SEASON, TICKS_PER_DAY, type WorldState } from "@agent-town/shared";
import { Container, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";

import { renderMapLayer, TILE_SIZE } from "../src/render/mapLayer.js";
import {
  objectDepth,
  SPRITE_ASSETS,
  SPRITE_PATHS,
  seasonGroundTint,
  terrainTint,
} from "../src/render/sprites.js";
import { makeTrailCellsFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

function makeWorld(): WorldState {
  const width = 3;
  const height = 1;
  return {
    tick: 0,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({
      terrain: "plains" as const,
      resource: null,
    })),
    agents: [],
    stockpile: { pos: { x: 1, y: 0 }, wood: 0, food: 0 },
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

function seasonalWorld(seasonIndex: number): WorldState {
  return {
    ...makeWorld(),
    tick: seasonIndex * DAYS_PER_SEASON * TICKS_PER_DAY,
    tiles: [
      { terrain: "forest", resource: { kind: "wood", amount: 1 } },
      { terrain: "plains", resource: { kind: "food", amount: 1 } },
      { terrain: "forest", resource: null },
    ],
  };
}

function multiplyTint(left: number, right: number): number {
  const red = Math.round((((left >> 16) & 0xff) * ((right >> 16) & 0xff)) / 0xff);
  const green = Math.round((((left >> 8) & 0xff) * ((right >> 8) & 0xff)) / 0xff);
  const blue = Math.round(((left & 0xff) * (right & 0xff)) / 0xff);
  return (red << 16) | (green << 8) | blue;
}

describe("renderMapLayer", () => {
  it("shows the stockpile as two native-size supplies side by side", () => {
    const groundLayer = new Container();
    const objectLayer = new Container();

    renderMapLayer(groundLayer, objectLayer, makeWorld());

    expect(objectLayer.children).toHaveLength(2);
    expect(objectLayer.children.every((child) => child instanceof Sprite)).toBe(true);
    expect(objectLayer.children.map(({ position }) => position.x)).toEqual([
      TILE_SIZE - TILE_SIZE / 4,
      TILE_SIZE + TILE_SIZE / 4,
    ]);
    expect(
      objectLayer.children.every(
        ({ width, height }) => width === TILE_SIZE && height === TILE_SIZE,
      ),
    ).toBe(true);
    expect(objectLayer.children.every(({ zIndex }) => zIndex === objectDepth(0, "stockpile"))).toBe(
      true,
    );
  });

  it("preloads a basket and log instead of the beehive", () => {
    expect(SPRITE_ASSETS.stockpile).toEqual({
      basket: "/assets/tiny-town/Tiles/tile_0130.png",
      log: "/assets/tiny-town/Tiles/tile_0106.png",
    });
    expect(SPRITE_PATHS).toContain(SPRITE_ASSETS.stockpile.basket);
    expect(SPRITE_PATHS).toContain(SPRITE_ASSETS.stockpile.log);
    expect(SPRITE_PATHS).not.toContain("/assets/tiny-town/Tiles/tile_0094.png");
  });

  it("composes the terrain and season tint exactly once", () => {
    const groundLayer = new Container();
    const objectLayer = new Container();

    renderMapLayer(groundLayer, objectLayer, seasonalWorld(3));

    const terrainSprites = groundLayer.children.filter((child) => child instanceof Sprite);
    expect(terrainSprites[0]?.tint).toBe(
      multiplyTint(terrainTint("forest"), seasonGroundTint("winter")),
    );
  });

  it("drains winter foliage while resource markers keep their saturation in every season", () => {
    for (const seasonIndex of [0, 1, 2, 3]) {
      const groundLayer = new Container();
      const objectLayer = new Container();

      renderMapLayer(groundLayer, objectLayer, seasonalWorld(seasonIndex));

      const resourceSprites = objectLayer.children.filter((child) => child instanceof Sprite);
      const tree = resourceSprites[0];
      const food = resourceSprites[1];
      const undergrowth = resourceSprites[2];
      if (seasonIndex === 3) {
        expect(tree?.tint).not.toBe(0xffffff);
      } else {
        expect(tree?.tint).toBe(0xffffff);
      }
      expect(food?.tint).toBe(0xffffff);
      expect(undergrowth?.tint).toBe(0xffffff);
    }
  });
});
