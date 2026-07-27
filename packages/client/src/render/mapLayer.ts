import type { WorldState } from "@agent-town/shared";
import { type Container, Graphics, Sprite } from "pixi.js";

import {
  objectDepth,
  resourceSpritePath,
  SPRITE_ASSETS,
  TILE_SIZE,
  terrainSpritePath,
  terrainTint,
  undergrowthSpritePath,
  type WorldObjectKind,
} from "./sprites.js";
import { drawRockCluster, drawWater } from "./terrainDecor.js";

export { TILE_SIZE } from "./sprites.js";

const MAP_OBJECT_LABEL = "map-object";

function createTileSprite(path: string, x: number, y: number): Sprite {
  const sprite = Sprite.from(path);
  sprite.position.set(x, y);
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  return sprite;
}

function addMapObject(
  layer: Container,
  sprite: Sprite,
  tileY: number,
  kind: WorldObjectKind,
): void {
  sprite.label = MAP_OBJECT_LABEL;
  sprite.zIndex = objectDepth(tileY, kind);
  layer.addChild(sprite);
}

function clearMapObjects(layer: Container): void {
  for (const child of [...layer.children]) {
    if (child.label !== MAP_OBJECT_LABEL) continue;
    layer.removeChild(child);
    child.destroy({ children: true });
  }
}

export function renderMapLayer(
  groundLayer: Container,
  objectLayer: Container,
  state: WorldState,
): void {
  for (const child of groundLayer.removeChildren()) child.destroy({ children: true });
  clearMapObjects(objectLayer);

  const water = new Graphics();
  groundLayer.addChild(water);
  drawWater(water, state);
  for (const [index, tile] of state.tiles.entries()) {
    const x = (index % state.width) * TILE_SIZE;
    const y = Math.floor(index / state.width) * TILE_SIZE;

    const terrainPath = terrainSpritePath(tile.terrain, index);
    if (terrainPath !== null) {
      const terrainSprite = createTileSprite(terrainPath, x, y);
      terrainSprite.tint = terrainTint(tile.terrain);
      groundLayer.addChild(terrainSprite);
    }

    const resourcePath = resourceSpritePath(tile);
    if (resourcePath !== null) {
      addMapObject(
        objectLayer,
        createTileSprite(resourcePath, x, y),
        Math.floor(index / state.width),
        "resource",
      );
    }
    const undergrowthPath = undergrowthSpritePath(tile, index);
    if (undergrowthPath !== null) {
      addMapObject(
        objectLayer,
        createTileSprite(undergrowthPath, x, y),
        Math.floor(index / state.width),
        "resource",
      );
    }
  }

  const rocks = new Graphics();
  drawRockCluster(rocks, state);
  groundLayer.addChild(rocks);

  addMapObject(
    objectLayer,
    createTileSprite(
      SPRITE_ASSETS.stockpile,
      state.stockpile.pos.x * TILE_SIZE,
      state.stockpile.pos.y * TILE_SIZE,
    ),
    state.stockpile.pos.y,
    "stockpile",
  );
}
