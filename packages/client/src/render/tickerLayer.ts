import { type Container, Graphics, Text } from "pixi.js";

import { HUD_TEXT_COLOR } from "./colors.js";

export type TickerTone = "death" | "social";

export interface TickerMessage {
  text: string;
  tone: TickerTone;
}

const TICKER_FONT_SIZE = 11;
const TICKER_HORIZONTAL_PADDING = 8;
const TICKER_VERTICAL_PADDING = 4;
const TICKER_BACKGROUND_COLOR = 0x182126;
const TICKER_BORDER_COLORS: Readonly<Record<TickerTone, number>> = {
  death: 0xb29a80,
  social: 0x6f9f91,
};

export function renderTickerLayer(layer: Container, message: TickerMessage | null): void {
  for (const child of layer.removeChildren()) child.destroy({ children: true });
  if (message === null) return;

  const label = new Text({
    text: message.text,
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
    .stroke({ color: TICKER_BORDER_COLORS[message.tone], alpha: 0.8, width: 1 });
  layer.eventMode = "none";
  layer.addChild(background, label);
}
