import type { House } from "@agent-town/shared";
import { type Container, Sprite } from "pixi.js";

import { TILE_SIZE } from "./mapLayer.js";
import { SPRITE_ASSETS } from "./sprites.js";

const CONSTRUCTION_ALPHA = 0.45;

export function renderStructureLayer(layer: Container, buildings: House[]): void {
  for (const child of layer.removeChildren()) child.destroy({ children: true });

  for (const building of buildings) {
    const sprite = Sprite.from(SPRITE_ASSETS.house);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(
      building.pos.x * TILE_SIZE + TILE_SIZE / 2,
      (building.pos.y + 1) * TILE_SIZE,
    );
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.alpha = building.complete ? 1 : CONSTRUCTION_ALPHA;
    layer.addChild(sprite);
  }
}
