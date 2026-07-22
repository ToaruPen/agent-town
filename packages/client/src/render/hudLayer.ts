import type { WorldState } from "@agent-town/shared";
import { type Container, Text } from "pixi.js";

import { HUD_TEXT_COLOR } from "./colors.js";

const HUD_FONT_SIZE = 18;

export function renderHudLayer(layer: Container, state: WorldState): void {
  for (const child of layer.removeChildren()) child.destroy();

  layer.addChild(
    new Text({
      text: `tick: ${state.tick}\nwood: ${state.stockpile.wood}\nfood: ${state.stockpile.food}`,
      style: {
        fontFamily: "monospace",
        fontSize: HUD_FONT_SIZE,
        fill: HUD_TEXT_COLOR,
        lineHeight: 26,
      },
    }),
  );
}
