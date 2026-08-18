// @vitest-environment happy-dom

import {
  NATION_TICKS_PER_SEASON,
  type NationCityState,
  WORLD_MAP_PLAYER_POLITY_ALPHA,
  WORLD_MAP_POLITY_ALPHA,
  WORLD_MAP_SELECTED_POLITY_ALPHA,
  type WorldHistory,
} from "@agent-town/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAP_CASING_COLOR, MAP_PLAYER_INNER_RULE_COLOR } from "../src/render/colors.js";
import { assignNationBanners } from "../src/render/nationBanner.js";
import { seasonGroundTint } from "../src/render/sprites.js";
import { TERRITORY_CHANGE_FLASH_PEAK_ALPHA } from "../src/ui/worldMapChangeViewModel.js";
import { createWorldMapHost, type WorldMapSnapshot } from "../src/ui/worldMapHost.js";
import { hexColor, SEASON_WASH_ALPHA } from "../src/ui/worldMapView.js";
import { historyFixture, polityFixture } from "./nationFixture.js";

/** The banner a nation is assigned in `mapHistory()` — same idiom as `worldMapView.test.ts`'s own
 *  `bannerFor`, needed here to tell a tracked change's flash/hatch apart from every other coloured
 *  stroke or fill the host paints (casing, inner rule, a rival's own resting fill). */
function bannerFor(history: WorldHistory, polityId: string): string {
  const assignment = assignNationBanners(history.polities).find(
    ({ nationId }) => nationId === polityId,
  );
  if (assignment === undefined) throw new Error(`no banner for ${polityId}`);
  return hexColor(assignment.color);
}

/**
 * Records what the host actually painted. The alphas are the interesting channel — the player rule and
 * the fill are both alpha decisions, and a canvas gives no other way to observe them.
 */
interface PaintLog {
  fills: { style: string; alpha: number }[];
  /** City glyphs are arcs, not rects, and their radius is the population tier. */
  arcs: { radius: number }[];
  /** Each committed stroke, tagged with the colour it was drawn in — the cross-hatch's only channel. */
  strokes: { style: string }[];
}

function stubCanvasPainting(): PaintLog {
  const log: PaintLog = { fills: [], arcs: [], strokes: [] };
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
  };
  proto.getContext = () => {
    const context = {
      globalAlpha: 1,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "butt",
      textBaseline: "alphabetic",
      imageSmoothingEnabled: true,
      fillRect: () => {
        log.fills.push({ style: String(context.fillStyle), alpha: context.globalAlpha });
      },
      // Path building is geometry this test does not assert; only the recorded calls above are.
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      arc: (_x: number, _y: number, radius: number) => {
        log.arcs.push({ radius });
      },
      closePath: () => undefined,
      fill: () => undefined,
      stroke: () => {
        log.strokes.push({ style: String(context.strokeStyle) });
      },
      fillText: () => undefined,
    };
    return context;
  };
  return log;
}

/**
 * Two owners and an unclaimed cell, which is the smallest map that can tell the player rule from a
 * blanket change: a one-nation fixture would pass whether the rule applied to one nation or to all.
 */
function mapHistory(): WorldHistory {
  const history = historyFixture([
    polityFixture({ id: "polity-1", name: "アシュカル", color: 0x6f7f88 }),
    polityFixture({ id: "polity-2", name: "ヴェルナ", color: 0xc49a4b }),
  ]);
  history.worldMap = {
    width: 2,
    height: 2,
    cells: [
      { terrain: "plains", polityId: "polity-1" },
      { terrain: "forest", polityId: "polity-2" },
      { terrain: "hills", polityId: "polity-2" },
      { terrain: "plains", polityId: null },
    ],
    cities: [
      {
        id: "city-polity-1-1",
        name: "アシュカル府",
        pos: { x: 0, y: 0 },
        polityId: "polity-1",
        isCapital: true,
        foundedByEventId: "event-founding-1",
      },
      {
        id: "city-polity-2-1",
        name: "ヴェルナ市",
        pos: { x: 1, y: 0 },
        polityId: "polity-2",
        isCapital: false,
        foundedByEventId: "event-founding-2",
      },
    ],
    tradeRoutes: [],
    borderChanges: [],
    settlementFrontierPos: { x: 1, y: 1 },
  };
  return history;
}

