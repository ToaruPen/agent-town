import type { Terrain, WorldState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { findPath, isWalkable } from "../src/sim/astar.js";

function createWorld(width: number, height: number, terrainAt: Map<string, Terrain> = new Map()) {
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return { terrain: terrainAt.get(`${x},${y}`) ?? "plains", resource: null };
  });

  return {
    tick: 0,
    width,
    height,
    tiles,
    agents: [],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    deaths: [],
  } satisfies WorldState;
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
