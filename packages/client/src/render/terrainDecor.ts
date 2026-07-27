import type { WorldState } from "@agent-town/shared";
import type { Graphics } from "pixi.js";

import {
  ROCK_BOULDER_COLOR,
  ROCK_BOULDER_HIGHLIGHT,
  SNOW_SHEET_COLOR,
  SNOW_SPECK_COLOR,
  WATER_DEEP_COLOR,
  WATER_FOAM_COLOR,
  WATER_SHALLOW_COLOR,
} from "./colors.js";
import { TILE_SIZE } from "./sprites.js";

const SHALLOW_BAND_SIZE = 3;
const SNOW_SHEET_ALPHA = 0.35;
const SNOW_SPECK_ALPHA = 0.65;
const SNOW_SPECK_SIZES = [1, 2] as const;

function isLand(world: WorldState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  return world.tiles[y * world.width + x]?.terrain !== "water";
}

function drawShallowBands(
  graphics: Graphics,
  world: WorldState,
  tileX: number,
  tileY: number,
): void {
  const x = tileX * TILE_SIZE;
  const y = tileY * TILE_SIZE;
  if (isLand(world, tileX, tileY - 1)) {
    graphics.rect(x, y, TILE_SIZE, SHALLOW_BAND_SIZE).fill(WATER_SHALLOW_COLOR);
  }
  if (isLand(world, tileX + 1, tileY)) {
    graphics
      .rect(x + TILE_SIZE - SHALLOW_BAND_SIZE, y, SHALLOW_BAND_SIZE, TILE_SIZE)
      .fill(WATER_SHALLOW_COLOR);
  }
  if (isLand(world, tileX, tileY + 1)) {
    graphics
      .rect(x, y + TILE_SIZE - SHALLOW_BAND_SIZE, TILE_SIZE, SHALLOW_BAND_SIZE)
      .fill(WATER_SHALLOW_COLOR);
  }
  if (isLand(world, tileX - 1, tileY)) {
    graphics.rect(x, y, SHALLOW_BAND_SIZE, TILE_SIZE).fill(WATER_SHALLOW_COLOR);
  }
}

function shouldDecorate(tileX: number, tileY: number, interval: number): boolean {
  return (tileX * 17 + tileY * 31) % interval === 0;
}

export function drawWater(graphics: Graphics, world: WorldState): void {
  for (const [index, tile] of world.tiles.entries()) {
    if (tile.terrain !== "water") continue;
    const tileX = index % world.width;
    const tileY = Math.floor(index / world.width);
    const x = tileX * TILE_SIZE;
    const y = tileY * TILE_SIZE;
    graphics.rect(x, y, TILE_SIZE, TILE_SIZE).fill(WATER_DEEP_COLOR);
    drawShallowBands(graphics, world, tileX, tileY);
    if (shouldDecorate(tileX, tileY, 5)) {
      graphics.roundRect(x + 5, y + 7, 6, 1, 1).fill(WATER_FOAM_COLOR);
    }
  }
}

export function drawRockCluster(graphics: Graphics, world: WorldState): void {
  for (const [index, tile] of world.tiles.entries()) {
    const tileX = index % world.width;
    const tileY = Math.floor(index / world.width);
    if (tile.terrain !== "rock" || !shouldDecorate(tileX, tileY, 3)) continue;
    const x = tileX * TILE_SIZE;
    const y = tileY * TILE_SIZE;
    graphics.circle(x + 8, y + 9, 4).fill(ROCK_BOULDER_COLOR);
    graphics.circle(x + 7, y + 7, 2).fill(ROCK_BOULDER_HIGHLIGHT);
  }
}

/** A tile-index mix fixes snow texture across redraws while varying neighbouring tiles. */
function snowCoordinate(tileIndex: number, salt: number, span: number): number {
  const mixed = Math.imul(tileIndex + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x27d4eb2d);
  return (mixed >>> 0) % span;
}

/** A pale overlay can add snow-white light that multiply tint cannot create from green grass. */
export function drawSnowSheet(graphics: Graphics, world: WorldState): void {
  graphics
    .rect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE)
    .fill({ color: SNOW_SHEET_COLOR, alpha: SNOW_SHEET_ALPHA });
  for (const tileIndex of world.tiles.keys()) {
    const tileX = tileIndex % world.width;
    const tileY = Math.floor(tileIndex / world.width);
    for (const [grainIndex, size] of SNOW_SPECK_SIZES.entries()) {
      const span = TILE_SIZE - size + 1;
      const x = tileX * TILE_SIZE + snowCoordinate(tileIndex, grainIndex * 2, span);
      const y = tileY * TILE_SIZE + snowCoordinate(tileIndex, grainIndex * 2 + 1, span);
      graphics.rect(x, y, size, size).fill({
        color: SNOW_SPECK_COLOR,
        alpha: SNOW_SPECK_ALPHA,
      });
    }
  }
}
