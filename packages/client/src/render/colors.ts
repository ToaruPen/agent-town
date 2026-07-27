export const TERRAIN_TINTS = {
  plains: 0xffffff,
  forest: 0xedf3ec,
  rock: 0x8795a6,
  water: 0xffffff,
} as const;
export const WATER_DEEP_COLOR = 0x315f87;
export const WATER_SHALLOW_COLOR = 0x5f9eb0;
export const WATER_FOAM_COLOR = 0xb8d8d5;
export const ROCK_BOULDER_COLOR = 0x596a78;
export const ROCK_BOULDER_HIGHLIGHT = 0x83919a;
export const SNOW_SHEET_COLOR = 0xe8f0f8;
export const SNOW_SPECK_COLOR = 0xf8fcff;
export const TRAIL_COLORS = {
  trace: 0x9a835f,
  trail: 0x876a43,
  establishedTrail: 0x6c5234,
} as const;
export const TRAIL_GRIT_COLOR = 0x493722;
export const AGENT_LABEL_COLOR = 0xffffff;
export const HUD_TEXT_COLOR = 0xffffff;
/** Nation banner ring. Twelve slots, separated for use at alpha 1.0 on borders and city glyphs.
 *  Higher chroma than Polity.color on purpose: those are muted for large flat areas (the 国柄 card),
 *  these are for thin marks. Slots 0-7 are primaries (min ΔE76 31.2); 8-11 are collision fallbacks
 *  that differ from their hue neighbours on lightness as well as hue. */
export const NATION_BANNER_RING = [
  0xd34f55, 0xeea043, 0x94953b, 0x68b072, 0x12968f, 0x0082bd, 0x685ea8, 0xce68ac, 0x8a4a22,
  0x557035, 0x8ecfe0, 0x512f6b,
] as const;
/** The dark casing under every foreground mark, which is what makes a banner colour legible on any
 *  terrain (moss 0x557035 is only ΔE76 16.8 from plains). Already the world-map city stroke. */
export const MAP_CASING_COLOR = 0x141b1e;
/** Progress and highlight. Already both the facility progress bar and the highlighted trade route. */
export const MAP_ACCENT_COLOR = 0xfff176;
/** The world map's city fill before nations owned a banner colour; now only the unclaimed fallback. */
export const MAP_CITY_FILL_COLOR = 0xf1e8ce;
