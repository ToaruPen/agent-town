import { describe, expect, it } from "vitest";

import type { DirectiveLogEntry } from "../src/ui/nationHudState.js";
import { buildSeasonReportViewModel } from "../src/ui/seasonReportViewModel.js";
import { ledgerEntry, ordersFixture, reportFixture } from "./nationFixture.js";

const emptyLog = new Map<string, DirectiveLogEntry>();
const emptyOwn = new Set<string>();
/** `history.currentYear`, arbitrary but fixed, so calendar-year arithmetic in the tests below is checkable. */
const CURRENT_YEAR = 1_040;

describe("buildSeasonReportViewModel", () => {
  /**
   * hud.md §4.5 / the plan's own rule: before the first boundary the report says so rather than
   * rendering an empty diff. This has to stay test-distinct from a resolved report with nothing in it —
   * conflating the two would tell a brand-new player the world already resolved a season for them.
   */
  describe("waiting for the first report", () => {
    it("reads as waiting rather than as an empty diff, with no rows at all", () => {
      const view = buildSeasonReportViewModel(null, emptyLog, emptyOwn, null, CURRENT_YEAR);

      expect(view.waitingForFirstReport).toBe(true);
      expect(view.isEmpty).toBe(false);
      expect(view.metrics).toEqual([]);
      expect(view.headline).not.toBe("");
    });
  });

  /** The plan's third required test: an empty report renders without a hole in the layout. */
  describe("a genuinely empty, resolved report", () => {
    it("is test-distinct from waiting: six rows, no hole in the layout", () => {
      const view = buildSeasonReportViewModel(
        reportFixture({ entries: [] }),
        emptyLog,
        emptyOwn,
        null,
        CURRENT_YEAR,
      );

      expect(view.waitingForFirstReport).toBe(false);
      expect(view.isEmpty).toBe(true);
      expect(view.metrics).toHaveLength(6);
      for (const row of view.metrics) {
        expect(row.reasons).toEqual([]);
        expect(row.direction).toBe("flat");
      }
    });

    it("keeps the fixed metric order rather than sorting by magnitude", () => {
      const view = buildSeasonReportViewModel(
        reportFixture({ entries: [] }),
        emptyLog,
        emptyOwn,
        null,
        CURRENT_YEAR,
      );

      expect(view.metrics.map((m) => m.metric)).toEqual([
        "food",
        "materials",
        "wealth",
        "population",
        "stability",
        "culture",
      ]);
    });
  });

  /** The plan's first required test: entries group by metric and sum to the displayed delta per metric. */
  describe("grouping and summing", () => {
    it("sums a metric's row independently of the per-reason grouping, and the two agree", () => {
      const report = reportFixture({
        entries: [
          ledgerEntry({ metric: "food", reason: "baseProduction", delta: 40 }),
          ledgerEntry({ metric: "food", reason: "populationConsumption", delta: -24 }),
          ledgerEntry({ metric: "food", reason: "directiveUpkeep", delta: -4 }),
          ledgerEntry({ metric: "materials", reason: "baseProduction", delta: 10 }),
        ],
      });
      const view = buildSeasonReportViewModel(report, emptyLog, emptyOwn, null, CURRENT_YEAR);
      const food = view.metrics.find((m) => m.metric === "food");

      expect(food?.delta).toBe(12);
      expect(food?.reasons.reduce((sum, line) => sum + line.delta, 0)).toBe(12);
    });

    it("sorts a metric's reasons by magnitude, largest first", () => {
      const report = reportFixture({
        entries: [
          ledgerEntry({ metric: "food", reason: "baseProduction", delta: 40 }),
          ledgerEntry({ metric: "food", reason: "populationConsumption", delta: -24 }),
          ledgerEntry({ metric: "food", reason: "directiveUpkeep", delta: -4 }),
        ],
      });
      const view = buildSeasonReportViewModel(report, emptyLog, emptyOwn, null, CURRENT_YEAR);
      const food = view.metrics.find((m) => m.metric === "food");

      expect(food?.reasons.map((line) => line.reason)).toEqual([
        "baseProduction",
        "populationConsumption",
        "directiveUpkeep",
      ]);
    });

    it("still shows a reason whose own contributions cancel to zero, rather than hiding the row", () => {
      const report = reportFixture({
        entries: [
          ledgerEntry({
            metric: "stability",
            reason: "directiveEffect",
            delta: 5,
            directiveId: "d1",
          }),
          ledgerEntry({
            metric: "stability",
            reason: "directiveEffect",
            delta: -5,
            directiveId: "d2",
          }),
        ],
      });
      const view = buildSeasonReportViewModel(report, emptyLog, emptyOwn, null, CURRENT_YEAR);
      const stability = view.metrics.find((m) => m.metric === "stability");

      expect(stability?.reasons).toHaveLength(1);
      expect(stability?.reasons[0]?.reason).toBe("directiveEffect");
    });
  });

  /** The plan's second required test: a famine entry reads as a famine, not an unexplained population drop. */
  describe("famine", () => {
    it("reads as a famine even when a larger non-famine entry exists in the same season", () => {
      const report = reportFixture({
        entries: [
          ledgerEntry({ metric: "food", reason: "populationConsumption", delta: -2_000 }),
          ledgerEntry({ metric: "population", reason: "famine", delta: -480 }),
          ledgerEntry({ metric: "stability", reason: "famine", delta: -12 }),
        ],
      });
      const view = buildSeasonReportViewModel(report, emptyLog, emptyOwn, null, CURRENT_YEAR);

      expect(view.isFamine).toBe(true);
      expect(view.headline).toContain("飢饉");
      // The bigger food entry must not crowd famine out of the one sentence the player reads first.
      expect(view.headline).not.toContain("人口の消費");
    });
  });

  describe("the headline outside a famine", () => {
    it("names the largest positive and negative reasons across all metrics, not the biggest metric total", () => {
      const report = reportFixture({
        entries: [
          ledgerEntry({ metric: "food", reason: "baseProduction", delta: 40 }),
          ledgerEntry({ metric: "wealth", reason: "tradeIncome", delta: 5 }),
          ledgerEntry({ metric: "stability", reason: "stabilityDrift", delta: -3 }),
        ],
      });
      const view = buildSeasonReportViewModel(report, emptyLog, emptyOwn, null, CURRENT_YEAR);

      expect(view.headline).toContain("基礎生産");
      expect(view.headline).toContain("安定の自然変動");
      expect(view.headline).not.toContain("交易収入");
    });

    it("reads distinctly when the season had no entries at all", () => {
      const view = buildSeasonReportViewModel(
        reportFixture({ entries: [] }),
        emptyLog,
        emptyOwn,
        null,
        CURRENT_YEAR,
      );

      expect(view.headline).not.toBe("");
      expect(view.headline).not.toContain("飢饉");
    });
  });

  describe("completed directives", () => {
    it("attributes a completed directive to the player when its id was queued by them", () => {
      const log = new Map<string, DirectiveLogEntry>([
        ["directive-1", { kind: "clearFarmland", issuedAtTick: 100 }],
      ]);
      const own = new Set(["directive-1"]);
      const report = reportFixture({ completedDirectiveIds: ["directive-1"] });

      const view = buildSeasonReportViewModel(report, log, own, null, CURRENT_YEAR);

      expect(view.completedDirectives[0]).toMatchObject({
        directiveId: "directive-1",
        kindLabel: "開墾",
        attribution: "player",
        attributionLabel: "あなたの発令",
      });
      expect(view.completedDirectives[0]?.issuedLabel).not.toBeNull();
    });

    it("attributes a completed directive to the chancellor when it was observed but never queued by the player", () => {
      const log = new Map<string, DirectiveLogEntry>([
        ["chancellor-polity-1-500", { kind: "holdFestival", issuedAtTick: 400 }],
      ]);
      const report = reportFixture({ completedDirectiveIds: ["chancellor-polity-1-500"] });

      const view = buildSeasonReportViewModel(report, log, emptyOwn, null, CURRENT_YEAR);

      expect(view.completedDirectives[0]).toMatchObject({
        attribution: "chancellor",
        attributionLabel: "宰相の決定",
      });
    });

    /**
     * `holdFestival` is the one one-season directive (`NATION_DIRECTIVE_DURATIONS`), and
     * `engine.ts` `activateBoundaryDirectives` adds a freshly selected directive and resolves the season
     * in the same boundary — so a chancellor-picked festival completes before the client ever observes it
     * sitting in `activeDirectives`, and `chancellorChoice` carries no id to pre-attribute it by. This is
     * not a rare edge case: it is the only path available for that kind, every time autopilot picks it.
     * The report must still render, rather than throwing on a completed id it never logged.
     */
    it("still renders a completed directive whose kind was never observed, rather than throwing", () => {
      const report = reportFixture({ completedDirectiveIds: ["chancellor-polity-1-777"] });

      const view = buildSeasonReportViewModel(report, emptyLog, emptyOwn, null, CURRENT_YEAR);

      expect(view.completedDirectives[0]).toMatchObject({
        directiveId: "chancellor-polity-1-777",
        kindLabel: "施策",
        attribution: "unknown",
        attributionLabel: "発令者不明",
        issuedLabel: null,
      });
    });
  });

  /**
   * The truth table `sim/nation/engine.ts:104` actually implements: with autopilot on, the chancellor's
   * selection commits and a queued order is neither obeyed nor discarded — it waits. A season in which
   * this happened must not read as a season where nothing happened, which is why this is tested against
   * an otherwise-quiet season rather than a busy one: a held-order note on a busy season would prove
   * nothing about this specific claim.
   */
  describe("the held order — autopilot always decides, never fills a gap", () => {
    it("notes a queued order as held, not discarded, when autopilot is on in an otherwise quiet season", () => {
      const report = reportFixture({ entries: [], completedDirectiveIds: [] });
      const orders = ordersFixture({
        autoPilot: true,
        queued: { id: "directive-9", kind: "holdFestival", targetCityId: null },
      });

      const view = buildSeasonReportViewModel(report, emptyLog, emptyOwn, orders, CURRENT_YEAR);

      expect(view.heldOrderNote).not.toBeNull();
      expect(view.heldOrderNote).toContain("祭礼");
    });

    it("has no held-order note once autopilot is off, since a queued order there either commits or is not autopilot's to hold", () => {
      const orders = ordersFixture({
        autoPilot: false,
        queued: { id: "directive-9", kind: "holdFestival", targetCityId: null },
      });

      const view = buildSeasonReportViewModel(
        reportFixture(),
        emptyLog,
        emptyOwn,
        orders,
        CURRENT_YEAR,
      );

      expect(view.heldOrderNote).toBeNull();
    });

    it("has no held-order note when nothing is queued", () => {
      const orders = ordersFixture({ autoPilot: true, queued: null });

      const view = buildSeasonReportViewModel(
        reportFixture(),
        emptyLog,
        emptyOwn,
        orders,
        CURRENT_YEAR,
      );

      expect(view.heldOrderNote).toBeNull();
    });

    it("has no held-order note before the first orders message", () => {
      const view = buildSeasonReportViewModel(
        reportFixture(),
        emptyLog,
        emptyOwn,
        null,
        CURRENT_YEAR,
      );

      expect(view.heldOrderNote).toBeNull();
    });
  });

  /**
   * hud.md §3.1a: "Every other surface (report header, directive panel header, directive issue dates)
   * shows the calendar year only" — the same `currentYear + elapsedYear - 1` arithmetic the clock bar's
   * headline uses (`nationClockViewModel.ts`), not the elapsed year `SeasonReport.year` and
   * `ActiveDirective.issuedAtTick` themselves carry.
   */
  describe("years shown to the player are calendar years, not the elapsed years the wire carries", () => {
    it("shows the header's year as the calendar year", () => {
      const report = reportFixture({ year: 3, season: "summer" });

      const view = buildSeasonReportViewModel(report, emptyLog, emptyOwn, null, CURRENT_YEAR);

      expect(view.headerLabel).toBe("紀元1042年 夏 の決算");
    });

    it("dates a completed directive by the calendar year its issue tick falls in", () => {
      const log = new Map<string, DirectiveLogEntry>([
        ["directive-1", { kind: "clearFarmland", issuedAtTick: 0 }],
      ]);
      const own = new Set(["directive-1"]);
      const report = reportFixture({ completedDirectiveIds: ["directive-1"] });

      const view = buildSeasonReportViewModel(report, log, own, null, CURRENT_YEAR);

      expect(view.completedDirectives[0]?.issuedLabel).toBe("紀元1040年 春 発令");
    });

    /**
     * `currentYear` is null only before the first `welcome`, which cannot coincide with a real report —
     * this exercises the defensive fallback rather than a reachable state, so it must degrade to the
     * elapsed year instead of rendering `紀元NaN年`.
     */
    it("falls back to the elapsed year rather than a broken calendar year when currentYear is unknown", () => {
      const report = reportFixture({ year: 3, season: "summer" });

      const view = buildSeasonReportViewModel(report, emptyLog, emptyOwn, null, null);

      expect(view.headerLabel).toBe("第3年 夏 の決算");
    });
  });
});