function snapshot(overrides: Partial<WorldMapSnapshot> = {}): WorldMapSnapshot {
  return {
    history: mapHistory(),
    cityStates: [],
    playerPolityId: null,
    openCityId: null,
    tick: 0,
    changedCells: [],
    nations: [],
    season: "spring",
    ...overrides,
  };
}

function mount(log: PaintLog) {
  document.body.innerHTML = '<section id="world-map"></section>';
  const root = document.getElementById("world-map");
  if (root === null) throw new Error("no root");
  const selected: (string | null)[] = [];
  const host = createWorldMapHost(root, {
    className: "world-map__canvas",
    onSelect: (id) => selected.push(id),
  });
  const canvas = root.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("host mounted no canvas");
  return { host, canvas, selected, log };
}

/**
 * A controllable stand-in for the locate pulse's own wall clock and its `requestAnimationFrame` loop.
 * Real time would make a 500 ms pulse either flaky or slow to assert on, and happy-dom's own rAF fires
 * on the next microtask regardless of elapsed time — so `Date.now` and the global scheduler are both
 * driven by hand here, one `advance` at a time.
 */
function stubPulseClock(): { advance: (ms: number) => void; readonly scheduledFrameCount: number } {
  let now = 0;
  let queued: FrameRequestCallback | null = null;
  let scheduledFrameCount = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    scheduledFrameCount += 1;
    queued = callback;
    return 0;
  });
  return {
    get scheduledFrameCount() {
      return scheduledFrameCount;
    },
    advance(ms: number): void {
      now += ms;
      const callback = queued;
      queued = null;
      callback?.(now);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the world map's persistent host", () => {
  it("mounts a canvas into the page's own root", () => {
    const log = stubCanvasPainting();
    const { canvas } = mount(log);

    expect(canvas.className).toBe("world-map__canvas");
    expect(canvas.getAttribute("aria-label")).not.toBe("");
  });

  /**
   * The bullet that this slice exists for. The old handler painted only on `pointerup`, so every value
   * that moves with the clock sat frozen until the player happened to click the map.
   */
  it("repaints when the server sends an update, with no pointer event at all", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);

    host.render(snapshot());
    const afterFirst = log.fills.length;
    expect(afterFirst).toBeGreaterThan(0);

    host.render(snapshot());

    expect(log.fills.length).toBeGreaterThan(afterFirst);
  });

  it("paints nothing until a payload arrives", () => {
    const log = stubCanvasPainting();
    mount(log);

    expect(log.fills).toEqual([]);
  });

  /** Bullet 3, observed at the paint rather than in the view model: one nation is filled one step up. */
  it("fills the player's territory one step above every rival's", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);

    host.render(snapshot({ playerPolityId: "polity-2" }));

    const alphas = new Set(log.fills.map(({ alpha }) => alpha));
    expect(alphas).toContain(WORLD_MAP_PLAYER_POLITY_ALPHA);
    expect(alphas).toContain(WORLD_MAP_POLITY_ALPHA);
  });

  it("marks no territory when the player holds no nation", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);

    host.render(snapshot({ playerPolityId: null }));

    expect(new Set(log.fills.map(({ alpha }) => alpha))).not.toContain(
      WORLD_MAP_PLAYER_POLITY_ALPHA,
    );
  });

  /**
   * A repaint driven by the server must not discard what the player selected, or every click would be
   * undone by the next heartbeat — which arrives about once a second at every speed.
   */
  it("keeps the selection across a server-driven repaint", () => {
    const log = stubCanvasPainting();
    const { host, canvas } = mount(log);
    host.render(snapshot());
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 12, height: 12 }) as DOMRect;

    canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: 3, clientY: 3, bubbles: true }));

    // Load-bearing: a null-to-null comparison below would pass whether the selection survived or not.
    expect(host.selection()).toBe("polity-1");

    host.render(snapshot());

    expect(host.selection()).toBe("polity-1");
  });

  it("reports a selection to its owner rather than deciding what to do with it", () => {
    const log = stubCanvasPainting();
    const { host, canvas, selected } = mount(log);
    host.render(snapshot());
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;

    canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: 5, clientY: 5, bubbles: true }));

    expect(selected).toEqual([null]);
  });

  it("ignores a pointer event that lands before the first payload", () => {
    const log = stubCanvasPainting();
    const { canvas, selected } = mount(log);

    canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: 5, clientY: 5, bubbles: true }));

    expect(selected).toEqual([]);
    expect(log.fills).toEqual([]);
  });
});

