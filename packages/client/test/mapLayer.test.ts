import type { WorldState } from "@agent-town/shared";
import { Container, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";

import { renderMapLayer, TILE_SIZE } from "../src/render/mapLayer.js";
import { objectDepth, SPRITE_ASSETS, SPRITE_PATHS } from "../src/render/sprites.js";
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
});
