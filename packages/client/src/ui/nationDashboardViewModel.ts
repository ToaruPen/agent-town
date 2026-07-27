import type {
  ActiveDirective,
  DirectiveId,
  NationState,
  Polity,
  SeasonMetric,
  SeasonReport,
} from "@agent-town/shared";

import type { NationOrders } from "./nationHudState.js";
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

/**
 * `chancellor` covers both "autopilot, nothing queued" and "autopilot, an order waiting" — in each case
 * the chancellor is what commits, and the waiting order is reported in `detail` rather than by a state of
 * its own, because the slot answers exactly one question.
 */
export type CommitSlotKind = "queued" | "chancellor" | "idle" | "unknown";

export interface NationCommitSlotViewModel {
  kind: CommitSlotKind;
  /** What commits at the next boundary, in one line. Never empty. */
  headline: string;
  /** The waiting-order note, set only when autopilot is overriding a queued order. */
  detail: string | null;
  /** True only for the warning state: no autopilot and nothing queued, so the season is wasted. */
  emphasis: boolean;
  /** Non-null whenever an order is queued — a waiting order stays cancellable under autopilot (measured). */
  cancelDirectiveId: DirectiveId | null;
}

export interface NationDashboardViewModel {
  name: string;
  isPlayer: boolean;
  metrics: NationMetricRow[];
  activeDirectives: NationActiveDirectiveRow[];
  waitingForFirstReport: boolean;
  commitSlot: NationCommitSlotViewModel;
}

/**
 * Fixed so rows never reshuffle between renders; matches the always-on layout in hud.md §4.1.
 *
 * Exported for `seasonReportViewModel.ts`, which draws its diff over the same six metrics in the same
 * order (hud.md §4.5) — a second copy of this array would be one more place a seventh metric could go
 * missing from silently.
 */
export const METRIC_ORDER: readonly SeasonMetric[] = [
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

/** Exported so `seasonReportViewModel.ts`'s reason-line numbers group the same way the dashboard's do. */
export function groupThousands(value: number): string {
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

/** Exported so the season report's metric rows read the same up/down/flat as the dashboard's. */
export function deltaDirection(delta: number | null): MetricDirection {
  if (delta === null) return "unknown";
  const rounded = Math.round(delta);
  if (rounded > 0) return "up";
  if (rounded < 0) return "down";
  return "flat";
}

/**
 * A dash covers both "no season yet" and "this metric cancelled out"; `direction` tells them apart.
 * Exported so the season report's metric rows carry the same welded ▲+12/▼−6 glyph as the dashboard's —
 * the two surfaces show the same numbers and must not disagree about how they read.
 */
export function formatDelta(delta: number | null): string {
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

function unknownSlot(): NationCommitSlotViewModel {
  return {
    kind: "unknown",
    headline: "同期を待っています",
    detail: null,
    emphasis: false,
    cancelDirectiveId: null,
  };
}

function chancellorSlot(orders: NationOrders): NationCommitSlotViewModel {
  const choice = orders.chancellorChoice;
  const waiting = orders.queued;
  return {
    kind: "chancellor",
    headline:
      choice === null
        ? "宰相は今季なにも選べません"
        : `${directiveKindLabel(choice.kind)}（宰相の既定）`,
    detail:
      waiting === null
        ? null
        : `あなたの発令「${directiveKindLabel(waiting.kind)}」は自動運転を切るまで待機します`,
    emphasis: false,
    cancelDirectiveId: waiting?.id ?? null,
  };
}

/**
 * What commits at the next boundary.
 *
 * The branch order is the *server's*, read off `sim/nation/engine.ts` `selectDirective`: it tests
 * `autoPilot` before it ever looks at the queued list, and the chancellor's branch reports no consumed
 * queued id — so with autopilot on the chancellor decides every season and the player's order is neither
 * read nor discarded. It waits, and commits at the first boundary after autopilot goes off.
 *
 * hud.md §3.2 assumed the opposite ("autopilot fills the gap", so a queued order would win even with
 * autopilot on) and pre-specified this branch for the case the assumption failed. It failed; the table
 * here was measured against a running server, not inferred. If the simulation is later changed to match
 * the spec, this function and its tests are the whole of the client-side change.
 */
function commitSlot(orders: NationOrders | null): NationCommitSlotViewModel {
  if (orders === null) return unknownSlot();
  if (orders.autoPilot) return chancellorSlot(orders);
  const queued = orders.queued;
  if (queued !== null) {
    return {
      kind: "queued",
      headline: `${directiveKindLabel(queued.kind)}（あなたの発令）`,
      detail: null,
      emphasis: false,
      cancelDirectiveId: queued.id,
    };
  }
  return {
    kind: "idle",
    headline: "この季は何も実行されません",
    detail: null,
    emphasis: true,
    cancelDirectiveId: null,
  };
}

/**
 * The always-on dashboard for one nation. Takes `(nation, polity)` because `NationState` has no name
 * and no colour — those live on `Polity`, joined by id, the same join `worldMapView.buildCells` does.
 *
 * `orders` is null for a rival's panel and before the first `orders` message; the commit slot then reads
 * 同期を待っています rather than guessing at a decision the server has not stated.
 */
export function buildNationDashboardViewModel(
  nation: NationState,
  polity: Polity,
  isPlayer: boolean,
  orders: NationOrders | null,
): NationDashboardViewModel {
  return {
    name: polity.name,
    isPlayer,
    metrics: METRIC_ORDER.map((metric) => metricRow(nation, metric)),
    activeDirectives: nation.activeDirectives.map(directiveRow),
    waitingForFirstReport: nation.lastReport === null,
    commitSlot: commitSlot(orders),
  };
}