/**
 * visual.md §2.2.1: the 0.52 highlight is hover-only and transient, decoupled from the click channel
 * exercised above — hovering never touches `selection()`, and clicking never needs a prior hover.
 */
describe("the world map's hover highlight", () => {
  it("paints the hover alpha on pointermove", () => {
    const log = stubCanvasPainting();
    const { host, canvas } = mount(log);
    host.render(snapshot());
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 12, height: 12 }) as DOMRect;
    log.fills.length = 0;

    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 3, clientY: 3, bubbles: true }),
    );

    expect(new Set(log.fills.map(({ alpha }) => alpha))).toContain(WORLD_MAP_SELECTED_POLITY_ALPHA);
  });

  it("clears the hover alpha on pointerout — there is no resting hover", () => {
    const log = stubCanvasPainting();
    const { host, canvas } = mount(log);
    host.render(snapshot());
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 12, height: 12 }) as DOMRect;
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 3, clientY: 3, bubbles: true }),
    );
    log.fills.length = 0;

    canvas.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));

    expect(new Set(log.fills.map(({ alpha }) => alpha))).not.toContain(
      WORLD_MAP_SELECTED_POLITY_ALPHA,
    );
  });

  /** `pointermove` fires dozens of times a second; a repaint on every one of them would be wasted work
   *  the instant the pointer sits still over the same nation. */
  it("does not repaint again while the pointer stays over the same nation", () => {
    const log = stubCanvasPainting();
    const { host, canvas } = mount(log);
    host.render(snapshot());
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 12, height: 12 }) as DOMRect;
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 3, clientY: 3, bubbles: true }),
    );
    log.fills.length = 0;

    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 4, clientY: 4, bubbles: true }),
    );

    expect(log.fills).toEqual([]);
  });

  it("leaves the click channel alone — hovering a nation is not selecting it", () => {
    const log = stubCanvasPainting();
    const { host, canvas } = mount(log);
    host.render(snapshot());
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 12, height: 12 }) as DOMRect;

    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 9, clientY: 3, bubbles: true }),
    );

    expect(host.selection()).toBeNull();
  });

  /**
   * §2.2.1 forbids a resting hover: the highlight answers "what is under the pointer right now", not
   * "what was under it when it last moved". A server-driven `render()` can hand the hovered cell to a
   * different owner without any `pointermove` at all, and the wash must follow rather than staying on
   * the nation that used to be there.
   */
  it("follows the hovered cell to its new owner across a server update, with the cursor never moving", () => {
    const log = stubCanvasPainting();
    const { host, canvas } = mount(log);
    host.render(snapshot({ history: mapHistory() }));
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 12, height: 12 }) as DOMRect;
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 3, clientY: 3, bubbles: true }), // cell (0,0): polity-1
    );
    log.fills.length = 0;

    const changed = mapHistory();
    const hoveredCell = changed.worldMap.cells[0];
    if (hoveredCell === undefined) throw new Error("missing cell fixture");
    changed.worldMap.cells[0] = { ...hoveredCell, polityId: "polity-2" }; // same cell, new owner
    host.render(snapshot({ history: changed })); // no pointermove in between

    expect(new Set(log.fills.map(({ alpha }) => alpha))).toContain(WORLD_MAP_SELECTED_POLITY_ALPHA);
  });

  /**
   * The mirror case: the hovered cell loses its owner entirely while the old owner still holds
   * territory elsewhere on the map. A stale hover would keep lighting up that other territory — a de
   * facto resting mark on a nation the pointer is nowhere near — rather than clearing.
   */
  it("clears the hover once its cell loses its owner, even though that owner still holds territory elsewhere", () => {
    const log = stubCanvasPainting();
    const { host, canvas } = mount(log);
    host.render(snapshot({ history: mapHistory() }));
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 12, height: 12 }) as DOMRect;
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 3, clientY: 3, bubbles: true }), // cell (0,0): polity-1
    );
    log.fills.length = 0;

    const changed = mapHistory();
    const hoveredCell = changed.worldMap.cells[0];
    const relocatedCell = changed.worldMap.cells[3]; // was unowned; now the last polity-1 cell
    if (hoveredCell === undefined || relocatedCell === undefined) {
      throw new Error("missing cell fixture");
    }
    changed.worldMap.cells[0] = { ...hoveredCell, polityId: null };
    changed.worldMap.cells[3] = { ...relocatedCell, polityId: "polity-1" };
    host.render(snapshot({ history: changed })); // no pointermove in between

    expect(new Set(log.fills.map(({ alpha }) => alpha))).not.toContain(
      WORLD_MAP_SELECTED_POLITY_ALPHA,
    );
  });
});

