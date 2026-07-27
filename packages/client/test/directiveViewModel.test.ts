import type { NationState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  buildDirectiveListViewModel,
  type DirectiveCardViewModel,
  ordersAnnouncement,
} from "../src/ui/directiveViewModel.js";
import type { NationOrders } from "../src/ui/nationHudState.js";
import { nationFixture, ordersFixture, polityFixture } from "./nationFixture.js";

const CITY_NAMES = new Map([["city-polity-1-1", "ヴェルド"]]);

/** The seed-12345 polity's real value weights, so affinity notes are checked against a real 国柄. */
const polity = () =>
  polityFixture({
    taboo: "森を焼くこと",
    values: [
      { value: "mutualAid", weight: 0.82, changedByEventIds: [] },
      { value: "order", weight: 0.44, changedByEventIds: [] },
      { value: "commerce", weight: 0.31, changedByEventIds: [] },
      { value: "faith", weight: 0.12, changedByEventIds: [] },
    ],
  });

function build(orders: NationOrders = ordersFixture(), nation = nationFixture()) {
  return buildDirectiveListViewModel(orders.options, orders, nation, polity(), CITY_NAMES, 1, true);
}

function cardFor(
  kind: string,
  orders?: NationOrders,
  nation?: NationState,
): DirectiveCardViewModel {
  const card = build(orders, nation).cards.find((candidate) => candidate.kind === kind);
  if (card === undefined) throw new Error(`no card for ${kind}`);
  return card;
}

describe("buildDirectiveListViewModel", () => {
  /**
   * Every `DirectiveKind` arrives every season — `listDirectiveOptions` maps the whole kind list — so the
   * panel is a stable thing to learn. Filtering blocked options would make it a shuffling menu and would
   * drop the explanation with them.
   */
  it("renders every option the server sent, blocked ones included", () => {
    expect(build().cards).toHaveLength(6);
    expect(build().cards.map((card) => card.kind)).toContain("openMine");
  });

  it("marks a blocked option unsubmittable and keeps its reason", () => {
    const card = cardFor("openMine");

    expect(card.canSubmit).toBe(false);
    expect(card.blockedReason).toBe("missingTerrain");
    expect(card.blockedText).toBe("丘陵・山岳を領有していません");
  });

  it("puts the reason in the accessible name, so it is never sight-only", () => {
    expect(cardFor("openMine").accessibleName).toContain("発令不可：丘陵・山岳を領有していません");
  });

  it("leaves an affordable option submittable with no reason to show", () => {
    const card = cardFor("holdFestival");

    expect(card.canSubmit).toBe(true);
    expect(card.blockedReason).toBeNull();
    expect(card.blockedText).toBeNull();
  });

  /**
   * The shortfall arithmetic has to add up on screen: 保有 + 足りません = 必要. The holding is floored
   * rather than rounded, because rounding 127.6 up to 128 against a cost of 128 would print a shortfall
   * of zero for an option the server has already refused.
   */
  it("names the shortfall so the three numbers reconcile", () => {
    const poor = nationFixture({ stocks: { food: 12.9, materials: 590.5, wealth: 1960 } });
    const orders = ordersFixture({
      options: ordersFixture().options.map((option) =>
        option.kind === "holdFestival" ? { ...option, blockedReason: "insufficientFood" } : option,
      ),
    });

    expect(cardFor("holdFestival", orders, poor).blockedText).toBe(
      "食料が 8 足りません（保有 12 / 必要 20）",
    );
  });

  it("quotes the polity's taboo verbatim rather than paraphrasing it", () => {
    const orders = ordersFixture({
      options: ordersFixture().options.map((option) =>
        option.kind === "developTimber" ? { ...option, blockedReason: "taboo" } : option,
      ),
    });

    expect(cardFor("developTimber", orders).blockedText).toBe(
      "禁忌：「森を焼くこと」。この国はこれを選べません",
    );
  });

  it("shows the cost as the raw triplet, with a free line reading zero rather than minus zero", () => {
    expect(cardFor("holdFestival").costLabel).toBe("食料 −20　資材 0　富 −40");
  });

  /** The player's budget is wall clock, not seasons, and it changes with the speed they are running. */
  it("converts the duration to seconds at the current speed", () => {
    const orders = ordersFixture();
    const at1 = build(orders);
    const at8 = buildDirectiveListViewModel(
      orders.options,
      orders,
      nationFixture(),
      polity(),
      CITY_NAMES,
      8,
      true,
    );

    expect(at1.cards.find((card) => card.kind === "clearFarmland")?.durationDetail).toBe(
      "2季 = 約60秒（x1 のとき）",
    );
    expect(at8.cards.find((card) => card.kind === "clearFarmland")?.durationDetail).toBe(
      "2季 = 約7.5秒（x8 のとき）",
    );
  });

  it("does not promise a duration in seconds while the clock is stopped", () => {
    const paused = buildDirectiveListViewModel(
      ordersFixture().options,
      ordersFixture(),
      nationFixture(),
      polity(),
      CITY_NAMES,
      0,
      true,
    );

    expect(paused.cards[0]?.durationDetail).toBe("2季（一時停止中は進みません）");
  });

  /** Rounded for reading, but the meter keeps the unrounded value so it cannot disagree with the label. */
  it("rounds the affinity label without hiding the float behind it", () => {
    const card = cardFor("clearFarmland");

    expect(card.affinityLabel).toBe("国柄適合 +0.42");
    expect(card.affinity).toBe(0.4169999999999999);
    expect(card.affinityRatio).toBeCloseTo(0.7085, 4);
  });

  it("names the values a directive serves instead of only scoring it", () => {
    expect(cardFor("clearFarmland").affinityNote).toBe("相互扶助・秩序に沿う");
  });

  it("reads indifference as indifference rather than as alignment", () => {
    expect(cardFor("developTimber").affinityNote).toBe("国柄との関わりは薄い");
  });

  /** Negative fit is a cost — it spends stability — so it is worded as one, not as a weaker positive. */
  it("draws negative affinity as a cost", () => {
    const orders = ordersFixture({
      options: ordersFixture().options.map((option) =>
        option.kind === "developTimber" ? { ...option, affinity: -0.6 } : option,
      ),
    });
    const card = cardFor("developTimber", orders);

    expect(card.affinityNote).toBe("国柄に反する — 安定が下がります");
    expect(card.affinityLabel).toBe("国柄適合 −0.60");
    expect(card.affinityRatio).toBeCloseTo(0.2, 4);
  });

  it("names the city on a per-city option, since the kind alone would repeat", () => {
    expect(cardFor("growCity").label).toBe("都市拡張（ヴェルド）");
    expect(cardFor("growCity").key).toBe("growCity:city-polity-1-1");
  });

  it("stars the chancellor's pick, matching on the target and not only the kind", () => {
    const starred = build().cards.filter((card) => card.isChancellorChoice);

    expect(starred.map((card) => card.kind)).toEqual(["encourageStores"]);
  });

  it("stars nothing when the chancellor's pick names a city that is not this card's", () => {
    const orders = ordersFixture({
      chancellorChoice: { kind: "growCity", targetCityId: "city-elsewhere" },
    });

    expect(build(orders).cards.some((card) => card.isChancellorChoice)).toBe(false);
  });
});

