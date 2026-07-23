import {
  type Position,
  WORLD_MAP_CITY_COUNT_MAX,
  WORLD_MAP_CITY_COUNT_MIN,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_WIDTH,
  type WorldMap,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { generateWorldHistory } from "../src/sim/historyGen.js";
import { generateWorldMap, type WorldMapHistory } from "../src/sim/worldMapGen.js";

function generated(seed: number) {
  const history = generateWorldHistory(seed);
  return { history, map: generateWorldMap(seed, history) };
}

function cellAt(map: WorldMap, pos: Position) {
  return map.cells[pos.y * map.width + pos.x];
}

function populationFor(history: WorldMapHistory, polityId: string): number {
  return history.events
    .flatMap(({ effects }) => effects)
    .reduce(
      (total, effect) =>
        effect.kind === "population" && effect.targetId === polityId ? total + effect.delta : total,
      0,
    );
}

function territoryCounts(map: WorldMap): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { polityId } of map.cells) {
    if (polityId !== null) counts.set(polityId, (counts.get(polityId) ?? 0) + 1);
  }
  return counts;
}

function fourNeighbors(map: WorldMap, pos: Position): Position[] {
  return [
    { x: pos.x, y: pos.y - 1 },
    { x: pos.x + 1, y: pos.y },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x - 1, y: pos.y },
  ].filter(({ x, y }) => x >= 0 && x < map.width && y >= 0 && y < map.height);
}

function expectUniqueIds(ids: string[]): void {
  expect(new Set(ids).size).toBe(ids.length);
}

function expectCausalCities(history: WorldMapHistory, map: WorldMap): void {
  const polityIds = new Set(history.polities.map(({ id }) => id));
  const eventIds = new Set(history.events.map(({ id }) => id));
  for (const city of map.cities) {
    expect(polityIds.has(city.polityId)).toBe(true);
    expect(eventIds.has(city.foundedByEventId)).toBe(true);
    expect(cellAt(map, city.pos)?.polityId).toBe(city.polityId);
    expect(city.name).not.toMatch(/[A-Za-z]/);
  }
}

function expectCausalRoutes(history: WorldMapHistory, map: WorldMap): void {
  const eventsById = new Map(history.events.map((event) => [event.id, event]));
  const citiesById = new Map(map.cities.map((city) => [city.id, city]));
  for (const route of map.tradeRoutes) {
    const event = eventsById.get(route.establishedByEventId);
    const endpoints = route.cityIds.map((id) => citiesById.get(id));
    expect(event?.kind).toBe("trade");
    expect(endpoints.every(Boolean)).toBe(true);
    expect(endpoints.map((city) => city?.polityId)).toEqual(event?.polityIds);
  }
}

function expectCausalBorders(history: WorldMapHistory, map: WorldMap): void {
  const eventsById = new Map(history.events.map((event) => [event.id, event]));
  for (const change of map.borderChanges) {
    const event = eventsById.get(change.establishedByEventId);
    expect(event?.kind).toBe("war");
    expect(event?.polityIds).toEqual(
      expect.arrayContaining([change.formerPolityId, change.currentPolityId]),
    );
    expect(cellAt(map, change.pos)?.polityId).toBe(change.currentPolityId);
  }
}

function expectPolityCities(history: WorldMapHistory, map: WorldMap): void {
  const eventsById = new Map(history.events.map((event) => [event.id, event]));
  for (const polity of history.polities) {
    const cities = map.cities.filter(({ polityId }) => polityId === polity.id);
    const capitals = cities.filter(({ isCapital }) => isCapital);
    expect(cities.length).toBeGreaterThanOrEqual(WORLD_MAP_CITY_COUNT_MIN);
    expect(cities.length).toBeLessThanOrEqual(WORLD_MAP_CITY_COUNT_MAX);
    expect(capitals).toHaveLength(1);

    const founding = eventsById.get(capitals[0]?.foundedByEventId ?? "");
    expect(founding?.kind).toBe("founding");
    expect(founding?.polityIds).toEqual([polity.id]);
  }
}

function expectCausalMap(history: WorldMapHistory, map: WorldMap): void {
  expectCausalCities(history, map);
  expectCausalRoutes(history, map);
  expectCausalBorders(history, map);
  expectPolityCities(history, map);
  expectUniqueIds([
    ...map.cities.map(({ id }) => id),
    ...map.tradeRoutes.map(({ id }) => id),
    ...map.borderChanges.map(({ id }) => id),
  ]);
}

function expectSettlementFrontier(history: WorldMapHistory, map: WorldMap): void {
  const origin = history.settlementOrigin;
  expect(origin).not.toBeNull();
  if (origin === null) throw new Error("generated history requires a settlement origin");

  const frontier = cellAt(map, map.settlementFrontierPos);
  expect(frontier?.terrain).not.toBe("sea");
  expect(frontier?.polityId).toBeNull();
  expect(
    fourNeighbors(map, map.settlementFrontierPos).some(
      (pos) => cellAt(map, pos)?.polityId === origin.homelandPolityId,
    ),
  ).toBe(true);
}

function expectPopulationOrder(history: WorldMapHistory, map: WorldMap): void {
  const counts = territoryCounts(map);
  for (const polity of history.polities) {
    expect(counts.get(polity.id) ?? 0).toBeGreaterThan(0);
  }
  for (const left of history.polities) {
    for (const right of history.polities) {
      const leftPopulation = populationFor(history, left.id);
      const rightPopulation = populationFor(history, right.id);
      if (leftPopulation > rightPopulation) {
        expect(counts.get(left.id) ?? 0).toBeGreaterThanOrEqual(counts.get(right.id) ?? 0);
      }
    }
  }
}

describe("generateWorldMap", () => {
  it("replays the identical world map from the same seed and history", () => {
    expect(generated(42).map).toEqual(generated(42).map);
  });

  it("changes the world map for a different seed", () => {
    expect(generated(42).map).not.toEqual(generated(43).map);
  });

  it("builds the frozen row-major grid from valid terrain values", () => {
    const { map } = generated(42);
    const terrain = new Set(map.cells.map(({ terrain }) => terrain));

    expect([map.width, map.height, map.cells.length]).toEqual([
      WORLD_MAP_WIDTH,
      WORLD_MAP_HEIGHT,
      WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT,
    ]);
    expect(
      [...terrain].every((value) =>
        ["sea", "plains", "forest", "hills", "mountains"].includes(value),
      ),
    ).toBe(true);
    expect(terrain.has("sea")).toBe(true);
    expect(map.cells.some(({ terrain }) => terrain !== "sea")).toBe(true);
  });

  it("derives cities, routes, and changed borders from real history", () => {
    let borderChangeCount = 0;

    for (let seed = 0; seed < 20; seed += 1) {
      const { history, map } = generated(seed);
      expectCausalMap(history, map);
      borderChangeCount += map.borderChanges.length;
    }

    expect(borderChangeCount).toBeGreaterThan(0);
  }, 20_000);

  it("reserves an unclaimed homeland frontier without inverting population order", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const { history, map } = generated(seed);
      expectSettlementFrontier(history, map);
      expectPopulationOrder(history, map);
    }
  }, 20_000);
});
