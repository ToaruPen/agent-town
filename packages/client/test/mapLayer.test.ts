import { DAYS_PER_SEASON, TICKS_PER_DAY, type WorldState } from "@agent-town/shared";
import { Container, Graphics, Sprite } from "pixi.js";
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

interface FilledRectangle {
  rectangle: number[];
  color: number;
  alpha: number;
}

function filledRectangles(graphics: Graphics): FilledRectangle[] {
  return graphics.context.instructions.flatMap((instruction) => {
    if (instruction.action !== "fill") return [];
    return instruction.data.path.instructions.flatMap((pathInstruction) => {
      if (pathInstruction.action !== "rect") return [];
      return [
        {
          rectangle: pathInstruction.data.slice(0, 4),
          color: instruction.data.style.color,
          alpha: instruction.data.style.alpha,
        },
      ];
    });
  });
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

  it("lays a pale sheet over the whole ground in winter only", () => {
    const winterGround = new Container();
    const winterObjects = new Container();
    renderMapLayer(winterGround, winterObjects, seasonalWorld(3));

    const snow = winterGround.children.at(-1);
    expect(snow).toBeInstanceOf(Graphics);
    if (!(snow instanceof Graphics)) throw new Error("missing winter snow sheet");
    expect(filledRectangles(snow)).toContainEqual({
      rectangle: [0, 0, 3 * TILE_SIZE, TILE_SIZE],
      color: 0xe8f0f8,
      alpha: 0.35,
    });

    const springGround = new Container();
    renderMapLayer(springGround, new Container(), seasonalWorld(0));
    expect(
      springGround.children.filter((child) => child instanceof Graphics).flatMap(filledRectangles),
    ).not.toContainEqual({
      rectangle: [0, 0, 3 * TILE_SIZE, TILE_SIZE],
      color: 0xe8f0f8,
      alpha: 0.35,
    });
  });

  it("scatters two stable snow grain sizes across every winter tile", () => {
    const firstGround = new Container();
    const secondGround = new Container();
    renderMapLayer(firstGround, new Container(), seasonalWorld(3));
    renderMapLayer(secondGround, new Container(), seasonalWorld(3));

    const firstSnow = firstGround.children.at(-1);
    const secondSnow = secondGround.children.at(-1);
    if (!(firstSnow instanceof Graphics) || !(secondSnow instanceof Graphics)) {
      throw new Error("missing winter snow sheet");
    }
    const isSnowSpeck = ({ rectangle }: FilledRectangle): boolean => {
      const [, , width, height] = rectangle;
      return width === height && (width === 1 || width === 2);
    };
    const firstSpecks = filledRectangles(firstSnow).filter(isSnowSpeck);
    const secondSpecks = filledRectangles(secondSnow).filter(isSnowSpeck);

    expect(firstSpecks).toEqual(secondSpecks);
    expect(firstSpecks).toHaveLength(6);
    for (let tileIndex = 0; tileIndex < 3; tileIndex += 1) {
      const tileStart = tileIndex * TILE_SIZE;
      const tileSpecks = firstSpecks.filter(({ rectangle }) => {
        const [x = 0, , size = 0] = rectangle;
        return x >= tileStart && x + size <= tileStart + TILE_SIZE;
      });
      expect(new Set(tileSpecks.map(({ rectangle }) => rectangle[2]))).toEqual(new Set([1, 2]));
    }
    expect(
      new Set(
        firstSpecks.map(({ rectangle }) => {
          const [x = 0, y = 0] = rectangle;
          return `${x % TILE_SIZE},${y}`;
        }),
      ).size,
    ).toBeGreaterThan(2);
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