describe("the autopilot mode text", () => {
  /**
   * The label says which state the nation is in and the description says what that costs, because
   * "自動運転 ON" alone does not tell a player their own order is being held rather than obeyed.
   */
  it("says the chancellor decides every season while autopilot is on", () => {
    const view = build(ordersFixture({ autoPilot: true }));

    expect(view.autoPilot).toBe(true);
    expect(view.autoPilotLabel).toBe("自動運転 ON（宰相が決めます）");
    expect(view.autoPilotDescription).toContain("毎季かならず宰相が決めます");
    expect(view.autoPilotDescription).toContain("自動運転を切った次の決算で実行されます");
  });

  it("says the player's own order runs once autopilot is off", () => {
    const view = build(ordersFixture({ autoPilot: false }));

    expect(view.autoPilot).toBe(false);
    expect(view.autoPilotLabel).toBe("自動運転 OFF（あなたが決めます）");
    expect(view.autoPilotDescription).toContain("発令がない季は何も実行されません");
  });
});

/**
 * After a `welcome`, the client holds a candidate list but no `orders` — the server sends only `welcome`
 * on connect, so the mode, the chancellor's pick and any refusal all belong to a season that may be over.
 * The list stays usable so the desk is not dead at speed 0; everything that is a claim goes quiet.
 */
