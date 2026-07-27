import { describe, expect, it } from "vitest";

import { buildNationDashboardViewModel } from "../src/ui/nationDashboardViewModel.js";
import type { NationOrders } from "../src/ui/nationHudState.js";
import {
  ledgerEntry,
  nationFixture,
  ordersFixture,
  polityFixture,
  reportFixture,
} from "./nationFixture.js";

function rowFor(metric: string, nation = nationFixture()) {
  const view = buildNationDashboardViewModel(nation, polityFixture(), true, null);
  const row = view.metrics.find((candidate) => candidate.metric === metric);
  if (row === undefined) throw new Error(`no row for ${metric}`);
  return row;
}

describe("buildNationDashboardViewModel", () => {
  it("names the nation from the polity, since NationState carries no name", () => {
    const view = buildNationDashboardViewModel(nationFixture(), polityFixture(), true, null);

    expect(view.name).toBe("ヴェルディン侯国");
  });

  it("marks the player's own nation so the dashboard can say 自国", () => {
    expect(
      buildNationDashboardViewModel(nationFixture(), polityFixture(), true, null).isPlayer,
    ).toBe(true);
    expect(
      buildNationDashboardViewModel(nationFixture(), polityFixture(), false, null).isPlayer,
    ).toBe(false);
  });

  /**
   * The live server sends stocks as floats — `1949.8451999999997` was measured on the wire. The
   * dashboard rounds to whole units at the display edge and nowhere else, so the number the player
   * reads is stable while the value it came from stays exact for the next season's arithmetic.
   */
  it("rounds a fractional stock to whole units for display", () => {
    expect(rowFor("food").valueLabel).toBe("1,950");
  });

  it("groups thousands so a five-figure population stays readable", () => {
    expect(rowFor("population").valueLabel).toBe("10,507");
  });

  it("rounds a fractional rate the same way", () => {
    expect(rowFor("stability").valueLabel).toBe("67");
  });

  it("keeps a half-unit stock from reading as if it were exact", () => {
    expect(rowFor("materials").valueLabel).toBe("591");
  });

  it("lists the six metrics in the order the design fixes, so rows never reshuffle", () => {
    const view = buildNationDashboardViewModel(nationFixture(), polityFixture(), true, null);

    expect(view.metrics.map(({ metric }) => metric)).toEqual([
      "food",
      "materials",
      "wealth",
      "population",
      "stability",
      "culture",
    ]);
  });

  /**
   * `lastReport` is null on `welcome`, so the first season has no diff to show. `▲±0` would claim a
   * season resolved when none has, which is why the correct first-run state is a dash.
   */
  it("reads every delta as a dash while no season has resolved", () => {
    const view = buildNationDashboardViewModel(nationFixture(), polityFixture(), true, null);

    expect(view.waitingForFirstReport).toBe(true);
    expect(view.metrics.map(({ deltaLabel }) => deltaLabel)).toEqual([
      "―",
      "―",
      "―",
      "―",
      "―",
      "―",
    ]);
    expect(view.metrics.every(({ delta }) => delta === null)).toBe(true);
  });

  it("sums the ledger entries of one metric into that metric's delta", () => {
    const nation = nationFixture({
      lastReport: reportFixture({
        entries: [
          ledgerEntry({ metric: "food", delta: 120, reason: "baseProduction" }),
          ledgerEntry({ metric: "food", delta: -96, reason: "populationConsumption" }),
          ledgerEntry({ metric: "population", delta: 18, reason: "growth" }),
        ],
      }),
    });

    expect(rowFor("food", nation).delta).toBe(24);
    expect(rowFor("food", nation).deltaLabel).toBe("▲+24");
    expect(rowFor("population", nation).deltaLabel).toBe("▲+18");
  });

  it("marks a fall with a down glyph and a real minus sign", () => {
    const nation = nationFixture({
      lastReport: reportFixture({
        entries: [ledgerEntry({ metric: "materials", delta: -6, reason: "directiveCost" })],
      }),
    });

    expect(rowFor("materials", nation).deltaLabel).toBe("▼−6");
    expect(rowFor("materials", nation).direction).toBe("down");
  });

  /**
   * Both read `―`, so `direction` is what tells them apart: a metric whose reasons cancelled out did
   * resolve, and only a missing report is unknown. A metric absent from a report that exists resolved
   * too — the season happened and that metric did not move.
   */
  it("distinguishes a metric that cancelled out from one with no report at all", () => {
    const resolved = nationFixture({
      lastReport: reportFixture({
        entries: [
          ledgerEntry({ metric: "wealth", delta: 40, reason: "tradeIncome" }),
          ledgerEntry({ metric: "wealth", delta: -40, reason: "directiveUpkeep" }),
        ],
      }),
    });

    expect(rowFor("wealth", resolved).delta).toBe(0);
    expect(rowFor("wealth", resolved).direction).toBe("flat");
    expect(rowFor("wealth", resolved).deltaLabel).toBe("―");
    expect(rowFor("food", resolved).direction).toBe("flat");
    expect(rowFor("food", nationFixture()).direction).toBe("unknown");
  });

  it("rounds a fractional delta rather than showing the float", () => {
    const nation = nationFixture({
      lastReport: reportFixture({
        entries: [ledgerEntry({ metric: "food", delta: 23.6, reason: "baseProduction" })],
      }),
    });

    expect(rowFor("food", nation).deltaLabel).toBe("▲+24");
  });

  it("turns an active directive's remaining seasons into pips and a label", () => {
    const nation = nationFixture({
      activeDirectives: [
        {
          id: "d-1",
          kind: "clearFarmland",
          targetCityId: null,
          issuedAtTick: 0,
          seasonsRemaining: 2,
          totalSeasons: 3,
        },
      ],
    });
    const view = buildNationDashboardViewModel(nation, polityFixture(), true, null);

    expect(view.activeDirectives).toEqual([
      {
        id: "d-1",
        label: "開墾",
        pipsFilled: 1,
        pipsTotal: 3,
        seasonsRemaining: 2,
        progressLabel: "●○○ 残2季",
      },
    ]);
  });

  it("fills every pip on the directive's final season", () => {
    const nation = nationFixture({
      activeDirectives: [
        {
          id: "d-2",
          kind: "holdFestival",
          targetCityId: null,
          issuedAtTick: 0,
          seasonsRemaining: 0,
          totalSeasons: 2,
        },
      ],
    });
    const view = buildNationDashboardViewModel(nation, polityFixture(), true, null);

    expect(view.activeDirectives[0]?.progressLabel).toBe("●● 残0季");
  });

  it("has no directive rows when the nation is doing nothing", () => {
    expect(
      buildNationDashboardViewModel(nationFixture(), polityFixture(), true, null).activeDirectives,
    ).toEqual([]);
  });
});

