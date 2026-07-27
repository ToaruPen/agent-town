import {
  type DirectiveId,
  nationSeasonOfTick,
  nationYearOfTick,
  type SeasonLedgerEntry,
  type SeasonLedgerReason,
  type SeasonMetric,
  type SeasonReport,
} from "@agent-town/shared";

import {
  deltaDirection,
  formatDelta,
  groupThousands,
  METRIC_ORDER,
  type MetricDirection,
} from "./nationDashboardViewModel.js";
import type { DirectiveLogEntry, NationOrders } from "./nationHudState.js";
import {
  directiveKindLabel,
  ledgerReasonLabel,
  metricLabel,
  nationSeasonLabel,
} from "./nationText.js";

export interface SeasonReportReasonLine {
  reason: SeasonLedgerReason;
  label: string;
  delta: number;
  /** Sign-only, no glyph — hud.md §4.5's mockup shows reasons as "基礎生産 +40 · 人口の消費 −24". */
  deltaLabel: string;
}

export interface SeasonReportMetricRow {
  metric: SeasonMetric;
  label: string;
  delta: number;
  /** The dashboard's welded ▲+12/▼−6/― glyph, so the two surfaces read the same diff the same way. */
  deltaLabel: string;
  direction: MetricDirection;
  /** Sorted by |delta| descending; present even when its own contributions sum to zero. */
  reasons: SeasonReportReasonLine[];
}

export type CompletedDirectiveAttribution = "player" | "chancellor" | "unknown";

export interface SeasonReportCompletedDirectiveRow {
  directiveId: DirectiveId;
  /** "施策" when the kind was never observed — see the `unknown` branch of `attribution`. */
  kindLabel: string;
  attribution: CompletedDirectiveAttribution;
  attributionLabel: string;
  /** Null exactly when `attribution` is `unknown`: there is no issue tick to date it from. */
  issuedLabel: string | null;
}

export interface SeasonReportViewModel {
  /** True only before `nation.lastReport` has ever been non-null. Distinct from `isEmpty`. */
  waitingForFirstReport: boolean;
  /** A report has resolved and it has nothing in it — still six full rows, never a blank panel. */
  isEmpty: boolean;
  isFamine: boolean;
  headerLabel: string | null;
  /** Always non-empty: waiting, empty, famine and ordinary seasons each get their own sentence. */
  headline: string;
  metrics: SeasonReportMetricRow[];
  completedDirectives: SeasonReportCompletedDirectiveRow[];
  /** Non-null only when autopilot is on and an order is queued — held, not discarded, not obeyed. */
  heldOrderNote: string | null;
}

/** Tie-break for equal-magnitude reasons/entries, so the sort is deterministic rather than input-order. */
const REASON_ORDER: readonly SeasonLedgerReason[] = [
  "baseProduction",
  "tradeIncome",
  "directiveEffect",
  "directiveCost",
  "directiveUpkeep",
  "populationConsumption",
  "famine",
  "growth",
  "stabilityDrift",
  "cultureAffinity",
];

function reasonDeltaLabel(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return "±0";
  const magnitude = groupThousands(rounded);
  return rounded > 0 ? `+${magnitude}` : `−${magnitude}`;
}

/**
 * Grouped by reason and summed, independently of the metric row's own total below — so a test that
 * compares the two is checking that entries were bucketed correctly, not just that addition works.
 */
function reasonLines(
  entries: readonly SeasonLedgerEntry[],
  metric: SeasonMetric,
): SeasonReportReasonLine[] {
  const byReason = new Map<SeasonLedgerReason, number>();
  for (const entry of entries) {
    if (entry.metric !== metric) continue;
    byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + entry.delta);
  }
  return [...byReason.entries()]
    .map(([reason, delta]) => ({
      reason,
      label: ledgerReasonLabel(reason),
      delta,
      deltaLabel: reasonDeltaLabel(delta),
    }))
    .sort((a, b) => {
      const magnitude = Math.abs(b.delta) - Math.abs(a.delta);
      return magnitude !== 0
        ? magnitude
        : REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason);
    });
}

