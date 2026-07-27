import { describe, expect, it } from "vitest";

import { buildNationClockViewModel } from "../src/ui/nationClockViewModel.js";
import {
  applyOrders,
  applyUpdate,
  applyWelcome,
  autoPilotCommandForKey,
  cancelDirectiveCommand,
  initialNationHudState,
  issueDirectiveCommand,
  nationKeyCommand,
  selectableNations,
  selectNationCommand,
  speedCommandForKey,
} from "../src/ui/nationHudState.js";
import { historyFixture, nationFixture, ordersFixture, worldFixture } from "./nationFixture.js";

const welcomed = () => applyWelcome(initialNationHudState(), worldFixture());

describe("nation HUD state", () => {
  it("captures the archive's final year from welcome, which is the only place it comes from", () => {
    expect(welcomed().currentYear).toBe(1_041);
  });

  it("takes the player's nation from welcome rather than asking for it", () => {
    expect(welcomed().playerNationId).toBe("polity-1");
  });

  it("keeps the history from welcome so the ranking can name nations", () => {
    const history = historyFixture();

    expect(applyWelcome(initialNationHudState(), worldFixture({ history })).history).toBe(history);
  });

  it("stamps the arrival time of an update so the countdown can predict from it", () => {
    const state = applyUpdate(welcomed(), worldFixture({ tick: 40, speed: 2 }), 5_000);

    expect(state.clock).toEqual({
      tick: 40,
      year: 1,
      season: "spring",
      speed: 2,
      receivedAt: 5_000,
    });
  });

  /**
   * A boundary is authoritative time, so it re-stamps the countdown. `season` carries no speed of its
   * own, and `wsClient`'s merge preserves the last one — so the speed must survive a boundary rather
   * than resetting to something invented.
   */
  it("advances the clock at a season boundary while keeping the speed it already knew", () => {
    const running = applyUpdate(welcomed(), worldFixture({ speed: 4 }), 2_000);
    const boundary = applyUpdate(
      running,
      worldFixture({ tick: 300, season: "summer", speed: 4 }),
      3_000,
    );

    expect(boundary.clock).toEqual({
      tick: 300,
      year: 1,
      season: "summer",
      speed: 4,
      receivedAt: 3_000,
    });
  });

  it("replaces nation state wholesale on an update", () => {
    const grown = nationFixture({ population: 11_400 });

    expect(applyUpdate(welcomed(), worldFixture({ nations: [grown] }), 2_000).nations).toEqual([
      grown,
    ]);
  });

  /** §3.6: the countdown re-derives from the first message after `welcome`; until then it shows 同期中. */
  it("has no countdown to show until the first message after welcome", () => {
    const state = welcomed();

    expect(state.clock).toBeNull();
    expect(buildNationClockViewModel(state.clock, state.currentYear ?? 0, 1_000).headline).toBe(
      "同期中",
    );
  });

  /**
   * The reconnect requirement. `welcome` re-establishes everything, and the HUD must not assume it has
   * seen the seasons that passed while it was disconnected — so a stale countdown is dropped rather
   * than left counting down from data that is now minutes old.
   */
  it("drops the stale countdown on a welcome after a gap", () => {
    const before = applyUpdate(welcomed(), worldFixture({ tick: 280, speed: 8 }), 2_000);
    const reconnected = applyWelcome(before, worldFixture({ tick: 4_200, year: 15 }));

    expect(reconnected.clock).toBeNull();
  });

  it("rebuilds nation state from welcome without needing the seasons it missed", () => {
    const before = applyUpdate(
      welcomed(),
      worldFixture({ nations: [nationFixture({ population: 11_000 })] }),
      2_000,
    );
    const afterGap = nationFixture({ population: 14_800 });
    const reconnected = applyWelcome(before, worldFixture({ nations: [afterGap], year: 15 }));

    expect(reconnected.nations).toEqual([afterGap]);
  });

  /**
   * The dedupe idiom skips a re-render when the rendered key is unchanged, so a welcome whose payload
   * happens to match what is already on screen would be skipped — and any panel the welcome should
   * have cleared would stay. The generation counter makes the invalidation explicit rather than
   * depending on the values differing.
   */
  it("invalidates the render key on welcome even when the payload is identical", () => {
    const before = welcomed();
    const again = applyWelcome(before, worldFixture());

    expect(again.generation).toBeGreaterThan(before.generation);
    expect(again.nations).toEqual(before.nations);
  });

  it("does not invalidate the render key for an ordinary update", () => {
    const before = welcomed();
    const updated = applyUpdate(before, worldFixture({ tick: 40 }), 2_000);

    expect(updated.generation).toBe(before.generation);
  });

  it("forgets the player's nation if a reconnect comes back without one", () => {
    const spectating = applyWelcome(welcomed(), worldFixture({ playerNationId: null }));

    expect(spectating.playerNationId).toBeNull();
  });
});