/** Not a decoration: `cityStates` is what gives a glyph its population tier. */
describe("the host's city states", () => {
  it("passes them through so tiers can differ from the smallest", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);
    const history = snapshot().history;
    const city = history.worldMap.cities.find(({ isCapital }) => !isCapital);
    if (city === undefined) throw new Error("no non-capital city fixture");
    const populated: NationCityState = {
      cityId: city.id,
      population: 4_000,
      developmentLevel: 3,
    };

    host.render(snapshot({ history }));
    const smallest = log.arcs.map(({ radius }) => radius);
    log.arcs.length = 0;

    host.render(snapshot({ history, cityStates: [populated] }));

    expect(smallest.length).toBeGreaterThan(0);
    expect(log.arcs.map(({ radius }) => radius)).not.toEqual(smallest);
  });
});

/**
 * Bullet 6 (visual.md §2.6): the player's capital is a diamond plus a cross-hatch, reusing
 * `drawSettlement`'s idiom. `drawSettlement` itself always strokes one cream cross for "現在地", so the
 * count below is relative to that baseline rather than to zero.
 */
describe("the player's capital", () => {
  function creamStrokes(log: PaintLog): number {
    return log.strokes.filter(({ style }) => style === hexColor(MAP_PLAYER_INNER_RULE_COLOR))
      .length;
  }

  it("adds one cross-hatch stroke over the player's own capital, and none for a rival's", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);

    host.render(snapshot({ playerPolityId: null }));
    const baseline = creamStrokes(log);
    log.strokes.length = 0;

    // polity-1 owns the capital in the fixture.
    host.render(snapshot({ playerPolityId: "polity-1" }));
    const withPlayerCapital = creamStrokes(log);
    log.strokes.length = 0;

    // polity-2 owns only the non-capital city.
    host.render(snapshot({ playerPolityId: "polity-2" }));
    const withPlayerNonCapital = creamStrokes(log);

    expect(withPlayerCapital).toBe(baseline + 1);
    expect(withPlayerNonCapital).toBe(baseline);
  });
});

/**
 * traversal.md §2.2: the docked local view's own city is marked as open on the map — the continuity
 * cue for a layout where both surfaces stay on screen at once. Isolated on the fixture's non-capital,
 * non-player city so the ring's own stroke cannot be confused with the capital cross-hatch above,
 * which needs both `isCapital` and `isPlayer` and this test sets neither.
 */
