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
  return buildDirectiveListViewModel(orders, nation, polity(), CITY_NAMES, 1);
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
    const at1 = buildDirectiveListViewModel(orders, nationFixture(), polity(), CITY_NAMES, 1);
    const at8 = buildDirectiveListViewModel(orders, nationFixture(), polity(), CITY_NAMES, 8);

    expect(at1.cards.find((card) => card.kind === "clearFarmland")?.durationDetail).toBe(
      "2季 = 約60秒（x1 のとき）",
    );
    expect(at8.cards.find((card) => card.kind === "clearFarmland")?.durationDetail).toBe(
      "2季 = 約7.5秒（x8 のとき）",
    );
  });

  it("does not promise a duration in seconds while the clock is stopped", () => {
    const paused = buildDirectiveListViewModel(
      ordersFixture(),
      nationFixture(),
      polity(),
      CITY_NAMES,
      0,
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
