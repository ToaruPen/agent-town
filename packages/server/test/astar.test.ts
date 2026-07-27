import { type Position, type Terrain, TRAIL_LEVEL_WEAR, type WorldState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { filterReachable, findNearestReachable, findPath, isWalkable } from "../src/sim/astar.js";
import { makeWorldFixture } from "./worldFixture.js";

function createWorld(
  width: number,
  height: number,
  terrainAt: Map<string, Terrain> = new Map(),
): WorldState {
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return { terrain: terrainAt.get(`${x},${y}`) ?? "plains", resource: null };
  });

  return makeWorldFixture({
    width,
    height,
    tiles,
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
  });
}

describe("findPath", () => {
  it("finds a straight-line path whose length equals the Manhattan distance", () => {
    const world = createWorld(5, 3, new Map([["2,1", "forest"]]));
    const from = { x: 0, y: 1 };
    const to = { x: 4, y: 1 };

    const path = findPath(world, from, to);

    expect(path).toHaveLength(4);
    expect(path?.at(-1)).toEqual(to);
  });

  it("routes around a water wall", () => {
    const waterWall = new Map<string, Terrain>([
      ["2,0", "water"],
      ["2,1", "water"],
      ["2,2", "water"],
      ["2,3", "water"],
    ]);
    const world = createWorld(5, 5, waterWall);
    const from = { x: 0, y: 2 };
    const to = { x: 4, y: 2 };

    const path = findPath(world, from, to);

    expect(path).toHaveLength(8);
    expect(path).toContainEqual({ x: 2, y: 4 });
    expect(path?.at(-1)).toEqual(to);
    expect(path?.every((pos) => isWalkable(world, pos))).toBe(true);
  });

  it("returns null when the target is fully walled off", () => {
    const walls = new Map<string, Terrain>([
      ["1,0", "water"],
      ["0,1", "water"],
      ["2,1", "water"],
      ["1,2", "water"],
    ]);
    const world = createWorld(3, 3, walls);

    expect(findPath(world, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it("returns an empty path when the start equals the target", () => {
    const world = createWorld(3, 3);

    expect(findPath(world, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });

  it("returns null when the target is out of bounds", () => {
    const world = createWorld(3, 3);

    expect(findPath(world, { x: 0, y: 0 }, { x: 3, y: 1 })).toBeNull();
  });
});

describe("findNearestReachable", () => {
  it("skips an unreachable candidate and selects a reachable one", () => {
    const walls = new Map<string, Terrain>([
      ["1,0", "water"],
      ["2,1", "water"],
      ["3,0", "water"],
    ]);
    const world = createWorld(5, 5, walls);

    expect(
      findNearestReachable(world, { x: 0, y: 0 }, [
        { x: 2, y: 0 },
        { x: 0, y: 3 },
      ]),
    ).toEqual({ x: 0, y: 3 });
  });

  it("selects by actual path distance when a Manhattan-nearer candidate needs a detour", () => {
    const wall = new Map<string, Terrain>(
      Array.from({ length: 6 }, (_, y) => [`2,${y}`, "water"] as const),
    );
    const world = createWorld(5, 8, wall);

    expect(
      findNearestReachable(world, { x: 0, y: 2 }, [
        { x: 4, y: 2 },
        { x: 0, y: 7 },
      ]),
    ).toEqual({ x: 0, y: 7 });
  });

  it("breaks equal-distance ties by row-major position", () => {
    const world = createWorld(3, 3);

    expect(
      findNearestReachable(world, { x: 1, y: 1 }, [
        { x: 2, y: 1 },
        { x: 0, y: 1 },
      ]),
    ).toEqual({ x: 0, y: 1 });
  });

  it("returns null when the start is not walkable", () => {
    const world = createWorld(2, 1, new Map([["0,0", "water"]]));

    expect(findNearestReachable(world, { x: 0, y: 0 }, [{ x: 1, y: 0 }])).toBeNull();
  });

  it("returns null when every candidate is unreachable", () => {
    const walls = new Map<string, Terrain>([
      ["1,0", "water"],
      ["0,1", "water"],
      ["2,1", "water"],
      ["1,2", "water"],
    ]);
    const world = createWorld(3, 3, walls);

    expect(findNearestReachable(world, { x: 0, y: 0 }, [{ x: 1, y: 1 }])).toBeNull();
  });
});

describe("filterReachable", () => {
  it("filters candidates with one reachability flood while preserving candidate order", () => {
    const world = createWorld(4, 1, new Map([["1,0", "water"]]));
    const candidates = [
      { x: 3, y: 0 },
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ];

    expect(filterReachable(world, { x: 0, y: 0 }, candidates)).toEqual([{ x: 0, y: 0 }]);
  });

  it("returns an empty list when the origin is not walkable", () => {
    const world = createWorld(2, 1, new Map([["0,0", "water"]]));

    expect(filterReachable(world, { x: 0, y: 0 }, [{ x: 1, y: 0 }])).toEqual([]);
  });
});

/** Wears the listed cells all the way up to the established-trail threshold. */
function wearTrail(world: WorldState, cells: Position[]): void {
  for (const { x, y } of cells) {
    const cell = world.trailCells[y * world.width + x];
    if (cell === undefined) continue;
    cell.wear = TRAIL_LEVEL_WEAR.establishedTrail;
    cell.level = "establishedTrail";
  }
}

describe("findPath over worn ground", () => {
  it("takes a longer established trail over a shorter untrodden route", () => {
    const world = createWorld(7, 3);
    wearTrail(
      world,
      Array.from({ length: 7 }, (_, x) => ({ x, y: 0 })),
    );

    const path = findPath(world, { x: 0, y: 1 }, { x: 6, y: 1 });

    expect(path).toContainEqual({ x: 0, y: 0 });
    expect(path).toHaveLength(8);
  });

  it("still prefers a short plain route over an excessively long trail", () => {
    const world = createWorld(7, 7);
    wearTrail(world, [
      ...Array.from({ length: 3 }, (_, y) => ({ x: 0, y })),
      ...Array.from({ length: 7 }, (_, x) => ({ x, y: 0 })),
      ...Array.from({ length: 3 }, (_, y) => ({ x: 6, y })),
    ]);

    const path = findPath(world, { x: 0, y: 3 }, { x: 6, y: 3 });

    expect(path).toHaveLength(6);
    expect(path).not.toContainEqual({ x: 0, y: 0 });
  });

  it("keeps row-major tie ordering when every step costs the same", () => {
    const world = createWorld(3, 3);

    expect(findPath(world, { x: 0, y: 1 }, { x: 2, y: 1 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
  });
});