describe("the docked city view's marker", () => {
  function creamStrokes(log: PaintLog): number {
    return log.strokes.filter(({ style }) => style === hexColor(MAP_PLAYER_INNER_RULE_COLOR))
      .length;
  }

  it("adds one ring stroke over the open city, and none when nothing is open", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);

    host.render(snapshot({ openCityId: null }));
    const baseline = creamStrokes(log);
    log.strokes.length = 0;

    host.render(snapshot({ openCityId: "city-polity-2-1" }));
    const withOpenCity = creamStrokes(log);

    expect(withOpenCity).toBe(baseline + 1);
  });
});

/**
 * visual.md §2.4: the host accumulates `WorldCellChange` entries across renders, keyed by cell index, so
 * a change reported once by a `season` message keeps animating through every plain `clock` repaint that
 * follows — the wire only ever announces a change the instant it happens, never its ongoing decay.
 */
describe("the world map's territory-change tracking", () => {
  function nonCasingFlashFills(log: PaintLog): { style: string; alpha: number }[] {
    return log.fills.filter(
      ({ alpha, style }) =>
        alpha === TERRITORY_CHANGE_FLASH_PEAK_ALPHA && style !== hexColor(MAP_CASING_COLOR),
    );
  }

  function bannerStrokes(log: PaintLog, style: string): number {
    return log.strokes.filter((stroke) => stroke.style === style).length;
  }

  it("flashes a cell in its new owner's banner the instant a season message reports it changed", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);
    const history = mapHistory();

    // Cell 0 (index 0) has no stagger delay, so tick 0 is already inside its flash window.
    host.render(snapshot({ history, tick: 0, changedCells: [{ index: 0, polityId: "polity-2" }] }));

    const flashes = nonCasingFlashFills(log);
    expect(flashes.length).toBeGreaterThan(0);
    expect(flashes.every(({ style }) => style === bannerFor(history, "polity-2"))).toBe(true);
  });

  /**
   * The plan's own required test: "a multi-cell change staggers rather than firing as one flash." Index
   * 0's own stagger offset is `(0*7)%12 = 0`; index 2's is `(2*7)%12 = 2` — two ticks apart, not the
   * 12-tick spacing at which `(index*7)%12` collides, so the two cells' windows provably do not open
   * together. At tick 0, only index 0's window has opened; index 2's starts two ticks later.
   */
  it("staggers a multi-cell change rather than firing every cell as one flash", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);
    const history = mapHistory();

    host.render(
      snapshot({
        history,
        tick: 0,
        changedCells: [
          { index: 0, polityId: "polity-2" },
          { index: 2, polityId: "polity-1" },
        ],
      }),
    );

    const flashes = nonCasingFlashFills(log);
    expect(flashes.length).toBeGreaterThan(0);
    expect(flashes.every(({ style }) => style === bannerFor(history, "polity-2"))).toBe(true);
    expect(flashes.some(({ style }) => style === bannerFor(history, "polity-1"))).toBe(false);
  });

  /**
   * The teeth of "at x8 the compressed lifetimes still complete": a huge tick gap between two renders —
   * exactly what x8 produces between broadcasts — must still land on the fully decayed end state, with
   * nothing stuck mid-flash or mid-hatch just because no intermediate tick was ever rendered.
   */
  it("carries a tracked change through a later clock repaint, then clears it once its season boundary is spanned", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);
    const history = mapHistory();
    const bannerStyle = bannerFor(history, "polity-2");

    host.render(snapshot({ history, tick: 0, changedCells: [{ index: 0, polityId: "polity-2" }] }));
    expect(nonCasingFlashFills(log).length).toBeGreaterThan(0);
    log.fills.length = 0;
    log.strokes.length = 0;

    // A later plain clock repaint, well past the flash but still inside the hatch's own window — no new
    // changedCells at all, the way a `clock` message always arrives.
    host.render(snapshot({ history, tick: 100, changedCells: [] }));
    expect(nonCasingFlashFills(log)).toEqual([]);
    expect(bannerStrokes(log, bannerStyle)).toBeGreaterThan(0);
    log.fills.length = 0;
    log.strokes.length = 0;

    // A tick gap spanning the whole remaining window in one jump, exactly what x8 compresses two
    // broadcasts down to.
    host.render(snapshot({ history, tick: NATION_TICKS_PER_SEASON + 1, changedCells: [] }));
    expect(nonCasingFlashFills(log)).toEqual([]);
    expect(bannerStrokes(log, bannerStyle)).toBe(0);
  });
});

