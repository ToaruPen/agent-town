import { describe, expect, it } from "vitest";

import { directiveView, seasonReportView } from "../src/ui/nationHud.js";
import {
  applyOrders,
  applyUpdate,
  applyWelcome,
  initialNationHudState,
} from "../src/ui/nationHudState.js";
import {
  ledgerEntry,
  nationFixture,
  ordersFixture,
  reportFixture,
  worldFixture,
} from "./nationFixture.js";

const welcomed = () => applyWelcome(initialNationHudState(), worldFixture());
const desked = () => applyOrders(welcomed(), ordersFixture({ autoPilot: false }));

/**
 * The state-to-panel mapping, which is where the reconnect rule takes effect. The pieces either side of it
 * are already covered — `applyWelcome` keeps the list and drops the claims, `buildDirectiveListViewModel`
 * reads a null `orders` as unknown — but nothing pinned that the two are wired to each other.
 */
describe("directiveView", () => {
  it("has nothing to show before any orders have arrived", () => {
    expect(directiveView(welcomed())).toBeNull();
  });

  it("shows the list and the mode once an orders message has landed", () => {
    const view = directiveView(desked());

    expect(view?.cards).toHaveLength(6);
    expect(view?.autoPilot).toBe(false);
  });

  /**
   * The whole point of storing the list apart from the claims: after a reconnect the player can still act,
   * and nothing on screen asserts a mode or a decision the server has not restated.
   */
  it("survives a reconnect with the list intact and the mode unknown", () => {
    const view = directiveView(applyWelcome(desked(), worldFixture()));

    expect(view?.cards).toHaveLength(6);
    expect(view?.cards.some((card) => card.canSubmit)).toBe(true);
    expect(view?.autoPilot).toBeNull();
    expect(view?.autoPilotLabel).toBe("自動運転 同期中");
  });

  it("shows nothing at all while the player holds no nation", () => {
    const spectating = applyWelcome(
      initialNationHudState(),
      worldFixture({ playerNationId: null }),
    );

    expect(directiveView(spectating)).toBeNull();
  });
});

/**
 * The same state-to-panel mapping as `directiveView`, but gated on holding a nation alone — the report
 * has something honest to say (`waitingForFirstReport`) even before the first `orders` message, so gating
 * on `state.options` the way the candidate list does would blank a panel that should read as waiting.
 */
describe("seasonReportView", () => {
  it("reads as waiting for the first report as soon as a nation is held, even before any orders arrive", () => {
    expect(seasonReportView(welcomed())?.waitingForFirstReport).toBe(true);
  });

  it("shows nothing at all while the player holds no nation", () => {
    const spectating = applyWelcome(
      initialNationHudState(),
      worldFixture({ playerNationId: null }),
    );

    expect(seasonReportView(spectating)).toBeNull();
  });

  it("reads the player's own last report once one has resolved", () => {
    const report = reportFixture({ entries: [ledgerEntry({ metric: "food", delta: 12 })] });
    const state = applyUpdate(
      welcomed(),
      worldFixture({ nations: [nationFixture({ lastReport: report })] }),
      2_000,
    );

    const view = seasonReportView(state);

    expect(view?.waitingForFirstReport).toBe(false);
    expect(view?.metrics.find((metric) => metric.metric === "food")?.delta).toBe(12);
  });

  /**
   * hud.md §3.6's stated consequence of dropping `ownDirectiveIds` on reconnect, exercised end to end:
   * a directive queued before the drop still reads with its real kind (from `directiveLog`, which
   * survives), but attributed to 宰相 rather than to the player who is no longer on record as having
   * queued it.
   */
  it("attributes a directive queued before a reconnect to the chancellor once it completes", () => {
    const queued = applyOrders(
      welcomed(),
      ordersFixture({ queued: { id: "directive-1", kind: "clearFarmland", targetCityId: null } }),
    );
    const reconnected = applyWelcome(queued, worldFixture());
    const report = reportFixture({ completedDirectiveIds: ["directive-1"] });
    const state = applyUpdate(
      reconnected,
      worldFixture({ nations: [nationFixture({ lastReport: report })] }),
      2_000,
    );

    const view = seasonReportView(state);

    expect(view?.completedDirectives[0]).toMatchObject({
      directiveId: "directive-1",
      kindLabel: "開墾",
      attribution: "chancellor",
      attributionLabel: "宰相の決定",
    });
  });

  /**
   * The gap the handoff doc names directly: `holdFestival` is the one one-season directive, and
   * `engine.ts` `activateBoundaryDirectives` completes it in the same boundary that selects it — it is
   * never seen sitting in `nation.activeDirectives`.
   * `orders.chancellorChoice` is the only place its id, kind and issue tick ever reach the client, and
   * it must attribute here rather than rendering 発令者不明.
   *
   * Also pins `issuedLabel`, which reads `chancellorSelection`'s stamped `issuedAtTick` for the first
   * time. Verified against `packages/server/src/sim/nation/engine.ts`: `chancellorSelection` stamps
   * `issuedAtTick: tick` with the same boundary `tick` `resolveSeason`/`report.year`/`report.season` are
   * built from, and `wsServer.ts` derives the wire's `issuedAtTick` from that identical
   * `nextNationSeasonBoundaryTick`. So a chancellor's directive always dates itself to the season the
   * boundary that selected it starts — not a value invented for this fix. (`queuedSelection` is
   * different: it preserves `queued.issuedAtTick`, the tick the player's order was accepted at, not the
   * boundary — so this date basis does not generalize to a player-queued directive.)
   */
  it("attributes a chancellor-picked holdFestival to the chancellor, never 発令者不明", () => {
    const withChoice = applyOrders(
      welcomed(),
      ordersFixture({
        chancellorChoice: {
          id: "chancellor-polity-1-300",
          kind: "holdFestival",
          targetCityId: null,
          issuedAtTick: 300,
        },
      }),
    );
    const report = reportFixture({ completedDirectiveIds: ["chancellor-polity-1-300"] });
    const state = applyUpdate(
      withChoice,
      worldFixture({ nations: [nationFixture({ lastReport: report })] }),
      2_000,
    );

    const view = seasonReportView(state);

    expect(view?.completedDirectives[0]).toMatchObject({
      directiveId: "chancellor-polity-1-300",
      kindLabel: "祭礼",
      attribution: "chancellor",
      attributionLabel: "宰相の決定",
      issuedLabel: "紀元1041年 夏 発令",
    });
  });

  /**
   * A chancellorChoice is a preview, not a commitment (fill-the-gap, `0876200`): it commits only if no
   * legal player order wins the boundary. A preview that never commits must never appear in a report —
   * the client predicts nothing about whether it will commit, so it just sits unread in the log — and
   * must never crash the report that does resolve.
   */
  it("leaves a chancellor preview that never committed out of the report, without failing", () => {
    const withChoice = applyOrders(welcomed(), ordersFixture());
    const report = reportFixture({ completedDirectiveIds: [] });
    const state = applyUpdate(
      withChoice,
      worldFixture({ nations: [nationFixture({ lastReport: report })] }),
      2_000,
    );

    const view = seasonReportView(state);

    expect(view?.completedDirectives).toEqual([]);
  });
});
