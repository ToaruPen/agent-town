import type { HistoryEvent, Position, Tile } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { generateWorldHistory } from "../src/sim/historyGen.js";

function isBilateral(event: HistoryEvent): boolean {
  return event.kind === "trade" || event.kind === "war";
}

function smallWalkableMap(): {
  width: number;
  height: number;
  tiles: Tile[];
  stockpile: Position;
} {
  const width = 9;
  const height = 9;
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({
      terrain: "plains",
      resource: null,
    })),
    stockpile: { x: 4, y: 4 },
  };
}

function expectBilateralEffects(event: HistoryEvent, polityId: string): void {
  expect(
    event.effects.some(({ kind, targetId }) => kind === "population" && targetId === polityId),
  ).toBe(true);
  expect(
    event.effects.some(({ kind, targetId }) => kind === "culture" && targetId === polityId),
  ).toBe(true);
}

function expectBilateralPolityRecord(
  event: HistoryEvent,
  polityId: string,
  history: ReturnType<typeof generateWorldHistory>,
): void {
  const polity = history.polities.find(({ id }) => id === polityId);
  expect(polity?.values.some(({ changedByEventIds }) => changedByEventIds.includes(event.id))).toBe(
    true,
  );
  if (event.kind === "war") expect(polity?.formativeTraumaEventIds).toContain(event.id);
}

function expectBilateralEvent(
  event: HistoryEvent,
  history: ReturnType<typeof generateWorldHistory>,
  latestByPolity: Map<string, string>,
): void {
  for (const polityId of event.polityIds) {
    const priorEventId = latestByPolity.get(polityId);
    if (priorEventId !== undefined) expect(event.causeIds).toContain(priorEventId);
    expectBilateralEffects(event, polityId);
    expectBilateralPolityRecord(event, polityId, history);
  }
}

describe("generateWorldHistory", () => {
  it("carries bilateral causes and consequences through both participating polities", () => {
    const history = generateWorldHistory(0);
    const latestByPolity = new Map<string, string>();

    for (const event of history.events) {
      if (isBilateral(event)) expectBilateralEvent(event, history, latestByPolity);
      for (const polityId of event.polityIds) latestByPolity.set(polityId, event.id);
    }
  });

  it("relaxes landmark distance on a small map while keeping traces away from the stockpile", () => {
    const map = smallWalkableMap();
    const history = generateWorldHistory(42, map);

    expect(history.landmarks.length).toBeGreaterThan(0);
    for (const landmark of history.landmarks) {
      const distance =
        Math.abs(landmark.pos.x - map.stockpile.x) + Math.abs(landmark.pos.y - map.stockpile.y);
      expect(distance).toBeGreaterThanOrEqual(6);
    }
  });
});
