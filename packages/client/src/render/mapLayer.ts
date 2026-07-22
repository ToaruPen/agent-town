import type { WorldState } from "@agent-town/shared";
import { type Container, Graphics } from "pixi.js";

import { FOOD_MARKER_COLOR, TERRAIN_COLORS, WOOD_MARKER_COLOR } from "./colors.js";

export const TILE_SIZE = 12;

const RESOURCE_SQUARE_SIZE = 4;
const FOOD_MARKER_RADIUS = 2;

export function renderMapLayer(layer: Container, state: WorldState): void {
  for (const child of layer.removeChildren()) child.destroy();

  const graphics = new Graphics();
  for (const [index, tile] of state.tiles.entries()) {
    const x = (index % state.width) * TILE_SIZE;
    const y = Math.floor(index / state.width) * TILE_SIZE;
    graphics.rect(x, y, TILE_SIZE, TILE_SIZE).fill(TERRAIN_COLORS[tile.terrain]);

    if (tile.resource === null || tile.resource.amount <= 0) continue;
    if (tile.resource.kind === "wood") {
      const markerOffset = (TILE_SIZE - RESOURCE_SQUARE_SIZE) / 2;
      graphics
        .rect(x + markerOffset, y + markerOffset, RESOURCE_SQUARE_SIZE, RESOURCE_SQUARE_SIZE)
        .fill(WOOD_MARKER_COLOR);
    } else {
      graphics
        .circle(x + TILE_SIZE / 2, y + TILE_SIZE / 2, FOOD_MARKER_RADIUS)
        .fill(FOOD_MARKER_COLOR);
    }
  }

  layer.addChild(graphics);
}