/**
 * visual.md §2.6: an on-demand locate pulses the player's inner rule once, 500 ms, wall-clock, one
 * shot. The host owns the deadline and self-schedules its own frames — deliberately not the HUD's
 * `requestAnimationFrame` loop, which belongs to the countdown and runs the whole session through.
 */
describe("the world map's locate pulse", () => {
  function innerRuleAlphas(log: PaintLog): number[] {
    return log.fills
      .filter(({ style }) => style === hexColor(MAP_PLAYER_INNER_RULE_COLOR))
      .map(({ alpha }) => alpha);
  }

  it("boosts the inner rule to full alpha mid-pulse and settles it back to rest at the deadline", () => {
    const log = stubCanvasPainting();
    const clock = stubPulseClock();
    const { host } = mount(log);
    host.render(snapshot({ playerPolityId: "polity-1" }));

    host.locate();
    clock.advance(250); // the pulse's peak

    expect(innerRuleAlphas(log)).toContain(1);

    clock.advance(250); // the 500 ms deadline

    expect(innerRuleAlphas(log).at(-1)).toBe(0.85);
  });

  it("stops scheduling frames once the pulse completes, rather than looping forever", () => {
    const log = stubCanvasPainting();
    const clock = stubPulseClock();
    const { host } = mount(log);
    host.render(snapshot({ playerPolityId: "polity-1" }));

    host.locate();
    clock.advance(600); // past the deadline in a single jump

    const fillsAtEnd = log.fills.length;
    clock.advance(16); // a frame that must never have been scheduled

    expect(log.fills.length).toBe(fillsAtEnd);
  });

  it("does nothing before any payload has arrived", () => {
    const log = stubCanvasPainting();
    const clock = stubPulseClock();
    const { host } = mount(log);

    host.locate();
    clock.advance(250);

    expect(log.fills).toEqual([]);
  });

  /**
   * A real `requestAnimationFrame` schedules an independent frame on every call — unlike this stub's
   * single `queued` slot, a browser would run two full loops at once, doubling every paint until each
   * self-terminates on its own. The frame count is the only place that difference is visible.
   */
  it("does not stack a second frame loop when locate is called again mid-pulse", () => {
    const log = stubCanvasPainting();
    const clock = stubPulseClock();
    const { host } = mount(log);
    host.render(snapshot({ playerPolityId: "polity-1" }));

    host.locate();
    const scheduledAfterFirstCall = clock.scheduledFrameCount;

    host.locate(); // called again before the pending frame has fired

    expect(clock.scheduledFrameCount).toBe(scheduledAfterFirstCall);
  });

  it("pulses again on a later call, after the first pulse has already finished", () => {
    const log = stubCanvasPainting();
    const clock = stubPulseClock();
    const { host } = mount(log);
    host.render(snapshot({ playerPolityId: "polity-1" }));

    host.locate();
    clock.advance(600); // finishes the first pulse

    host.locate();
    clock.advance(250); // the second pulse's own peak

    expect(innerRuleAlphas(log).at(-1)).toBe(1);
  });
});

/**
 * visual.md §2.4: the season boundary announces itself with a whole-map crossfade of the layer-2 wash,
 * 600 ms, wall-clock — deliberately not the locate pulse's own machinery (duplicated, not shared, so a
 * change to one animation's timing can never silently retime the other), but the same self-scheduling
 * `requestAnimationFrame` idiom.
 */
