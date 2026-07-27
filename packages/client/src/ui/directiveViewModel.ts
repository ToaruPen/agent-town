import {
  type CulturalValue,
  type DirectiveBlockedReason,
  type DirectiveKind,
  type DirectiveOption,
  NATION_DIRECTIVE_CULTURAL_AFFINITIES,
  NATION_TICKS_PER_SEASON,
  type NationState,
  type NationStocks,
  type Polity,
  type SpeedMultiplier,
  TICK_RATE,
} from "@agent-town/shared";

import type { NationOrders } from "./nationHudState.js";
import {
  blockedReasonText,
  culturalValueLabel,
  directiveKindLabel,
  refusalText,
} from "./nationText.js";

export interface DirectiveCardViewModel {
  /**
   * `kind:targetCityId`. Stable across renders because the server sends every kind every season, which
   * is what lets the panel preserve focus instead of rebuilding a shuffling menu.
   */
  key: string;
  kind: DirectiveKind;
  targetCityId: string | null;
  label: string;
  /** The raw triplet, not a tint: 食料 −20  資材 −30  富 −10. */
  costLabel: string;
  durationLabel: string;
  /** The same duration in wall clock, because the player's real budget is seconds, not seasons. */
  durationDetail: string;
  affinity: number;
  /** The −1..1 affinity mapped onto 0..1 for a `<progress>`; 0.5 is indifference, not emptiness. */
  affinityRatio: number;
  affinityLabel: string;
  /** Which of the nation's values this serves, or that it works against them. */
  affinityNote: string;
  isChancellorChoice: boolean;
  /** False for every blocked option. The panel keeps them focusable and explains them instead. */
  canSubmit: boolean;
  blockedReason: DirectiveBlockedReason | null;
  blockedText: string | null;
  /** Name, cost, duration, fit and — when blocked — the reason, so the reason is never sight-only. */
  accessibleName: string;
}

export interface DirectiveListViewModel {
  cards: DirectiveCardViewModel[];
  /** Null between a `welcome` and the next `orders`: the mode is a server fact and no echo has arrived. */
  autoPilot: boolean | null;
  autoPilotLabel: string;
  /** Spells out what the mode actually does, which is not what its name suggests. */
  autoPilotDescription: string;
  /** The server's refusal of the last action, or null. Never synthesised locally. */
  refusal: string | null;
}

const COST_FIELDS: readonly (readonly [keyof NationStocks, string])[] = [
  ["food", "食料"],
  ["materials", "資材"],
  ["wealth", "富"],
];

function costLabel(cost: NationStocks): string {
  return COST_FIELDS.map(([field, label]) => {
    const amount = cost[field];
    return `${label} ${amount === 0 ? "0" : `−${amount}`}`;
  }).join("　");
}

/** Trailing `.0` dropped, so 60秒 does not read as 60.0秒 while 7.5秒 keeps its half. */
function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function durationDetail(seasons: number, speed: SpeedMultiplier): string {
  if (speed === 0) return `${seasons}季（一時停止中は進みません）`;
  const seconds = (seasons * NATION_TICKS_PER_SEASON) / (TICK_RATE * speed);
  return `${seasons}季 = 約${formatSeconds(seconds)}秒（x${speed} のとき）`;
}

function signGlyph(value: number): string {
  if (value > 0) return "+";
  if (value < 0) return "−";
  return "±";
}

function affinityLabel(affinity: number): string {
  const rounded = Math.round(affinity * 100) / 100;
  return `国柄適合 ${signGlyph(rounded)}${Math.abs(rounded).toFixed(2)}`;
}

/**
 * The nation's strongest values that this directive actually rewards, named rather than scored.
 *
 * Ordering follows `worldChronicle.strongestValues`: weight descending, then the value's own name, so a
 * tie renders the same way twice. Only positive coefficients count — listing a value the directive
 * *penalises* as something it "follows" would invert the lesson the panel exists to teach.
 */
function drivingValues(kind: DirectiveKind, polity: Polity): string[] {
  const coefficients: Readonly<Record<CulturalValue, number>> =
    NATION_DIRECTIVE_CULTURAL_AFFINITIES[kind];
  return polity.values
    .filter(({ value }) => coefficients[value] > 0)
    .toSorted((left, right) => right.weight - left.weight || left.value.localeCompare(right.value))
    .slice(0, 2)
    .map(({ value }) => culturalValueLabel(value));
}

/** Negative fit is drawn as a cost, because that is what it is: the season spends stability. */
function affinityNote(affinity: number, kind: DirectiveKind, polity: Polity): string {
  if (affinity < 0) return "国柄に反する — 安定が下がります";
  const values = drivingValues(kind, polity);
  if (values.length === 0 || affinity === 0) return "国柄との関わりは薄い";
  return `${values.join("・")}に沿う`;
}

function optionLabel(option: DirectiveOption, cityNames: ReadonlyMap<string, string>): string {
  const base = directiveKindLabel(option.kind);
  if (option.targetCityId === null) return base;
  return `${base}（${cityNames.get(option.targetCityId) ?? option.targetCityId}）`;
}

function isChancellorChoice(option: DirectiveOption, orders: NationOrders | null): boolean {
  const choice = orders?.chancellorChoice ?? null;
  if (choice === null) return false;
  return choice.kind === option.kind && choice.targetCityId === option.targetCityId;
}