/**
 * Measured against the live server: a fresh connection arrives with `playerNationId === null`, and
 * `wsServer.selectNation` sets the player's nation without re-sending `welcome` — it replies with
 * `orders`. So `orders.nationId` is the only place the client learns which nation is its own, and
 * without adopting it the dashboard has no nation to draw and never appears.
 */
describe("claiming a nation", () => {
  it("offers every nation for selection while the player holds none", () => {
    const spectating = applyWelcome(
      initialNationHudState(),
      worldFixture({ playerNationId: null }),
    );

    expect(selectableNations(spectating).map(({ id }) => id)).toEqual(["polity-1"]);
  });

  it("offers nothing once a nation is held, which is what hides the picker", () => {
    expect(selectableNations(welcomed())).toEqual([]);
  });

  it("adopts the nation id the server acknowledges", () => {
    const spectating = applyWelcome(
      initialNationHudState(),
      worldFixture({ playerNationId: null }),
    );
    const claimed = applyOrders(spectating, ordersFixture());

    expect(claimed.playerNationId).toBe("polity-1");
    expect(selectableNations(claimed)).toEqual([]);
  });

  /**
   * This used to assert referential identity, on the reasoning that re-acknowledging the nation the
   * player already holds is not news. It cannot any more: `orders` carries the candidate list, the
   * queued order and any refusal, so every message is new information even when the nation id repeats.
   * What still has to hold is that the id does not wobble and the payload lands.
   */
  it("keeps the held nation and stores the desk when the nation id repeats", () => {
    const orders = ordersFixture();
    const after = applyOrders(welcomed(), orders);

    expect(after.playerNationId).toBe("polity-1");
    expect(after.orders).toBe(orders);
  });

  it("names the nation in the command it sends", () => {
    expect(selectNationCommand("polity-2")).toEqual({ type: "selectNation", nationId: "polity-2" });
  });

  /** A welcome that already names the player's nation must not put the picker back on screen. */
  it("does not re-offer selection after a reconnect that comes back with a nation", () => {
    const claimed = applyOrders(
      applyWelcome(initialNationHudState(), worldFixture({ playerNationId: null })),
      ordersFixture(),
    );

    expect(selectableNations(applyWelcome(claimed, worldFixture()))).toEqual([]);
  });
});

describe("speedCommandForKey", () => {
  it("sends the speed named by each digit key", () => {
    const state = welcomed();

    expect(speedCommandForKey("0", state)).toEqual({ type: "setSpeed", speed: 0 });
    expect(speedCommandForKey("1", state)).toEqual({ type: "setSpeed", speed: 1 });
    expect(speedCommandForKey("2", state)).toEqual({ type: "setSpeed", speed: 2 });
    expect(speedCommandForKey("4", state)).toEqual({ type: "setSpeed", speed: 4 });
    expect(speedCommandForKey("8", state)).toEqual({ type: "setSpeed", speed: 8 });
  });

  it("ignores a digit that is not a speed the simulation offers", () => {
    const state = welcomed();

    expect(speedCommandForKey("3", state)).toBeNull();
    expect(speedCommandForKey("9", state)).toBeNull();
    expect(speedCommandForKey("x", state)).toBeNull();
  });

  /** An empty or multi-character key must not coerce its way into a speed. `Number("") === 0`. */
  it("ignores a key that is not a single character", () => {
    const state = welcomed();

    expect(speedCommandForKey("", state)).toBeNull();
    expect(speedCommandForKey("ArrowUp", state)).toBeNull();
    expect(speedCommandForKey("08", state)).toBeNull();
  });

  /** Space is already "activate the cursor cell" on the canvas, so pause gets `P`. */
  it("pauses with P while running", () => {
    const running = applyUpdate(welcomed(), worldFixture({ speed: 4 }), 2_000);

    expect(speedCommandForKey("p", running)).toEqual({ type: "setSpeed", speed: 0 });
  });

  it("returns to the speed it was running at before the pause", () => {
    const paused = applyUpdate(
      applyUpdate(welcomed(), worldFixture({ speed: 4 }), 2_000),
      worldFixture({ speed: 0 }),
      3_000,
    );

    expect(speedCommandForKey("p", paused)).toEqual({ type: "setSpeed", speed: 4 });
  });

  it("resumes at x1 when the session has only ever been paused", () => {
    const paused = applyWelcome(initialNationHudState(), worldFixture({ speed: 0 }));

    expect(speedCommandForKey("p", paused)).toEqual({ type: "setSpeed", speed: 1 });
  });

  it("accepts an upper-case P as well", () => {
    const running = applyUpdate(welcomed(), worldFixture({ speed: 2 }), 2_000);

    expect(speedCommandForKey("P", running)).toEqual({ type: "setSpeed", speed: 0 });
  });

  it("pauses on P from a welcome that arrived running", () => {
    expect(speedCommandForKey("p", welcomed())).toEqual({ type: "setSpeed", speed: 0 });
  });
});