describe("a candidate list with no orders behind it", () => {
  const listOnly = () =>
    buildDirectiveListViewModel(
      ordersFixture().options,
      null,
      nationFixture(),
      polity(),
      CITY_NAMES,
      1,
      true,
    );

  it("still renders every option, so the desk is not dead until the next season", () => {
    expect(listOnly().cards).toHaveLength(6);
    expect(listOnly().cards.some((card) => card.canSubmit)).toBe(true);
  });

  it("keeps the cost, duration and fit, which are facts about the kind rather than the season", () => {
    const card = listOnly().cards.find((candidate) => candidate.kind === "holdFestival");

    expect(card?.costLabel).toBe("食料 −20　資材 0　富 −40");
    expect(card?.affinityNote).toBe("相互扶助・信仰に沿う");
  });

  it("reports the mode as unknown instead of guessing which way it was left", () => {
    expect(listOnly().autoPilot).toBeNull();
    expect(listOnly().autoPilotLabel).toBe("自動運転 同期中");
    expect(listOnly().autoPilotDescription).toContain("次の応答を受け取るまで分かりません");
  });

  it("stars nothing, because the chancellor's pick was for a season that may be over", () => {
    expect(listOnly().cards.some((card) => card.isChancellorChoice)).toBe(false);
  });

  it("shows no refusal, since any refusal it held answered an action from before the gap", () => {
    expect(listOnly().refusal).toBeNull();
  });

  /** A terrain block is not contradicted by anything on hand, so it is repeated rather than second-guessed. */
  it("keeps a blocked reason the held data does not contradict", () => {
    const card = listOnly().cards.find((candidate) => candidate.kind === "openMine");

    expect(card?.canSubmit).toBe(false);
    expect(card?.blockedText).toBe("丘陵・山岳を領有していません");
  });
});

/**
 * The one blocked reason the client can check instead of repeat. `cost` is a constant per kind and the
 * server's rule is exactly `cost > stocks`, so a shortfall against stocks that cover the cost describes no
 * possible state. It only arises when the list and the nation come from different moments — a reconnect —
 * and printing it would put arithmetic on screen that cannot be true in either direction.
 */
describe("a carried shortfall against fresh stocks", () => {
  const staleShortfall = (reason: "insufficientFood" | "insufficientWealth") =>
    ordersFixture().options.map((option) =>
      option.kind === "holdFestival" ? { ...option, blockedReason: reason } : option,
    );

  const festivalCard = (
    options: ReturnType<typeof staleShortfall>,
    stocks: { food: number; materials: number; wealth: number },
  ) =>
    buildDirectiveListViewModel(
      options,
      null,
      nationFixture({ stocks }),
      polity(),
      CITY_NAMES,
      1,
      true,
    ).cards.find((candidate) => candidate.kind === "holdFestival");

  it("drops a reason the stocks refute rather than printing a negative shortfall", () => {
    const card = festivalCard(staleShortfall("insufficientFood"), {
      food: 200,
      materials: 590.5,
      wealth: 1960,
    });

    expect(card?.blockedReason).toBeNull();
    expect(card?.blockedText).toBeNull();
    expect(card?.canSubmit).toBe(true);
  });

  /** The guard must not fire on a shortfall that is real, or it would offer an option the server refuses. */
  it("keeps a shortfall the stocks confirm, with the three numbers still reconciling", () => {
    const card = festivalCard(staleShortfall("insufficientFood"), {
      food: 12.9,
      materials: 590.5,
      wealth: 1960,
    });

    expect(card?.canSubmit).toBe(false);
    expect(card?.blockedText).toBe("食料が 8 足りません（保有 12 / 必要 20）");
  });

  /** Checked per resource, not by whether the nation is poor overall: only the named stock decides. */
  it("checks the resource the reason names and no other", () => {
    const rich = { food: 200, materials: 590.5, wealth: 10 };

    expect(festivalCard(staleShortfall("insufficientFood"), rich)?.canSubmit).toBe(true);
    expect(festivalCard(staleShortfall("insufficientWealth"), rich)?.blockedText).toBe(
      "富が 30 足りません（保有 10 / 必要 40）",
    );
  });

  /** Exactly affordable is not a shortfall — floored so the boundary matches what the card would print. */
  it("treats a holding that exactly meets the cost as no shortfall", () => {
    const exact = { food: 20, materials: 590.5, wealth: 1960 };

    expect(festivalCard(staleShortfall("insufficientFood"), exact)?.canSubmit).toBe(true);
  });
});

describe("a refusal", () => {
  const queued = { id: "directive-1" as const, kind: "holdFestival" as const, targetCityId: null };

  /**
   * The shape bullet 3 names: `rejected` non-null with `queued` unchanged. Measured on the wire — a
   * refused issue came back with `queued=directive-7` exactly as before, so the desk must show the
   * refusal *and* the surviving order, not one replacing the other.
   */
  it("surfaces the reason without disturbing the queued order", () => {
    const view = build(ordersFixture({ rejected: "insufficientWealth", queued }));

    expect(view.refusal).toBe("発令できませんでした：富が足りません");
  });

  it("says nothing when the server refused nothing", () => {
    expect(build().refusal).toBeNull();
  });

  /**
   * `notYourNation` is overloaded server-side; for a well-behaved client it only ever means the target
   * left the candidate list, which is reachable for `growCity` against a city the nation lost. Wording it
   * as an ownership error would be the wrong reading nearly every time it fires.
   */
  it("reads a stale target as a stale target, not as someone else's nation", () => {
    expect(build(ordersFixture({ rejected: "notYourNation" })).refusal).toBe(
      "発令できませんでした：その対象はもう一覧にありません",
    );
  });

  it("explains a cancel that arrived too late", () => {
    expect(build(ordersFixture({ rejected: "unknownNation" })).refusal).toBe(
      "発令できませんでした：その発令はもうありません。すでに実行または取消済みです",
    );
  });
});

