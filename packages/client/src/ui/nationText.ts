import type { DirectiveKind, Season, SeasonMetric, SpeedMultiplier } from "@agent-town/shared";

/**
 * A second season-label table on purpose. `survivalViewModel.ts:67` already has one over the same
 * `Season` union, but importing it would pull `WorldState`, `foodDaysRemaining` and the resident food
 * constants into the nation layer, coupling this HUD to the frozen resident contracts. Four string
 * literals is the cheaper duplication; deduplicating properly means promoting the table to
 * `packages/shared`, which the nation HUD does not otherwise need.
 */
const SEASON_LABELS: Readonly<Record<Season, string>> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

export function nationSeasonLabel(season: Season): string {
  return SEASON_LABELS[season];
}

const METRIC_LABELS: Readonly<Record<SeasonMetric, string>> = {
  food: "食料",
  materials: "資材",
  wealth: "富",
  population: "人口",
  stability: "安定",
  culture: "文化",
};

export function metricLabel(metric: SeasonMetric): string {
  return METRIC_LABELS[metric];
}

const DIRECTIVE_KIND_LABELS: Readonly<Record<DirectiveKind, string>> = {
  clearFarmland: "開墾",
  developTimber: "伐採地整備",
  openMine: "採掘場開設",
  growCity: "都市拡張",
  encourageStores: "備蓄奨励",
  holdFestival: "祭礼",
};

export function directiveKindLabel(kind: DirectiveKind): string {
  return DIRECTIVE_KIND_LABELS[kind];
}

/** The speed buttons read as their multiplier; 0 is a pause glyph, because "x0" is not a speed. */
export function speedLabel(speed: SpeedMultiplier): string {
  return speed === 0 ? "⏸" : `x${speed}`;
}

/** Prosperity components are named for what the player is being scored on, not for their field names. */
const PROSPERITY_COMPONENT_LABELS = {
  population: "人口",
  production: "生産",
  wealth: "富",
  stability: "安定",
  culture: "文化",
} as const;

export type ProsperityComponent = keyof typeof PROSPERITY_COMPONENT_LABELS;

export function prosperityComponentLabel(component: ProsperityComponent): string {
  return PROSPERITY_COMPONENT_LABELS[component];
}
