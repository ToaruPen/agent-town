import { type Container, Graphics, Sprite, Text } from "pixi.js";

import type { DeathEvent } from "../ui/survivalViewModel.js";
import { HUD_TEXT_COLOR } from "./colors.js";
import { TILE_SIZE } from "./mapLayer.js";
import { SPRITE_ASSETS } from "./sprites.js";

const TICKER_FONT_SIZE = 11;
const TICKER_HORIZONTAL_PADDING = 8;
const TICKER_VERTICAL_PADDING = 4;
const TICKER_BACKGROUND_COLOR = 0x182126;
const TICKER_BORDER_COLOR = 0xb29a80;

export function renderDeathMarkerLayer(layer: Container, events: DeathEvent[]): void {
  for (const child of layer.removeChildren()) child.destroy({ children: true });

  for (const event of events) {
    if (event.pos === null) continue;
    const marker = Sprite.from(SPRITE_ASSETS.tombstone);
    marker.anchor.set(0.5, 1);
    marker.position.set(event.pos.x * TILE_SIZE + TILE_SIZE / 2, (event.pos.y + 1) * TILE_SIZE);
    marker.width = TILE_SIZE;
    marker.height = TILE_SIZE;
    layer.addChild(marker);
  }
}

export function renderDeathTickerLayer(layer: Container, event: DeathEvent | null): void {
  for (const child of layer.removeChildren()) child.destroy({ children: true });
  if (event === null) return;

  const label = new Text({
    text: event.text,
    style: {
      fontFamily: "monospace",
      fontSize: TICKER_FONT_SIZE,
      fill: HUD_TEXT_COLOR,
    },
  });
  label.anchor.set(0.5, 0);
  label.position.y = TICKER_VERTICAL_PADDING;
  const background = new Graphics()
    .roundRect(
      -label.width / 2 - TICKER_HORIZONTAL_PADDING,
      0,
      label.width + TICKER_HORIZONTAL_PADDING * 2,
      label.height + TICKER_VERTICAL_PADDING * 2,
      2,
    )
    .fill({ color: TICKER_BACKGROUND_COLOR, alpha: 0.92 })
    .stroke({ color: TICKER_BORDER_COLOR, alpha: 0.8, width: 1 });
  layer.eventMode = "none";
  layer.addChild(background, label);
}
