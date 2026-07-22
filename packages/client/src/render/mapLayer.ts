import type { WorldState } from "@agent-town/shared";
import { Container, Graphics, Sprite } from "pixi.js";

import { WATER_COLOR } from "./colors.js";
import { resourceSpritePath, SPRITE_ASSETS, terrainSpritePath } from "./sprites.js";

export const TILE_SIZE = 12;

function createTileSprite(path: string, x: number, y: number): Sprite {
  const sprite = Sprite.from(path);
  sprite.position.set(x, y);
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  return sprite;
}

export function renderMapLayer(layer: Container, state: WorldState): void {
  for (const child of layer.removeChildren()) child.destroy({ children: true });

  const ground = new Container();
  const water = new Graphics();
  const features = new Container();
  ground.addChild(water);
  for (const [index, tile] of state.tiles.entries()) {
    const x = (index % state.width) * TILE_SIZE;
    const y = Math.floor(index / state.width) * TILE_SIZE;

    const terrainPath = terrainSpritePath(tile.terrain, index);
    if (terrainPath === null) water.rect(x, y, TILE_SIZE, TILE_SIZE).fill(WATER_COLOR);
    else ground.addChild(createTileSprite(terrainPath, x, y));

    const resourcePath = resourceSpritePath(tile);
    if (resourcePath !== null) features.addChild(createTileSprite(resourcePath, x, y));
  }

  features.addChild(
    createTileSprite(
      SPRITE_ASSETS.stockpile,
      state.stockpile.pos.x * TILE_SIZE,
      state.stockpile.pos.y * TILE_SIZE,
    ),
  );
  layer.addChild(ground, features);
}