/**
 * The four states of 次の決算, pinned against the server's real rule rather than the design's.
 *
 * hud.md §3.2 tabulated three states on the assumption that autopilot "fills the gap", so a queued order
 * would commit even with autopilot on. It does not: `sim/nation/engine.ts` `selectDirective` tests
 * `autoPilot` first and the chancellor's branch consumes no queued id. Measured against a live server at
 * x8: a queued order sat through three boundaries with autopilot on, then committed at the first boundary
 * after it went off. §3.2 anticipated this outcome and asked for the order to read as overridden.
 */
describe("the commit slot", () => {
  const slotFor = (orders: NationOrders | null) =>
    buildNationDashboardViewModel(nationFixture(), polityFixture(), true, orders).commitSlot;

  const queued = { id: "directive-1" as const, kind: "holdFestival" as const, targetCityId: null };

  it("says the chancellor commits whenever autopilot is on", () => {
    const slot = slotFor(ordersFixture({ autoPilot: true, queued: null }));

    expect(slot.kind).toBe("chancellor");
    expect(slot.headline).toBe("備蓄奨励（宰相の既定）");
    expect(slot.detail).toBeNull();
  });

  /** The state the design's table had no room for, and the one a fresh player is dropped into. */
  it("still says the chancellor commits when autopilot is on and an order is queued", () => {
    const slot = slotFor(ordersFixture({ autoPilot: true, queued }));

    expect(slot.kind).toBe("chancellor");
    expect(slot.headline).toBe("備蓄奨励（宰相の既定）");
    expect(slot.detail).toBe("あなたの発令「祭礼」は自動運転を切るまで待機します");
  });

  it("says the player's order commits once autopilot is off", () => {
    const slot = slotFor(ordersFixture({ autoPilot: false, queued }));

    expect(slot.kind).toBe("queued");
    expect(slot.headline).toBe("祭礼（あなたの発令）");
    expect(slot.detail).toBeNull();
  });

  /** The warning state: it has to be visible before the boundary, not discovered in the report after. */
  it("warns that nothing commits with autopilot off and no order", () => {
    const slot = slotFor(ordersFixture({ autoPilot: false, queued: null }));

    expect(slot.kind).toBe("idle");
    expect(slot.headline).toBe("この季は何も実行されません");
    expect(slot.emphasis).toBe(true);
  });

  it("offers to cancel a queued order in both modes, because the server accepts it in both", () => {
    expect(slotFor(ordersFixture({ autoPilot: true, queued })).cancelDirectiveId).toBe(
      "directive-1",
    );
    expect(slotFor(ordersFixture({ autoPilot: false, queued })).cancelDirectiveId).toBe(
      "directive-1",
    );
  });

  it("has nothing to cancel when no order is queued", () => {
    expect(slotFor(ordersFixture({ queued: null })).cancelDirectiveId).toBeNull();
  });

  /** A rival's dashboard, and the gap before the first `orders`: no decision to report, so none claimed. */
  it("reports a pending sync rather than a decision when no orders have arrived", () => {
    const slot = slotFor(null);

    expect(slot.kind).toBe("unknown");
    expect(slot.headline).toBe("同期を待っています");
    expect(slot.emphasis).toBe(false);
  });

  /**
   * `wsServer.orders` calls `chooseDirective` unconditionally, so `chancellorChoice` is non-null even
   * with autopilot off. Gating the slot on the choice being present instead of on the mode would put the
   * chancellor's pick on screen as what commits in a season where nothing does.
   */
  it("does not fall back to the chancellor's pick with autopilot off", () => {
    const slot = slotFor(
      ordersFixture({
        autoPilot: false,
        queued: null,
        chancellorChoice: { kind: "holdFestival", targetCityId: null },
      }),
    );

    expect(slot.kind).toBe("idle");
    expect(slot.headline).not.toContain("祭礼");
  });

  it("does not claim a decision when autopilot is on but the chancellor picked nothing", () => {
    const slot = slotFor(ordersFixture({ autoPilot: true, chancellorChoice: null }));

    expect(slot.kind).toBe("chancellor");
    expect(slot.headline).toBe("宰相は今季なにも選べません");
  });
});