function accessibleName(card: Omit<DirectiveCardViewModel, "accessibleName">): string {
  const parts = [
    card.label,
    card.costLabel,
    card.durationDetail,
    card.affinityLabel,
    card.affinityNote,
  ];
  if (card.isChancellorChoice) parts.push("宰相の推奨");
  if (card.blockedText !== null) parts.push(`発令不可：${card.blockedText}`);
  return parts.join("、");
}

function buildCard(
  option: DirectiveOption,
  orders: NationOrders | null,
  nation: NationState,
  polity: Polity,
  cityNames: ReadonlyMap<string, string>,
  speed: SpeedMultiplier,
): DirectiveCardViewModel {
  const blockedText =
    option.blockedReason === null
      ? null
      : blockedReasonText(option.blockedReason, {
          kind: option.kind,
          cost: option.cost,
          stocks: nation.stocks,
          taboo: polity.taboo,
        });
  const card = {
    key: `${option.kind}:${option.targetCityId ?? ""}`,
    kind: option.kind,
    targetCityId: option.targetCityId,
    label: optionLabel(option, cityNames),
    costLabel: costLabel(option.cost),
    durationLabel: `所要 ${option.seasons}季`,
    durationDetail: durationDetail(option.seasons, speed),
    affinity: option.affinity,
    affinityRatio: (option.affinity + 1) / 2,
    affinityLabel: affinityLabel(option.affinity),
    affinityNote: affinityNote(option.affinity, option.kind, polity),
    isChancellorChoice: isChancellorChoice(option, orders),
    canSubmit: option.blockedReason === null,
    blockedReason: option.blockedReason,
    blockedText,
  };
  return { ...card, accessibleName: accessibleName(card) };
}

const AUTOPILOT_ON_DESCRIPTION =
  "自動運転が入っている間は、毎季かならず宰相が決めます。あなたの発令は取り消されず、自動運転を切った次の決算で実行されます。";
const AUTOPILOT_OFF_DESCRIPTION =
  "あなたの発令がそのまま実行されます。発令がない季は何も実行されません。";
const AUTOPILOT_UNKNOWN_DESCRIPTION =
  "どちらの運転になっているかは、次の応答を受け取るまで分かりません。発令はいま送れます。";

function autoPilotLabel(autoPilot: boolean | null): string {
  if (autoPilot === null) return "自動運転 同期中";
  return autoPilot ? "自動運転 ON（宰相が決めます）" : "自動運転 OFF（あなたが決めます）";
}

function autoPilotDescription(autoPilot: boolean | null): string {
  if (autoPilot === null) return AUTOPILOT_UNKNOWN_DESCRIPTION;
  return autoPilot ? AUTOPILOT_ON_DESCRIPTION : AUTOPILOT_OFF_DESCRIPTION;
}

/**
 * What the `#world-status` live region says about a new `orders`, or null when it says nothing.
 *
 * Announcing every message would make the region unusable — one arrives at every season boundary. Only
 * the four things a player cannot see from the panel are announced, and the refusal comes first because
 * at speed 0 it is the *only* thing that changed.
 *
 * A queued order that disappears is a commit or a cancellation, and the two must not be confused. They
 * are told apart by whether the id turned up in the nation's active directives, which is knowable here
 * because the server broadcasts `season` before the per-session `orders` (`net/wsServer.ts`), so the
 * directive list is already the post-boundary one.
 */
export function ordersAnnouncement(
  previous: NationOrders | null,
  next: NationOrders,
  activeDirectiveIds: readonly string[],
): string | null {
  if (next.rejected !== null) return refusalText(next.rejected);
  if (previous === null) return null;
  if (previous.autoPilot !== next.autoPilot) {
    return next.autoPilot
      ? "自動運転を入れました。これから毎季、宰相が決めます。"
      : "自動運転を切りました。あなたの発令が実行されます。";
  }
  const before = previous.queued;
  const after = next.queued;
  if (after !== null && before?.id !== after.id) {
    return `「${directiveKindLabel(after.kind)}」を発令しました。`;
  }
  if (before === null || after !== null) return null;
  const started = activeDirectiveIds.includes(before.id);
  const label = directiveKindLabel(before.kind);
  return started ? `「${label}」を開始しました。` : `「${label}」の発令を取り消しました。`;
}

/**
 * The candidate list plus the mode it is issued into — passed separately because they have different
 * lifetimes. `options` outlives a reconnect; `orders` does not (see `nationHudState.applyWelcome`), and
 * with `orders` null the list still renders and is still submittable while the mode, the chancellor's
 * star and any refusal all read as unknown rather than as stale facts.
 *
 * The list is rendered whole: every `DirectiveKind` arrives every season, blocked ones carrying their
 * reason, so it is a stable thing to learn rather than a menu that reshuffles as stocks move. Nothing is
 * filtered here — hiding a blocked option would hide precisely the explanation the panel is for.
 */
export function buildDirectiveListViewModel(
  options: readonly DirectiveOption[],
  orders: NationOrders | null,
  nation: NationState,
  polity: Polity,
  cityNames: ReadonlyMap<string, string>,
  speed: SpeedMultiplier,
): DirectiveListViewModel {
  const autoPilot = orders?.autoPilot ?? null;
  const rejected = orders?.rejected ?? null;
  return {
    cards: options.map((option) => buildCard(option, orders, nation, polity, cityNames, speed)),
    autoPilot,
    autoPilotLabel: autoPilotLabel(autoPilot),
    autoPilotDescription: autoPilotDescription(autoPilot),
    refusal: rejected === null ? null : refusalText(rejected),
  };
}
