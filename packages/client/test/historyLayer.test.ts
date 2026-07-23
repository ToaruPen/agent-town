import type { HistoricalLandmark, Polity } from "@agent-town/shared";
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";

import { landmarkSelectionColor, renderHistoryLayer } from "../src/render/historyLayer.js";

const landmarks: HistoricalLandmark[] = [
  {
    id: "ruin",
    kind: "ruin",
    name: "崩れた黒貂見張り台",
    pos: { x: 1, y: 2 },
    polityId: "polity-1",
    foundedByEventId: "event-1",
  },
  {
    id: "fort",
    kind: "borderFort",
    name: "古き黒貂国境砦",
    pos: { x: 3, y: 4 },
    polityId: "polity-1",
    foundedByEventId: "event-2",
  },
  {
    id: "stone",
    kind: "standingStone",
    name: "封じられた紫晶石",
    pos: { x: 5, y: 6 },
    polityId: "polity-2",
    foundedByEventId: "event-3",
  },
];

const polities: Polity[] = [
  {
    id: "polity-1",
    name: "黒貂辺境国",
    adjective: "黒貂",
    color: 0x6f7f88,
    values: [],
    foundingMyth: "守人たちはひとつの火を分かち合った。",
    formativeTraumaEventIds: [],
    taboo: "死者を葬らずに放置すること。",
    ambition: "すべての峠を守り固める。",
    governance: "守人と村会による合議。",
  },
  {
    id: "polity-2",
    name: "紫晶境国",
    adjective: "紫晶",
    color: 0x8878a6,
    values: [],
    foundingMyth: "守人たちは窪地を封じた。",
    formativeTraumaEventIds: [],
    taboo: "封じられた窪地を開くこと。",
    ambition: "古い石を守り抜く。",
    governance: "守人たちが代表を指名する。",
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