function metricRow(
  entries: readonly SeasonLedgerEntry[],
  metric: SeasonMetric,
): SeasonReportMetricRow {
  const delta = entries
    .filter((entry) => entry.metric === metric)
    .reduce((sum, entry) => sum + entry.delta, 0);
  return {
    metric,
    label: metricLabel(metric),
    delta,
    deltaLabel: formatDelta(delta),
    direction: deltaDirection(delta),
    reasons: reasonLines(entries, metric),
  };
}

/**
 * Famine's one privilege (hud.md §4.5): it names itself in the headline regardless of magnitude. Without
 * this, the season's largest raw entry is almost always `populationConsumption` on food — thousands
 * against a famine loss in the hundreds — and the report would read as exactly the unexplained population
 * drop the plan's test exists to rule out.
 */
function famineHeadline(entries: readonly SeasonLedgerEntry[]): string {
  const famineEntries = entries.filter((entry) => entry.reason === "famine");
  const clauses = METRIC_ORDER.map((metric) =>
    famineEntries.find((entry) => entry.metric === metric),
  )
    .filter((entry): entry is SeasonLedgerEntry => entry !== undefined)
    .map(
      (entry) =>
        `${metricLabel(entry.metric)}が${groupThousands(Math.abs(Math.round(entry.delta)))}減少`,
    );
  if (clauses.length === 0) return "飢饉が発生しました。";
  return `飢饉が発生し、${clauses.join("、")}しました。`;
}

function compareByMagnitude(a: SeasonLedgerEntry, b: SeasonLedgerEntry): number {
  const magnitude = Math.abs(b.delta) - Math.abs(a.delta);
  if (magnitude !== 0) return magnitude;
  const metricOrder = METRIC_ORDER.indexOf(a.metric) - METRIC_ORDER.indexOf(b.metric);
  return metricOrder !== 0
    ? metricOrder
    : REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason);
}

function largestBySign(
  entries: readonly SeasonLedgerEntry[],
  sign: "positive" | "negative",
): SeasonLedgerEntry | null {
  const filtered = entries.filter((entry) =>
    sign === "positive" ? entry.delta > 0 : entry.delta < 0,
  );
  if (filtered.length === 0) return null;
  return [...filtered].sort(compareByMagnitude)[0] ?? null;
}

function headlineClause(entry: SeasonLedgerEntry): string {
  const magnitude = groupThousands(Math.abs(Math.round(entry.delta)));
  const verb = entry.delta >= 0 ? "増やした" : "削った";
  return `${ledgerReasonLabel(entry.reason)}が${metricLabel(entry.metric)}を${magnitude}${verb}`;
}

/** Templated, not generated — hud.md §4.5: at most two reasons, the largest gain and the largest loss. */
function ordinaryHeadline(entries: readonly SeasonLedgerEntry[]): string {
  const positive = largestBySign(entries, "positive");
  const negative = largestBySign(entries, "negative");
  if (positive === null && negative === null) return "この季は目立った変化がありませんでした。";
  if (negative === null) return `${headlineClause(positive as SeasonLedgerEntry)}季でした。`;
  if (positive === null) return `${headlineClause(negative)}季でした。`;
  return `${headlineClause(negative)}一方、${headlineClause(positive)}季でした。`;
}

function headlineFor(report: SeasonReport | null, isFamine: boolean): string {
  if (report === null) return "最初の決算を待っています。";
  if (isFamine) return famineHeadline(report.entries);
  return ordinaryHeadline(report.entries);
}

const ATTRIBUTION_LABELS: Readonly<Record<CompletedDirectiveAttribution, string>> = {
  player: "あなたの発令",
  chancellor: "宰相の決定",
  unknown: "発令者不明",
};