/**
 * The reconnect gap, which is a different thing from the server saying no. `wsClient` discards every send
 * for the second between a drop and the replacement socket, so a control that still offered to submit would
 * be the transport lying where the desk is careful not to.
 */
describe("the send channel", () => {
  const offline = () =>
    buildDirectiveListViewModel(
      ordersFixture().options,
      ordersFixture(),
      nationFixture(),
      polity(),
      CITY_NAMES,
      1,
      false,
    );

  it("says nothing can be sent, and why, without calling it a refusal", () => {
    expect(offline().canSend).toBe(false);
    expect(offline().sendNotice).toBe("接続が切れています。再接続するまで発令できません。");
    expect(offline().refusal).toBeNull();
  });

  it("is silent while the socket is up", () => {
    expect(build().canSend).toBe(true);
    expect(build().sendNotice).toBeNull();
  });

  /**
   * `canSubmit` keeps meaning "the server would accept this option" even while offline. Collapsing the two
   * would make a dropped socket read as the server having refused all six, and would lose the distinction
   * the moment the connection came back.
   */
  it("leaves each option's own availability untouched", () => {
    const cards = offline().cards;

    expect(cards.filter((card) => card.canSubmit)).toHaveLength(5);
    expect(cards.find((card) => card.kind === "openMine")?.blockedText).toBe(
      "丘陵・山岳を領有していません",
    );
  });
});

describe("ordersAnnouncement", () => {
  const queued = { id: "directive-1" as const, kind: "holdFestival" as const, targetCityId: null };

  it("leads with the refusal, because at speed 0 nothing else has changed", () => {
    const before = ordersFixture({ autoPilot: false, queued });
    const after = ordersFixture({ autoPilot: false, queued, rejected: "insufficientFood" });

    expect(ordersAnnouncement(before, after, [])).toBe("発令できませんでした：食料が足りません");
  });

  it("says nothing about the first desk to arrive", () => {
    expect(ordersAnnouncement(null, ordersFixture(), [])).toBeNull();
  });

  it("says nothing at a boundary that changed neither the mode nor the order", () => {
    const before = ordersFixture({ tick: 254_927 });
    const after = ordersFixture({ tick: 255_227 });

    expect(ordersAnnouncement(before, after, [])).toBeNull();
  });

  it("announces an accepted order by name", () => {
    const before = ordersFixture({ queued: null });
    const after = ordersFixture({ queued });

    expect(ordersAnnouncement(before, after, [])).toBe("「祭礼」を発令しました。");
  });

  it("announces a replacement, since a second order silently displaces the first", () => {
    const before = ordersFixture({ queued });
    const after = ordersFixture({
      queued: { id: "directive-2", kind: "clearFarmland", targetCityId: null },
    });

    expect(ordersAnnouncement(before, after, [])).toBe("「開墾」を発令しました。");
  });

  /**
   * A queued order that disappears is either a commit or a cancellation, and calling one the other would
   * be a lie in both directions. The active-directive list tells them apart.
   */
  it("calls a queued order that became active a start, not a cancellation", () => {
    const before = ordersFixture({ queued });
    const after = ordersFixture({ queued: null });

    expect(ordersAnnouncement(before, after, ["directive-1"])).toBe("「祭礼」を開始しました。");
  });

  it("calls a queued order that vanished without starting a cancellation", () => {
    const before = ordersFixture({ queued });
    const after = ordersFixture({ queued: null });

    expect(ordersAnnouncement(before, after, [])).toBe("「祭礼」の発令を取り消しました。");
  });

  it("announces the mode flip, and says what the new mode does", () => {
    const on = ordersFixture({ autoPilot: true });
    const off = ordersFixture({ autoPilot: false });

    expect(ordersAnnouncement(off, on, [])).toBe(
      "自動運転を入れました。これから毎季、宰相が決めます。",
    );
    expect(ordersAnnouncement(on, off, [])).toBe(
      "自動運転を切りました。あなたの発令が実行されます。",
    );
  });
});
