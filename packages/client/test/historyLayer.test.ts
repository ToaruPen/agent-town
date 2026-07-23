import type { HistoricalLandmark } from "@agent-town/shared";
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";

const landmarks: HistoricalLandmark[] = [
  {
    id: "ruin",
    kind: "ruin",
    name: "Fallen Watch",
    pos: { x: 1, y: 2 },
    polityId: "polity-1",
    foundedByEventId: "event-1",
  },
  {
    id: "fort",
    kind: "borderFort",
    name: "Old Keep",
    pos: { x: 3, y: 4 },
    polityId: "polity-1",
    foundedByEventId: "event-2",
  },
  {
    id: "stone",
    kind: "standingStone",
    name: "Violet Stone",
    pos: { x: 5, y: 6 },
    polityId: "polity-2",
    foundedByEventId: "event-3",
  },
];

describe("renderHistoryLayer", () => {
  it("draws each landmark once and clears stale landmarks", async () => {
    const { renderHistoryLayer } = await import("../src/render/historyLayer.js");
    const layer = new Container();

    renderHistoryLayer(layer, landmarks, "stone");
    expect(layer.children).toHaveLength(3);
    expect(layer.children.every(({ label }) => label === "landmark-object")).toBe(true);

    renderHistoryLayer(layer, [], null);
    expect(layer.children).toHaveLength(0);
  });
});