function attributionFor(
  id: DirectiveId,
  log: ReadonlyMap<DirectiveId, DirectiveLogEntry>,
  ownIds: ReadonlySet<DirectiveId>,
): CompletedDirectiveAttribution {
  if (ownIds.has(id)) return "player";
  return log.has(id) ? "chancellor" : "unknown";
}

/**
 * A completed directive whose kind was never observed is not a bug to guard against — it is the
 * guaranteed path for a chancellor-picked `holdFestival` (the one one-season `DirectiveKind`), which
 * completes in the same boundary it is selected, before `activeDirectives` ever carries it. This still
 * has to render something rather than throw.
 */
function completedDirectiveRow(
  id: DirectiveId,
  log: ReadonlyMap<DirectiveId, DirectiveLogEntry>,
  ownIds: ReadonlySet<DirectiveId>,
): SeasonReportCompletedDirectiveRow {
  const record = log.get(id);
  const attribution = attributionFor(id, log, ownIds);
  return {
    directiveId: id,
    kindLabel: record === undefined ? "施策" : directiveKindLabel(record.kind),
    attribution,
    attributionLabel: ATTRIBUTION_LABELS[attribution],
    issuedLabel:
      record === undefined
        ? null
        : `第${nationYearOfTick(record.issuedAtTick)}年 ${nationSeasonLabel(nationSeasonOfTick(record.issuedAtTick))} 発令`,
  };
}

/**
 * The truth table `sim/nation/engine.ts:104` selectDirective actually implements: with autopilot on, the
 * chancellor's choice commits and a queued order is neither obeyed nor discarded — it waits at the front
 * of the queue for the first boundary after autopilot goes off. A season in which this happened must not
 * read as a season where nothing happened, or a brand-new player (`sim/nation/bootstrap.ts` starts every
 * nation with `autoPilot: true`) reads their first command as meaningless in the exact state they start
 * in. No cross-check against `completedDirectiveIds` is needed: the engine never consumes a queued id
 * while autopilot is on, so the two conditions below are sufficient on their own.
 */
function heldOrderNote(orders: NationOrders | null): string | null {
  if (orders === null || !orders.autoPilot || orders.queued === null) return null;
  return `あなたの発令「${directiveKindLabel(orders.queued.kind)}」は自動運転により、この決算では実行されず待機しています。`;
}

/**
 * The season report: a diff with reasons, not a table of numbers (hud.md §4.5).
 *
 * Deviates from hud.md §4.3's original sketch of `(report, polity, ownDirectiveIds)` in two ways: `polity`
 * is dropped (nothing here needs the nation's name or colour), and `directiveLog`/`orders` are added —
 * `directiveLog` because attributing and dating a completed directive needs more than an id set, and
 * `orders` because the held-order note (above) cannot be built from the report alone. Reported to the
 * supervisor as a deliberate, justified departure rather than chosen silently.
 */
export function buildSeasonReportViewModel(
  report: SeasonReport | null,
  directiveLog: ReadonlyMap<DirectiveId, DirectiveLogEntry>,
  ownDirectiveIds: ReadonlySet<DirectiveId>,
  orders: NationOrders | null,
): SeasonReportViewModel {
  const isFamine = report !== null && report.entries.some((entry) => entry.reason === "famine");
  return {
    waitingForFirstReport: report === null,
    isEmpty: report !== null && report.entries.length === 0,
    isFamine,
    headerLabel: report === null ? null : `第${report.year}年 ${nationSeasonLabel(report.season)}`,
    headline: headlineFor(report, isFamine),
    metrics: report === null ? [] : METRIC_ORDER.map((metric) => metricRow(report.entries, metric)),
    completedDirectives:
      report === null
        ? []
        : report.completedDirectiveIds.map((id) =>
            completedDirectiveRow(id, directiveLog, ownDirectiveIds),
          ),
    heldOrderNote: heldOrderNote(orders),
  };
}
