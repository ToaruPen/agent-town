// @vitest-environment happy-dom

import {
  type NationCityState,
  WORLD_MAP_PLAYER_POLITY_ALPHA,
  WORLD_MAP_POLITY_ALPHA,
  WORLD_MAP_SELECTED_POLITY_ALPHA,
  type WorldHistory,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { MAP_PLAYER_INNER_RULE_COLOR } from "../src/render/colors.js";
import { createWorldMapHost, type WorldMapSnapshot } from "../src/ui/worldMapHost.js";
import { hexColor } from "../src/ui/worldMapView.js";
import { historyFixture, polityFixture } from "./nationFixture.js";

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
  return { history: mapHistory(), cityStates: [], playerPolityId: null, ...overrides };
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
