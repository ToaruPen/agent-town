import type {
  CulturalValue,
  DirectiveBlockedReason,
  DirectiveKind,
  NationStocks,
  Season,
  SeasonLedgerReason,
  SeasonMetric,
  SpeedMultiplier,
} from "@agent-town/shared";

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

/**
 * Keyed by `SeasonLedgerReason` so a new reason is a compile error here rather than a blank cause on the
 * season report's diff.
 *
 * `directiveUpkeep` has no emitter today (`grep -rn "directiveUpkeep" packages/server/src` returns
 * nothing) — `directiveCost` covers issuance and `directiveEffect` covers completion, and nothing charges
 * a per-season maintenance fee while a directive is active. Spelled out anyway, for the same reason
 * `REQUIRED_TERRAIN` below spells out every `DirectiveKind`: if the simulation starts emitting it, this
 * is where the missing wording surfaces as a compile error rather than as a blank reason on screen.
 */
const LEDGER_REASON_LABELS: Readonly<Record<SeasonLedgerReason, string>> = {
  baseProduction: "基礎生産",
  tradeIncome: "交易収入",
  directiveEffect: "施策の効果",
  directiveCost: "施策の支出",
  directiveUpkeep: "施策の維持",
  populationConsumption: "人口の消費",
  famine: "飢饉",
  growth: "人口成長",
  stabilityDrift: "安定の自然変動",
  cultureAffinity: "国柄との一致",
};

export function ledgerReasonLabel(reason: SeasonLedgerReason): string {
  return LEDGER_REASON_LABELS[reason];
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

/**
 * Moved here from `worldChronicle.ts`, which now imports it back. Both the chronicle's 国柄 card and
 * the directive panel's affinity note name the same eight values, and hud.md §4.3 calls for one table
 * rather than two. It moved rather than being exported in place because a pure view model importing a
 * DOM controller would put `document`-touching code under the node-only view-model tests.
 */
const CULTURAL_VALUE_LABELS: Readonly<Record<CulturalValue, string>> = {
  commerce: "交易",
  faith: "信仰",
  knowledge: "知識",
  kinship: "血縁",
  mutualAid: "相互扶助",
  order: "秩序",
  stewardship: "保全",
  valor: "武勇",
};

export function culturalValueLabel(value: CulturalValue): string {
  return CULTURAL_VALUE_LABELS[value];
}

/**
 * The terrain each directive needs, for `missingTerrain`.
 *
 * Only `developTimber` and `openMine` are gated by terrain server-side
 * (`sim/nation/directives.ts` `hasRequiredTerrain`), so the other four entries are unreachable today.
 * They are spelled out anyway because the record is keyed by `DirectiveKind`: if the simulation gates a
 * third kind, this table is where the missing wording surfaces as a compile error rather than as a
 * blank reason on screen.
 */
const REQUIRED_TERRAIN: Readonly<Record<DirectiveKind, string>> = {
  clearFarmland: "必要な地形",
  developTimber: "森林",
  openMine: "丘陵・山岳",
  growCity: "必要な地形",
  encourageStores: "必要な地形",
  holdFestival: "必要な地形",
};

export interface BlockedReasonContext {
  kind: DirectiveKind;
  cost: NationStocks;
  stocks: NationStocks;
  /** `Polity.taboo`, quoted verbatim rather than paraphrased (§3.4). */
  taboo: string;
}

/**
 * The holding is floored, not rounded, and the shortfall is derived from the floored figure so the
 * three numbers on screen always add up.
 *
 * Rounding is wrong here in a way it is not on the dashboard: with 127.6 wealth against a cost of 128,
 * rounding would print 保有 128 / 必要 128 and a shortfall of zero, telling the player they can afford
 * an option the server has already refused. Costs are integers, so flooring guarantees a shortfall of
 * at least 1 whenever the server blocked the option.
 */
function shortfallText(label: string, cost: number, held: number): string {
  const holding = Math.floor(held);
  return `${label}が ${cost - holding} 足りません（保有 ${holding} / 必要 ${cost}）`;
}

/**
 * Keyed by `DirectiveBlockedReason` so a new reason is a compile error here rather than an option that
 * renders as unsubmittable with no explanation — which is the one outcome §3.4 exists to prevent.
 */
const BLOCKED_REASON_TEXT: Readonly<
  Record<DirectiveBlockedReason, (context: BlockedReasonContext) => string>
> = {
  insufficientFood: ({ cost, stocks }) => shortfallText("食料", cost.food, stocks.food),
  insufficientMaterials: ({ cost, stocks }) =>
    shortfallText("資材", cost.materials, stocks.materials),
  insufficientWealth: ({ cost, stocks }) => shortfallText("富", cost.wealth, stocks.wealth),
  missingTerrain: ({ kind }) => `${REQUIRED_TERRAIN[kind]}を領有していません`,
  cityAtMaxDevelopment: () => "この都市はこれ以上発展できません",
  taboo: ({ taboo }) => `禁忌：「${taboo}」。この国はこれを選べません`,
  alreadyActive: () => "同じ対象で実行中です",
};

export function blockedReasonText(
  reason: DirectiveBlockedReason,
  context: BlockedReasonContext,
): string {
  return BLOCKED_REASON_TEXT[reason](context);
}

/**
 * The refusal banner's wording: the reason without the arithmetic.
 *
 * Deliberately context-free. The `orders` message says *why* an action was refused but not *which*
 * option it was refused for, and the banner has no honest way to recover that — searching the candidate
 * list for a matching `blockedReason` would attach whichever option happened to share the reason and
 * print someone else's numbers. The card for the option the player was reading already carries the full
 * 保有／必要 arithmetic, so the banner only has to name the reason.
 */
const REFUSAL_TEXT: Readonly<
  Record<DirectiveBlockedReason | "notYourNation" | "unknownNation", string>
> = {
  insufficientFood: "食料が足りません",
  insufficientMaterials: "資材が足りません",
  insufficientWealth: "富が足りません",
  missingTerrain: "必要な地形を領有していません",
  cityAtMaxDevelopment: "この都市はこれ以上発展できません",
  taboo: "この国の禁忌に触れます",
  alreadyActive: "同じ対象で実行中です",
  // `notYourNation` is overloaded server-side (`net/wsServer.ts`): it answers both "you hold no nation"
  // and "that option is not in your current candidate list". Only the second is reachable for a
  // well-behaved client, and only for `growCity` against a city the nation no longer holds — every other
  // kind is listed every season, blocked or not. So the wording names the stale target instead of
  // accusing the player of addressing another nation, which would be the wrong reading almost always.
  notYourNation: "その対象はもう一覧にありません",
  unknownNation: "その発令はもうありません。すでに実行または取消済みです",
};

export function refusalText(
  rejected: DirectiveBlockedReason | "notYourNation" | "unknownNation",
): string {
  return `発令できませんでした：${REFUSAL_TEXT[rejected]}`;
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
