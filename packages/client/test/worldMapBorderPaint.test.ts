import { WORLD_MAP_CELL_SIZE_PX } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { MAP_CASING_COLOR, MAP_PLAYER_INNER_RULE_COLOR } from "../src/render/colors.js";
import {
  type BorderPaintContext,
  drawTerritoryBorders,
  type WorldMapTerritoryEdgeViewModel,
} from "../src/ui/worldMapView.js";

interface PaintedRect {
  fillStyle: string;
  alpha: number;
  rect: [number, number, number, number];
}

/**
 * A recording stand-in for the 2D context. The border geometry is the whole of this map's identity
 * channel and there is no canvas in the test environment, so it is checked here rather than by eye.
 */
function recorder(): { context: BorderPaintContext; painted: PaintedRect[] } {
  const painted: PaintedRect[] = [];
  const context: BorderPaintContext = {
    fillStyle: "#000000",
    globalAlpha: 1,
    fillRect(x: number, y: number, width: number, height: number): void {
      const style = context.fillStyle;
      painted.push({
        fillStyle: typeof style === "string" ? style : "",
        alpha: context.globalAlpha,
        rect: [x, y, width, height],
      });
    },
  };
  return { context, painted };
}

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

const BANNER = "#8ab4d8";
const CELL = WORLD_MAP_CELL_SIZE_PX;

function edge(
  side: WorldMapTerritoryEdgeViewModel["side"],
  hasCasing: boolean,
  pos = { x: 1, y: 1 },
  isPlayer = false,
): WorldMapTerritoryEdgeViewModel {
  return { pos, side, polityId: "polity-1", hasCasing, bannerColor: BANNER, isPlayer };
}

function casings(painted: readonly PaintedRect[]): PaintedRect[] {
  return painted.filter(({ fillStyle }) => fillStyle === hexColor(MAP_CASING_COLOR));
}

function banners(painted: readonly PaintedRect[]): PaintedRect[] {
  return painted.filter(({ fillStyle }) => fillStyle === BANNER);
}

function innerRules(painted: readonly PaintedRect[]): PaintedRect[] {
  return painted.filter(({ fillStyle }) => fillStyle === hexColor(MAP_PLAYER_INNER_RULE_COLOR));
}

