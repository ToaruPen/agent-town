import type {
  ActiveDirective,
  NationState,
  Polity,
  SeasonMetric,
  SeasonReport,
} from "@agent-town/shared";

import { directiveKindLabel, metricLabel } from "./nationText.js";

export type MetricDirection = "up" | "down" | "flat" | "unknown";

export interface NationMetricRow {
  metric: SeasonMetric;
  label: string;
  /** Rounded and thousand-grouped. The exact value stays on `NationState` for the next season's sums. */
  valueLabel: string;
  /** Null until a season has resolved — not zero, which would claim a decision the game has not made. */
  delta: number | null;
  deltaLabel: string;
  direction: MetricDirection;
}

export interface NationActiveDirectiveRow {
  id: string;
  label: string;
  pipsFilled: number;
  pipsTotal: number;
  seasonsRemaining: number;
  progressLabel: string;
}

export interface NationDashboardViewModel {
  name: string;
  isPlayer: boolean;
  metrics: NationMetricRow[];
  activeDirectives: NationActiveDirectiveRow[];
  waitingForFirstReport: boolean;
}

/** Fixed so rows never reshuffle between renders; matches the always-on layout in hud.md §4.1. */
const METRIC_ORDER: readonly SeasonMetric[] = [
  "food",
  "materials",
  "wealth",
  "population",
  "stability",
  "culture",
];

/**
 * Keyed by `SeasonMetric` rather than switched, so a seventh metric is a compile error here instead of
 * a row that silently goes missing from the dashboard.
 */
const METRIC_VALUES: Readonly<Record<SeasonMetric, (nation: NationState) => number>> = {
  food: (nation) => nation.stocks.food,
  materials: (nation) => nation.stocks.materials,
  wealth: (nation) => nation.stocks.wealth,
  population: (nation) => nation.population,
  stability: (nation) => nation.stability,
  culture: (nation) => nation.culture,
};

function groupThousands(value: number): string {
  return Math.abs(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The one rounding decision, made here and nowhere else: the live server sends stocks as floats
 * (`1949.8451999999997` measured on the wire), and the player reads whole units.
 */
function formatCount(value: number): string {
  const rounded = Math.round(value);
  return rounded < 0 ? `−${groupThousands(rounded)}` : groupThousands(rounded);
}

function metricDelta(report: SeasonReport | null, metric: SeasonMetric): number | null {
  if (report === null) return null;
  return report.entries
    .filter((entry) => entry.metric === metric)
    .reduce((sum, entry) => sum + entry.delta, 0);
}

function deltaDirection(delta: number | null): MetricDirection {
  if (delta === null) return "unknown";
  const rounded = Math.round(delta);
  if (rounded > 0) return "up";
  if (rounded < 0) return "down";
  return "flat";
}

/** A dash covers both "no season yet" and "this metric cancelled out"; `direction` tells them apart. */
function formatDelta(delta: number | null): string {
  const direction = deltaDirection(delta);
  if (delta === null || direction === "flat") return "―";
  const magnitude = groupThousands(Math.round(delta));
  return direction === "up" ? `▲+${magnitude}` : `▼−${magnitude}`;
}

function metricRow(nation: NationState, metric: SeasonMetric): NationMetricRow {
  const delta = metricDelta(nation.lastReport, metric);
  return {
    metric,
    label: metricLabel(metric),
    valueLabel: formatCount(METRIC_VALUES[metric](nation)),
    delta,
    deltaLabel: formatDelta(delta),
    direction: deltaDirection(delta),
  };
}

function directiveRow(directive: ActiveDirective): NationActiveDirectiveRow {
  const pipsFilled = directive.totalSeasons - directive.seasonsRemaining;
  const pips = "●".repeat(pipsFilled) + "○".repeat(directive.seasonsRemaining);
  return {
    id: directive.id,
    label: directiveKindLabel(directive.kind),
    pipsFilled,
    pipsTotal: directive.totalSeasons,
    seasonsRemaining: directive.seasonsRemaining,
    progressLabel: `${pips} 残${directive.seasonsRemaining}季`,
  };
}

/**
 * The always-on dashboard for one nation. Takes `(nation, polity)` because `NationState` has no name
 * and no colour — those live on `Polity`, joined by id, the same join `worldMapView.buildCells` does.
 */
export function buildNationDashboardViewModel(
  nation: NationState,
  polity: Polity,
  isPlayer: boolean,
): NationDashboardViewModel {
  return {
    name: polity.name,
    isPlayer,
    metrics: METRIC_ORDER.map((metric) => metricRow(nation, metric)),
    activeDirectives: nation.activeDirectives.map(directiveRow),
    waitingForFirstReport: nation.lastReport === null,
  };
}
