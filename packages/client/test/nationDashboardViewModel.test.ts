import { describe, expect, it } from "vitest";

import { buildNationDashboardViewModel } from "../src/ui/nationDashboardViewModel.js";
import { ledgerEntry, nationFixture, polityFixture, reportFixture } from "./nationFixture.js";

function rowFor(metric: string, nation = nationFixture()) {
  const view = buildNationDashboardViewModel(nation, polityFixture(), true);
  const row = view.metrics.find((candidate) => candidate.metric === metric);
  if (row === undefined) throw new Error(`no row for ${metric}`);
  return row;
}

describe("buildNationDashboardViewModel", () => {
  it("names the nation from the polity, since NationState carries no name", () => {
    const view = buildNationDashboardViewModel(nationFixture(), polityFixture(), true);

    expect(view.name).toBe("ヴェルディン侯国");
  });

  it("marks the player's own nation so the dashboard can say 自国", () => {
    expect(buildNationDashboardViewModel(nationFixture(), polityFixture(), true).isPlayer).toBe(
      true,
    );
    expect(buildNationDashboardViewModel(nationFixture(), polityFixture(), false).isPlayer).toBe(
      false,
    );
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
    const view = buildNationDashboardViewModel(nationFixture(), polityFixture(), true);

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
    const view = buildNationDashboardViewModel(nationFixture(), polityFixture(), true);

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
    const view = buildNationDashboardViewModel(nation, polityFixture(), true);

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
    const view = buildNationDashboardViewModel(nation, polityFixture(), true);

    expect(view.activeDirectives[0]?.progressLabel).toBe("●● 残0季");
  });

  it("has no directive rows when the nation is doing nothing", () => {
    expect(
      buildNationDashboardViewModel(nationFixture(), polityFixture(), true).activeDirectives,
    ).toEqual([]);
  });
});