describe("drawTerritoryBorders", () => {
  it("puts the banner on the cell's own edge and the casing just outside it", () => {
    const { context, painted } = recorder();

    drawTerritoryBorders(context, [edge("top", true)]);

    expect(casings(painted).map(({ rect }) => rect)).toEqual([[CELL, CELL - 1, CELL, 1]]);
    expect(banners(painted).map(({ rect }) => rect)).toEqual([[CELL, CELL, CELL, 1]]);
  });

  /**
   * `top` and `left` land on the cell origin, so they read correctly even if the inward offset is
   * wrong. `bottom` and `right` are the sides that expose an off-by-one, so they get exact rects too.
   */
  it("keeps the far-side banner inside the cell rather than one pixel past it", () => {
    const { context, painted } = recorder();

    drawTerritoryBorders(context, [edge("bottom", true), edge("right", true)]);

    expect(banners(painted).map(({ rect }) => rect)).toEqual([
      [CELL, CELL * 2 - 1, CELL, 1],
      [CELL * 2 - 1, CELL, 1, CELL],
    ]);
    expect(casings(painted).map(({ rect }) => rect)).toEqual([
      [CELL, CELL * 2, CELL, 1],
      [CELL * 2, CELL, 1, CELL],
    ]);
  });

  it("mirrors that geometry on all four sides", () => {
    const { context, painted } = recorder();
    const sides: WorldMapTerritoryEdgeViewModel["side"][] = ["top", "right", "bottom", "left"];

    drawTerritoryBorders(
      context,
      sides.map((side) => edge(side, true)),
    );

    // Every banner band lies inside the cell; every casing band lies outside it, and none overlap.
    for (const { rect } of banners(painted)) {
      expect(rect[0]).toBeGreaterThanOrEqual(CELL);
      expect(rect[1]).toBeGreaterThanOrEqual(CELL);
      expect(rect[0] + rect[2]).toBeLessThanOrEqual(CELL * 2);
      expect(rect[1] + rect[3]).toBeLessThanOrEqual(CELL * 2);
    }
    const outside = casings(painted).filter(
      ({ rect }) =>
        rect[0] < CELL ||
        rect[1] < CELL ||
        rect[0] + rect[2] > CELL * 2 ||
        rect[1] + rect[3] > CELL * 2,
    );
    expect(outside).toHaveLength(4);
  });

  it("paints every casing before any banner, so a neighbour's casing never covers one", () => {
    const { context, painted } = recorder();

    drawTerritoryBorders(context, [
      edge("top", true),
      edge("right", true, { x: 2, y: 1 }),
      edge("left", true, { x: 3, y: 1 }),
    ]);

    const lastCasing = painted.findLastIndex(
      ({ fillStyle }) => fillStyle === hexColor(MAP_CASING_COLOR),
    );
    const firstBanner = painted.findIndex(({ fillStyle }) => fillStyle === BANNER);
    expect(lastCasing).toBeLessThan(firstBanner);
  });

  it("draws a nation-nation frontier as banner only, with no dark seam across it", () => {
    const { context, painted } = recorder();

    drawTerritoryBorders(context, [edge("right", false), edge("left", false, { x: 2, y: 1 })]);

    expect(casings(painted)).toEqual([]);
    expect(banners(painted)).toHaveLength(2);
  });

  it("holds the casing under full-strength banner at the alpha the design measured", () => {
    const { context, painted } = recorder();

    drawTerritoryBorders(context, [edge("top", true)]);

    expect(casings(painted).map(({ alpha }) => alpha)).toEqual([0.55]);
    expect(banners(painted).map(({ alpha }) => alpha)).toEqual([1]);
  });

  /**
   * The inner rule (visual.md §2.6) is what makes the player's frontier a *double* line — the "key
   * move" that the eye finds pre-attentively without an arms race of brightness. A rival's edge never
   * gets one, no matter which side it faces.
   */
  it("draws a warm inner rule just inside the player's own banner, and none for a rival", () => {
    const { context, painted } = recorder();

    drawTerritoryBorders(context, [
      edge("top", true, undefined, true),
      edge("top", true, { x: 3, y: 1 }),
    ]);

    expect(innerRules(painted)).toHaveLength(1);
    expect(innerRules(painted)[0]?.rect).toEqual([CELL, CELL + 1, CELL, 1]);
    expect(innerRules(painted)[0]?.alpha).toBe(0.85);
  });

  /** Load-bearing: there is no casing at a nation-nation frontier, so the inner rule is what still
   *  separates the player's own border there — it must not be conditioned on `hasCasing`. */
  it("draws the inner rule at a frontier too, where there is no casing at all", () => {
    const { context, painted } = recorder();

    drawTerritoryBorders(context, [edge("left", false, undefined, true)]);

    expect(casings(painted)).toEqual([]);
    expect(innerRules(painted)).toHaveLength(1);
  });

  it("keeps the inner rule inside the banner rather than overlapping it", () => {
    const { context, painted } = recorder();

    drawTerritoryBorders(context, [
      edge("bottom", true, undefined, true),
      edge("right", true, undefined, true),
    ]);

    expect(innerRules(painted).map(({ rect }) => rect)).toEqual([
      [CELL, CELL * 2 - 2, CELL, 1],
      [CELL * 2 - 2, CELL, 1, CELL],
    ]);
  });

  /**
   * visual.md §2.6: the on-demand locate pulse rises and falls once over its 500 ms span, and the paint
   * layer only ever sees the phase the host hands it — never the clock itself. Phase 0.5 is the peak.
   */
  it("boosts the inner rule to full alpha and flush with the banner at the pulse's peak", () => {
    const { context, painted } = recorder();

    drawTerritoryBorders(context, [edge("top", true, undefined, true)], 0.5);

    expect(innerRules(painted)[0]?.alpha).toBe(1);
    expect(innerRules(painted)[0]?.rect).toEqual([CELL, CELL, CELL, 1]);
  });

  it("returns the inner rule to its resting alpha and inset at either end of the pulse", () => {
    const { context, painted } = recorder();

    drawTerritoryBorders(context, [edge("top", true, undefined, true)], 0);

    expect(innerRules(painted)[0]?.alpha).toBe(0.85);
    expect(innerRules(painted)[0]?.rect).toEqual([CELL, CELL + 1, CELL, 1]);
  });

  it("paints the resting rule when no pulse is live, same as when the argument is omitted", () => {
    const withNull = recorder();
    const withDefault = recorder();

    drawTerritoryBorders(withNull.context, [edge("top", true, undefined, true)], null);
    drawTerritoryBorders(withDefault.context, [edge("top", true, undefined, true)]);

    expect(withNull.painted).toEqual(withDefault.painted);
  });
});
