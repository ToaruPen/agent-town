import type { TrailCell, TrailLevel, WorldState } from "@agent-town/shared";
import { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";

import { TRAIL_COLORS } from "../src/render/colors.js";
import { renderTrailLayer, TRAIL_OBJECT_LABEL, trailVisual } from "../src/render/trailLayer.js";
import { makeTrailCellsFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  const width = 4;
  const height = 1;
  return {
    tick: 0,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({
      terrain: "plains" as const,
      resource: null,
    })),
    agents: [],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [],
    trailCells: makeTrailCellsFixture(width, height),
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
      worldMap: makeWorldMapFixture(),
    },
    ...overrides,
  };
}

function wear(cells: TrailCell[], index: number, level: Exclude<TrailLevel, "none">): void {
  const cell = cells[index];
  if (cell === undefined) throw new Error(`no trail cell at ${index}`);
  cell.level = level;
  cell.wear = 1;
}

describe("trailVisual", () => {
  it("darkens, thickens, and firms up as a path is worn in", () => {
    expect(trailVisual("trace")).toEqual({ color: TRAIL_COLORS.trace, alpha: 0.45, width: 4 });
    expect(trailVisual("trail")).toEqual({ color: TRAIL_COLORS.trail, alpha: 0.72, width: 7 });
    expect(trailVisual("establishedTrail")).toEqual({
      color: TRAIL_COLORS.establishedTrail,
      alpha: 0.9,
      width: 10,
    });
  });
});

describe("renderTrailLayer", () => {
  it("draws one marker per worn cell and none for untouched ground", () => {
    const world = makeWorld();
    wear(world.trailCells, 1, "trail");
    wear(world.trailCells, 2, "trace");
    const layer = new Container();

    renderTrailLayer(layer, world);

    expect(layer.children).toHaveLength(2);
    expect(layer.children.every(({ label }) => label === TRAIL_OBJECT_LABEL)).toBe(true);
  });

  it("leaves water, rock, and built-over ground unmarked", () => {
    const world = makeWorld();
    for (let index = 0; index < 4; index += 1) wear(world.trailCells, index, "establishedTrail");
    const tiles = world.tiles;
    if (tiles[0] === undefined || tiles[1] === undefined) throw new Error("missing test tiles");
    tiles[0].terrain = "water";
    tiles[1].terrain = "rock";
    world.buildings = [{ kind: "house", pos: { x: 2, y: 0 }, progress: 1, complete: false }];
    const layer = new Container();

    renderTrailLayer(layer, world);

    expect(layer.children).toHaveLength(1);
  });

  it("clears only its own markers when the world is redrawn", () => {
    const world = makeWorld();
    wear(world.trailCells, 1, "trail");
    const layer = new Container();
    const foreign = new Graphics();
    foreign.label = "resource-object";
    layer.addChild(foreign);

    renderTrailLayer(layer, world);
    wear(world.trailCells, 2, "trail");
    renderTrailLayer(layer, world);

    expect(layer.children.filter(({ label }) => label === TRAIL_OBJECT_LABEL)).toHaveLength(2);
    expect(layer.children).toContain(foreign);
    expect(foreign.destroyed).toBe(false);
  });
});
