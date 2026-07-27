import type { WorldState } from "@agent-town/shared";
import type { Graphics } from "pixi.js";

import {
  ROCK_BOULDER_COLOR,
  ROCK_BOULDER_HIGHLIGHT,
  WATER_DEEP_COLOR,
  WATER_FOAM_COLOR,
  WATER_SHALLOW_COLOR,
} from "./colors.js";
import { TILE_SIZE } from "./sprites.js";

const SHALLOW_BAND_SIZE = 3;

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
