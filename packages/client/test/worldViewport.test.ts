import { describe, expect, it } from "vitest";

import { createDoubleTapHistory, pointerPanDelta } from "../src/render/worldViewport.js";

describe("pointerPanDelta", () => {
  it("holds the viewport still through the eight-pixel tap boundary", () => {
    const start = { x: 10, y: 10 };

    expect(pointerPanDelta(start, start, { x: 17, y: 10 })).toEqual({ x: 0, y: 0 });
    expect(pointerPanDelta(start, { x: 17, y: 10 }, { x: 18, y: 10 })).toEqual({ x: 0, y: 0 });
  });

  it("starts panning by the latest movement after crossing eight pixels", () => {
    expect(pointerPanDelta({ x: 10, y: 10 }, { x: 18, y: 10 }, { x: 19, y: 10 })).toEqual({
      x: 1,
      y: 0,
    });
    expect(pointerPanDelta({ x: 10, y: 10 }, { x: 19, y: 10 }, { x: 22, y: 12 })).toEqual({
      x: 3,
      y: 2,
    });
  });
});

describe("createDoubleTapHistory", () => {
  it("does not treat a quick nearby tap as a reset after an explicit clear", () => {
    const history = createDoubleTapHistory();

    expect(history.register({ x: 100, y: 100, at: 100 })).toBe(false);
    history.clear();
    expect(history.register({ x: 110, y: 100, at: 250 })).toBe(false);
  });
});
