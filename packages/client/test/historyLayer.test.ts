import type { HistoricalLandmark, Polity } from "@agent-town/shared";
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";

import { landmarkSelectionColor, renderHistoryLayer } from "../src/render/historyLayer.js";

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

const polities: Polity[] = [
  {
    id: "polity-1",
    name: "The Sable March",
    adjective: "Sable",
    color: 0x6f7f88,
    values: [],
    foundingMyth: "The wardens shared one fire.",
    formativeTraumaEventIds: [],
    taboo: "Leaving the dead unburied.",
    ambition: "Secure every pass.",
    governance: "Wardens and village moots.",
  },
  {
    id: "polity-2",
    name: "The Violet Reach",
    adjective: "Violet",
    color: 0x8878a6,
    values: [],
    foundingMyth: "The keepers sealed the hollow.",
    formativeTraumaEventIds: [],
    taboo: "Opening a sealed hollow.",
    ambition: "Guard the old stones.",
    governance: "Keepers appoint a speaker.",
  },
];

describe("renderHistoryLayer", () => {
  it("draws each landmark once and clears stale landmarks", () => {
    const layer = new Container();

    expect(landmarkSelectionColor(landmarks[2], polities)).toBe(0x8878a6);
    renderHistoryLayer(layer, landmarks, polities, "stone");
    expect(layer.children).toHaveLength(3);
    expect(layer.children.every(({ label }) => label === "landmark-object")).toBe(true);

    renderHistoryLayer(layer, [], polities, null);
    expect(layer.children).toHaveLength(0);
  });
});