describe("the world map's season crossfade", () => {
  function washFills(log: PaintLog, hexStyle: string): { alpha: number }[] {
    return log.fills.filter(({ style }) => style === hexStyle).map(({ alpha }) => ({ alpha }));
  }

  /** The chronicle's own case: a surface with no live season must not paint a wash it was never told to. */
  it("paints no wash at all when the snapshot carries no season", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);

    host.render(snapshot({ season: null }));

    const anySeasonWash = [
      ...washFills(log, hexColor(seasonGroundTint("spring"))),
      ...washFills(log, hexColor(seasonGroundTint("summer"))),
      ...washFills(log, hexColor(seasonGroundTint("autumn"))),
      ...washFills(log, hexColor(seasonGroundTint("winter"))),
    ];
    expect(anySeasonWash).toEqual([]);
  });

  it("paints a single settled wash in the season's own tint, with no crossfade on the very first render", () => {
    const log = stubCanvasPainting();
    const { host } = mount(log);

    host.render(snapshot({ season: "summer" }));

    const summerFills = washFills(log, hexColor(seasonGroundTint("summer")));
    expect(summerFills.length).toBeGreaterThan(0);
    expect(summerFills.every(({ alpha }) => alpha === SEASON_WASH_ALPHA)).toBe(true);
  });

  it("does not crossfade when a later render reports the same season", () => {
    const log = stubCanvasPainting();
    const clock = stubPulseClock();
    const { host } = mount(log);
    host.render(snapshot({ season: "summer" }));
    log.fills.length = 0;

    host.render(snapshot({ season: "summer" }));

    const summerFills = washFills(log, hexColor(seasonGroundTint("summer")));
    expect(summerFills.length).toBeGreaterThan(0);
    expect(summerFills.every(({ alpha }) => alpha === SEASON_WASH_ALPHA)).toBe(true);
    expect(clock.scheduledFrameCount).toBe(0);
  });

  it("splits the 0.10 budget between the old and new season mid-crossfade, and settles on the new one at the deadline", () => {
    const log = stubCanvasPainting();
    const clock = stubPulseClock();
    const { host } = mount(log);
    host.render(snapshot({ season: "summer" }));

    host.render(snapshot({ season: "autumn" })); // the season boundary itself
    log.fills.length = 0;
    clock.advance(300); // the crossfade's own midpoint

    const summerMid = washFills(log, hexColor(seasonGroundTint("summer")));
    const autumnMid = washFills(log, hexColor(seasonGroundTint("autumn")));
    expect(summerMid.length).toBeGreaterThan(0);
    expect(autumnMid.length).toBeGreaterThan(0);
    for (const { alpha } of [...summerMid, ...autumnMid]) {
      expect(alpha).toBeCloseTo(SEASON_WASH_ALPHA / 2, 5);
    }
    log.fills.length = 0;

    clock.advance(300); // past the 600 ms deadline

    const autumnEnd = washFills(log, hexColor(seasonGroundTint("autumn")));
    const summerEnd = washFills(log, hexColor(seasonGroundTint("summer")));
    expect(autumnEnd.length).toBeGreaterThan(0);
    expect(autumnEnd.every(({ alpha }) => alpha === SEASON_WASH_ALPHA)).toBe(true);
    expect(summerEnd).toEqual([]);
  });

  it("stops scheduling frames once the crossfade completes, rather than looping forever", () => {
    const log = stubCanvasPainting();
    const clock = stubPulseClock();
    const { host } = mount(log);
    host.render(snapshot({ season: "summer" }));

    host.render(snapshot({ season: "autumn" }));
    clock.advance(600); // past the deadline in a single jump

    const fillsAtEnd = log.fills.length;
    clock.advance(16); // a frame that must never have been scheduled

    expect(log.fills.length).toBe(fillsAtEnd);
  });
});
