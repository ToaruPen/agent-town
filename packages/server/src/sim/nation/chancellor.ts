import {
  type DirectiveKind,
  type DirectiveOption,
  NATION_CHANCELLOR_DEFICIT_BONUS,
  NATION_CHANCELLOR_LOW_STABILITY,
  type NationState,
  type Polity,
  type SeasonMetric,
  type SeasonReport,
} from "@agent-town/shared";

const DIRECTIVE_KIND_ORDER = {
  clearFarmland: 0,
  developTimber: 1,
  openMine: 2,
  growCity: 3,
  encourageStores: 4,
  holdFestival: 5,
} as const satisfies Readonly<Record<DirectiveKind, number>>;

function metricTotal(report: SeasonReport, metric: SeasonMetric): number {
  return report.entries.reduce(
    (total, entry) => total + (entry.metric === metric ? entry.delta : 0),
    0,
  );
}

function hasFoodDeficit(kind: DirectiveKind, report: SeasonReport): boolean {
  if (kind !== "clearFarmland" && kind !== "encourageStores") return false;
  return metricTotal(report, "food") < 0;
}

function hasMaterialDeficit(kind: DirectiveKind, report: SeasonReport): boolean {
  if (kind !== "developTimber" && kind !== "openMine") return false;
  return metricTotal(report, "materials") < 0;
}

function deficitBonus(
  option: DirectiveOption,
  nation: NationState,
  lastReport: SeasonReport | null,
): number {
  if (lastReport === null) return 0;
  if (hasFoodDeficit(option.kind, lastReport)) return NATION_CHANCELLOR_DEFICIT_BONUS;
  if (hasMaterialDeficit(option.kind, lastReport)) return NATION_CHANCELLOR_DEFICIT_BONUS;
  if (option.kind === "holdFestival" && nation.stability < NATION_CHANCELLOR_LOW_STABILITY)
    return NATION_CHANCELLOR_DEFICIT_BONUS;
  return 0;
}

function score(
  option: DirectiveOption,
  nation: NationState,
  lastReport: SeasonReport | null,
): number {
  return option.affinity + deficitBonus(option, nation, lastReport);
}

export function chooseDirective(
  nation: NationState,
  _polity: Polity,
  options: readonly DirectiveOption[],
  lastReport: SeasonReport | null,
): DirectiveOption | null {
  return (
    options
      .filter(({ blockedReason }) => blockedReason === null)
      .toSorted(
        (left, right) =>
          score(right, nation, lastReport) - score(left, nation, lastReport) ||
          DIRECTIVE_KIND_ORDER[left.kind] - DIRECTIVE_KIND_ORDER[right.kind] ||
          (left.targetCityId ?? "").localeCompare(right.targetCityId ?? ""),
      )[0] ?? null
  );
}
