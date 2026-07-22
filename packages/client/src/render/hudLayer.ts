import type { WorldState } from "@agent-town/shared";
import { Container, Graphics, Text } from "pixi.js";

import { buildSurvivalHudViewModel, type SurvivalHudViewModel } from "../ui/survivalViewModel.js";
import { HUD_TEXT_COLOR } from "./colors.js";

const HUD_WIDTH = 202;
export const HUD_PANEL_HEIGHT = 65;
const HUD_INSET = 7;
const HUD_RADIUS = 3;
const HUD_BACKGROUND_COLOR = 0x182126;
const HUD_BORDER_COLOR = 0x65747a;
const HUD_MUTED_COLOR = 0xb9c8cd;
const HUD_ALERT_COLOR = 0xf19a78;
const HUD_FONT_SIZE = 11;
const HUD_SMALL_FONT_SIZE = 9;
const HUD_LINE_HEIGHT = 17;
const SEASON_COLORS: Record<SurvivalHudViewModel["season"], number> = {
  spring: 0x8ec07c,
  summer: 0xe0bd62,
  autumn: 0xd7864b,
  winter: 0x8fbac8,
};

function text(content: string, size = HUD_FONT_SIZE, color = HUD_TEXT_COLOR): Text {
  return new Text({
    text: content,
    style: {
      fontFamily: "monospace",
      fontSize: size,
      fill: color,
      lineHeight: HUD_LINE_HEIGHT,
    },
  });
}

function background(): Graphics {
  return new Graphics()
    .roundRect(0, 0, HUD_WIDTH, HUD_PANEL_HEIGHT, HUD_RADIUS)
    .fill({ color: HUD_BACKGROUND_COLOR, alpha: 0.92 })
    .stroke({ color: HUD_BORDER_COLOR, alpha: 0.75, width: 1 });
}

function renderCalendar(viewModel: SurvivalHudViewModel): Container {
  const calendar = new Container();
  const badge = new Graphics()
    .roundRect(0, 0, 70, 17, 2)
    .fill({ color: SEASON_COLORS[viewModel.season], alpha: 0.22 })
    .stroke({ color: SEASON_COLORS[viewModel.season], alpha: 0.9, width: 1 });
  const label = text(`${viewModel.season.toUpperCase()} · D${viewModel.day}`, HUD_SMALL_FONT_SIZE);
  label.position.set(4, 0);
  calendar.addChild(badge, label);
  return calendar;
}

export function renderHudLayer(layer: Container, state: WorldState): void {
  for (const child of layer.removeChildren()) child.destroy({ children: true });
  const viewModel = buildSurvivalHudViewModel(state);
  const calendar = renderCalendar(viewModel);
  calendar.position.set(HUD_INSET, HUD_INSET);

  const population = text(`pop ${viewModel.population}`, HUD_SMALL_FONT_SIZE, HUD_MUTED_COLOR);
  population.anchor.set(1, 0);
  population.position.set(HUD_WIDTH - HUD_INSET, HUD_INSET);

  const foodDays = viewModel.foodDays === "—" ? viewModel.foodDays : `${viewModel.foodDays}d`;
  const food = text(`food: ${viewModel.foodStored} · ${foodDays}`);
  food.position.set(HUD_INSET, HUD_INSET + HUD_LINE_HEIGHT + 2);

  const woodColor = viewModel.woodForecast === "short" ? HUD_ALERT_COLOR : HUD_TEXT_COLOR;
  const wood = text(
    `wood: ${viewModel.woodStored} · ${viewModel.woodForecast}`,
    HUD_FONT_SIZE,
    woodColor,
  );
  wood.position.set(HUD_INSET, HUD_INSET + HUD_LINE_HEIGHT * 2 + 2);

  layer.eventMode = "none";
  layer.addChild(background(), calendar, population, food, wood);
}
