import {
  type HistoryEvent,
  type Position,
  type Tile,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_WIDTH,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { generateWorldHistory } from "../src/sim/historyGen.js";

/**
 * `packages/client/test/nationBanner.test.ts` depends on this exact private template colour set and
 * must be re-measured when this guard fails. Only four of the eight clear the client's chroma floor
 * of 18: gold 47.1, ember 37.9, moss 30.5, and river 19.5; sable 7.8, salt 8.6, thorn 13.9, and ivory
 * 15.7 fall below it. The worst pairwise CIE dE76 among all eight is 12.6 for sable/river.
 */
const EXPECTED_POLITY_TEMPLATE_COLORS = [
  0x6f7f88, 0xc49a4b, 0x708c5a, 0x5d8fa3, 0xc6bfa2, 0xa65f45, 0x8b6b72, 0x879a92,
];

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

function playerFacingHistoryStrings(history: ReturnType<typeof generateWorldHistory>): string[] {
  return [
    ...history.polities.flatMap(
      ({ name, adjective, foundingMyth, taboo, ambition, governance }) => [
        name,
        adjective,
        foundingMyth,
        taboo,
        ambition,
        governance,
      ],
    ),
    ...history.events.flatMap(({ title, summary }) => [title, summary]),
    ...history.landmarks.map(({ name }) => name),
    ...(history.settlementOrigin === null ? [] : [history.settlementOrigin.reason]),
  ];
}

describe("generateWorldHistory", () => {
  it("keeps the private polity template colour set synchronized with its client dependent", () => {
    const generatedColors = new Set(
      Array.from({ length: 16 }, (_, seed) => generateWorldHistory(seed).polities).flatMap(
        (polities) => polities.map(({ color }) => color),
      ),
    );

    expect(generatedColors).toEqual(new Set(EXPECTED_POLITY_TEMPLATE_COLORS));
  });

  it("attaches the same seeded world map to the completed history", () => {
    const first = generateWorldHistory(42);
    const second = generateWorldHistory(42);

    expect(first.worldMap).toEqual(second.worldMap);
    expect(first.worldMap.cells).toHaveLength(WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT);
  });

  it("generates every player-facing history field in Japanese", () => {
    const history = generateWorldHistory(42, smallWalkableMap());

    expect(playerFacingHistoryStrings(history)).not.toHaveLength(0);
    for (const text of playerFacingHistoryStrings(history)) {
      expect(text).not.toMatch(/[A-Za-z]/);
    }
  });

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

  it("applies a generated last-harvest pressure to the homeland culture", () => {
    const history = generateWorldHistory(298);
    const departure = history.events.find(
      ({ id }) => id === history.settlementOrigin?.departureEventId,
    );
    const pressure = history.events.find(({ id }) => id === departure?.causeIds[0]);
    const homeland = history.polities.find(
      ({ id }) => id === history.settlementOrigin?.homelandPolityId,
    );
    expect(pressure).toBeDefined();
    expect(homeland).toBeDefined();
    if (pressure === undefined || homeland === undefined)
      throw new Error("missing departure cause");
    const mutualAid = homeland.values.find(({ value }) => value === "mutualAid");

    expect(pressure.title).toMatch(/最後の収穫$/);
    expect(pressure.effects).toContainEqual({
      kind: "culture",
      targetId: homeland.id,
      value: "mutualAid",
      delta: 0.08,
    });
    expect(mutualAid?.changedByEventIds ?? []).toContain(pressure.id);
  });
});
