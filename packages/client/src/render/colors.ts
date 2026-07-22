import type { Terrain } from "@agent-town/shared";

export const TERRAIN_COLORS: Record<Terrain, number> = {
  plains: 0x7aa35c,
  forest: 0x3e6b2f,
  water: 0x3b6ea5,
  rock: 0x6d6d6d,
};

export const WOOD_MARKER_COLOR = 0x24451f;
export const FOOD_MARKER_COLOR = 0xc94343;
export const AGENT_COLORS = [0xf2c14e, 0xf78154, 0x9b5de5] as const;
export const AGENT_LABEL_COLOR = 0xffffff;
export const CARRY_INDICATOR_COLOR = 0xffe66d;
export const HUD_TEXT_COLOR = 0xffffff;
