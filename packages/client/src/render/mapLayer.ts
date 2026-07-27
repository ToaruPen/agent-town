import { seasonOfTick, type Tile, type WorldState } from "@agent-town/shared";
import { type Container, Graphics, Sprite } from "pixi.js";
import { shadowGraphic } from "./shadow.js";
import {
  objectDepth,
  resourceSpritePath,
  SPRITE_ASSETS,
  seasonGroundTint,
  TILE_SIZE,
  terrainSpritePath,
  terrainTint,
  treeSpritePath,
  undergrowthSpritePath,
  type WorldObjectKind,
} from "./sprites.js";
import { drawRockCluster, drawWater } from "./terrainDecor.js";

export { TILE_SIZE } from "./sprites.js";

const MAP_OBJECT_LABEL = "map-object";
// Multiply tint cannot add gray, so winter pulls down autumn reds to mute the foliage.
const WINTER_TREE_TINT = 0x88c4e8;
const TREE_SHADOW_WIDTH_RATIO = 0.8;
const TREE_SHADOW_DEPTH_OFFSET = 0.1;

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

function addTreeShadow(layer: Container, x: number, y: number, tileY: number): void {
  const shadow = shadowGraphic(TREE_SHADOW_WIDTH_RATIO);
  shadow.position.set(x + TILE_SIZE / 2, y + TILE_SIZE - 2);
  shadow.label = MAP_OBJECT_LABEL;
  shadow.zIndex = objectDepth(tileY, "resource") - TREE_SHADOW_DEPTH_OFFSET;
  layer.addChild(shadow);
}

function multiplyTint(left: number, right: number): number {
  const red = Math.round((((left >> 16) & 0xff) * ((right >> 16) & 0xff)) / 0xff);
  const green = Math.round((((left >> 8) & 0xff) * ((right >> 8) & 0xff)) / 0xff);
  const blue = Math.round(((left & 0xff) * (right & 0xff)) / 0xff);
  return (red << 16) | (green << 8) | blue;
}

function seasonalResourcePath(
  tile: Tile,
  season: ReturnType<typeof seasonOfTick>,
  tileIndex: number,
): string | null {
  if (tile.resource?.kind === "wood" && tile.resource.amount > 0) {
    return treeSpritePath(season, tileIndex);
  }
  return resourceSpritePath(tile);
}

function renderTile(
  groundLayer: Container,
  objectLayer: Container,
  tile: Tile,
  index: number,
  width: number,
  season: ReturnType<typeof seasonOfTick>,
): void {
  const x = (index % width) * TILE_SIZE;
  const tileY = Math.floor(index / width);
  const y = tileY * TILE_SIZE;
  const terrainPath = terrainSpritePath(tile.terrain, index);
  if (terrainPath !== null) {
    const terrainSprite = createTileSprite(terrainPath, x, y);
    terrainSprite.tint = multiplyTint(terrainTint(tile.terrain), seasonGroundTint(season));
    groundLayer.addChild(terrainSprite);
  }

  const resourcePath = seasonalResourcePath(tile, season, index);
  if (resourcePath !== null) {
    const resourceSprite = createTileSprite(resourcePath, x, y);
    if (tile.resource?.kind === "wood" && season === "winter") {
      resourceSprite.tint = WINTER_TREE_TINT;
    }
    if (tile.resource?.kind === "wood") {
      addTreeShadow(objectLayer, x, y, tileY);
    }
    addMapObject(objectLayer, resourceSprite, tileY, "resource");
  }
  const undergrowthPath = undergrowthSpritePath(tile, index);
  if (undergrowthPath !== null) {
    addMapObject(objectLayer, createTileSprite(undergrowthPath, x, y), tileY, "resource");
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
  const season = seasonOfTick(state.tick);
  for (const [index, tile] of state.tiles.entries()) {
    renderTile(groundLayer, objectLayer, tile, index, state.width, season);
  }

  const rocks = new Graphics();
  drawRockCluster(rocks, state);
  groundLayer.addChild(rocks);

  const stockpileX = state.stockpile.pos.x * TILE_SIZE;
  const stockpileY = state.stockpile.pos.y * TILE_SIZE;
  addMapObject(
    objectLayer,
    createTileSprite(SPRITE_ASSETS.stockpile.basket, stockpileX - TILE_SIZE / 4, stockpileY),
    state.stockpile.pos.y,
    "stockpile",
  );
  addMapObject(
    objectLayer,
    createTileSprite(SPRITE_ASSETS.stockpile.log, stockpileX + TILE_SIZE / 4, stockpileY),
    state.stockpile.pos.y,
    "stockpile",
  );
}