describe("the order commands", () => {
  it("names the kind and the target in an issue", () => {
    expect(issueDirectiveCommand("growCity", "city-polity-1-1")).toEqual({
      type: "issueDirective",
      kind: "growCity",
      targetCityId: "city-polity-1-1",
    });
  });

  it("sends a null target for the kinds that have none", () => {
    expect(issueDirectiveCommand("holdFestival", null)).toEqual({
      type: "issueDirective",
      kind: "holdFestival",
      targetCityId: null,
    });
  });

  it("cancels by directive id", () => {
    expect(cancelDirectiveCommand("directive-3")).toEqual({
      type: "cancelDirective",
      directiveId: "directive-3",
    });
  });
});

/**
 * The toggle is computed from the server's last echo, never from a local mode flag. That is what bullet 4
 * asks for, and it matters most at speed 0: no boundary is coming along to correct a lamp that guessed.
 */
describe("autoPilotCommandForKey", () => {
  const withOrders = (autoPilot: boolean) => applyOrders(welcomed(), ordersFixture({ autoPilot }));

  it("asks for the opposite of what the server last reported", () => {
    expect(autoPilotCommandForKey("a", withOrders(true))).toEqual({
      type: "setAutoPilot",
      enabled: false,
    });
    expect(autoPilotCommandForKey("a", withOrders(false))).toEqual({
      type: "setAutoPilot",
      enabled: true,
    });
  });

  it("accepts an upper-case A as well", () => {
    expect(autoPilotCommandForKey("A", withOrders(true))).toEqual({
      type: "setAutoPilot",
      enabled: false,
    });
  });

  /**
   * `sim/nation/bootstrap.ts` starts nations with `autoPilot: true`, so guessing "off" before the first
   * echo would turn autopilot *on* for a nation that already had it, inverting the key.
   */
  it("refuses to guess before the first orders message", () => {
    expect(autoPilotCommandForKey("a", welcomed())).toBeNull();
  });

  it("ignores every other key", () => {
    expect(autoPilotCommandForKey("d", withOrders(true))).toBeNull();
    expect(autoPilotCommandForKey("1", withOrders(true))).toBeNull();
  });
});

/**
 * The routing the key handler actually uses, tested here rather than through a `keydown` — there is no DOM
 * test environment, and the branch worth pinning is which owner a key goes to, not how the event arrives.
 *
 * `A` is dispatched on the key itself. Routing on "whichever handler answers first" would send `A` to the
 * speed handler in exactly the state where autopilot declines to guess, and it is stopped there today only
 * because `Number("a")` is `NaN` — an accident, not a decision.
 */
describe("nationKeyCommand", () => {
  const withOrders = (autoPilot: boolean) => applyOrders(welcomed(), ordersFixture({ autoPilot }));

  it("routes A to autopilot rather than to the speed keys", () => {
    expect(nationKeyCommand("a", withOrders(true))).toEqual({
      type: "setAutoPilot",
      enabled: false,
    });
  });

  it("sends nothing at all for A before the first orders, and no speed either", () => {
    expect(nationKeyCommand("a", welcomed())).toBeNull();
    expect(nationKeyCommand("A", welcomed())).toBeNull();
  });

  it("still routes the speed half of the map", () => {
    expect(nationKeyCommand("4", withOrders(true))).toEqual({ type: "setSpeed", speed: 4 });
    expect(nationKeyCommand("p", withOrders(true))).toEqual({ type: "setSpeed", speed: 0 });
  });

  /** `D` and `Escape` act on a panel, so the server half of the map must not answer for them. */
  it("leaves the panel keys to the panel handler", () => {
    expect(nationKeyCommand("d", withOrders(true))).toBeNull();
    expect(nationKeyCommand("Escape", withOrders(true))).toBeNull();
  });
});

/**
 * The candidate list and the boundary claims are stored apart precisely so a reconnect can keep one and
 * drop the other. Keeping both would leave the commit slot naming a decision for a season that may have
 * resolved during the gap; dropping both would leave the desk empty at speed 0, with no action available
 * that would refill it.
 */
describe("a welcome after a reconnect", () => {
  it("keeps the candidate list so the desk is not empty at speed 0", () => {
    const desked = applyOrders(welcomed(), ordersFixture());

    expect(applyWelcome(desked, worldFixture()).options).toHaveLength(6);
  });

  /**
   * Every field of `orders` is an assertion about the next boundary. The queued order may have committed
   * or been cleared, autopilot may have been flipped from another connection — both live on the shared
   * runtime rather than the session — and a refusal answers an action from before the gap.
   */
  it("drops every claim about the next boundary, refusal included", () => {
    const refused = applyOrders(
      welcomed(),
      ordersFixture({
        autoPilot: false,
        queued: { id: "directive-1", kind: "holdFestival", targetCityId: null },
        rejected: "insufficientWealth",
      }),
    );

    expect(applyWelcome(refused, worldFixture()).orders).toBeNull();
  });

  it("has no candidate list to carry when none had arrived", () => {
    expect(applyWelcome(welcomed(), worldFixture()).options).toEqual([]);
    expect(applyWelcome(welcomed(), worldFixture()).orders).toBeNull();
  });
});
