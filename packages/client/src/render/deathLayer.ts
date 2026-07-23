import { type Container, Sprite } from "pixi.js";

import type { DeathEvent } from "../ui/survivalViewModel.js";
import { TILE_SIZE } from "./mapLayer.js";
import { objectDepth, SPRITE_ASSETS } from "./sprites.js";

const TOMBSTONE_OBJECT_LABEL = "tombstone-object";

export function renderDeathMarkerLayer(layer: Container, events: DeathEvent[]): void {
  for (const child of [...layer.children]) {
    if (child.label !== TOMBSTONE_OBJECT_LABEL) continue;
    layer.removeChild(child);
    child.destroy({ children: true });
  }

  for (const event of events) {
    if (event.pos === null) continue;
    const marker = Sprite.from(SPRITE_ASSETS.tombstone);
    marker.anchor.set(0.5, 1);
    marker.position.set(event.pos.x * TILE_SIZE + TILE_SIZE / 2, (event.pos.y + 1) * TILE_SIZE);
    marker.width = TILE_SIZE;
    marker.height = TILE_SIZE;
    marker.label = TOMBSTONE_OBJECT_LABEL;
    marker.zIndex = objectDepth(event.pos.y, "tombstone");
    layer.addChild(marker);
  }
}
