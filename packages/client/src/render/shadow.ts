import { Graphics } from "pixi.js";

import { TILE_SIZE } from "./sprites.js";

const SHADOW_COLOR = 0x101820;
const SHADOW_ALPHA = 0.22;
const SHADOW_HEIGHT = TILE_SIZE / 4;
export const BUILDING_SHADOW_WIDTH_RATIO = 0.95;

/** A soft ellipse at an object's feet, so a sprite sits on the ground instead of over it. */
export function shadowGraphic(widthRatio: number): Graphics {
  const shadow = new Graphics()
    .ellipse(0, 0, (TILE_SIZE * widthRatio) / 2, SHADOW_HEIGHT / 2)
    .fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
  shadow.eventMode = "none";
  return shadow;
}
