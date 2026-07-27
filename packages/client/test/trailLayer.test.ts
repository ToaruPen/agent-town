import type { TrailCell, TrailLevel, WorldState } from "@agent-town/shared";
import { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";

import { TRAIL_COLORS } from "../src/render/colors.js";
import { TILE_SIZE } from "../src/render/mapLayer.js";
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

function makeGridWorld(width: number, height: number): WorldState {
  return makeWorld({
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({
      terrain: "plains" as const,
      resource: null,
    })),
    trailCells: makeTrailCellsFixture(width, height),
  });
}

function trailAt(layer: Container, x: number, y: number): Graphics {
  const trail = layer.children.find(
    (child) => child.position.x === x * 16 && child.position.y === y * 16,
  );
  if (!(trail instanceof Graphics)) throw new Error(`missing trail at ${x},${y}`);
  return trail;
}

function fillRectangles(graphics: Graphics): number[][] {
  return graphics.context.instructions.flatMap((instruction) => {
    if (instruction.action !== "fill") return [];
    return instruction.data.path.instructions.flatMap((pathInstruction) =>
      pathInstruction.action === "rect" &&
      (pathInstruction.data[2] !== 1 || pathInstruction.data[3] !== 1)
        ? [pathInstruction.data.slice(0, 4)]
        : [],
    );
  });
}

interface GritSpeck {
  position: number[];
  color: number;
  alpha: number;
}

function gritSpecks(graphics: Graphics): GritSpeck[] {
  return graphics.context.instructions.flatMap((instruction) => {
    if (instruction.action !== "fill") return [];
    return instruction.data.path.instructions.flatMap((pathInstruction) => {
      if (pathInstruction.action !== "rect") return [];
      const [x, y, width, height] = pathInstruction.data;
      if (width !== 1 || height !== 1) return [];
      return [
        {
          position: [x ?? 0, y ?? 0],
          color: instruction.data.style.color,
          alpha: instruction.data.style.alpha,
        },
      ];
    });
  });
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

  it("optionally raises alpha in proportion to wear without changing the two-argument default", () => {
    const world = makeWorld();
    wear(world.trailCells, 1, "trace");
    const cell = world.trailCells[1];
    if (cell === undefined) throw new Error("missing test trail");
    cell.wear = 12;
    const normalLayer = new Container();
    const overlayLayer = new Container();

    renderTrailLayer(normalLayer, world);
    renderTrailLayer(overlayLayer, world, true);

    const normal = normalLayer.children[0];
    const overlay = overlayLayer.children[0];
    if (!(normal instanceof Graphics) || !(overlay instanceof Graphics)) {
      throw new Error("missing trail graphics");
    }
    const normalInstruction = normal.context.instructions[0];
    const overlayInstruction = overlay.context.instructions[0];
    if (normalInstruction?.action !== "fill" || overlayInstruction?.action !== "fill") {
      throw new Error("missing trail fill");
    }
    expect(normalInstruction.data.style.alpha).toBe(0.45);
    expect(overlayInstruction.data.style.alpha).toBeCloseTo(0.725);
    expect(cell.wear).toBe(12);
  });

  it("bridges the middle of a vertical run to both north and south", () => {
    const world = makeGridWorld(3, 3);
    wear(world.trailCells, 1, "trail");
    wear(world.trailCells, 4, "trail");
    wear(world.trailCells, 7, "trail");
    const layer = new Container();

    renderTrailLayer(layer, world);

    const rectangles = fillRectangles(trailAt(layer, 1, 1));
    expect(rectangles).toContainEqual([4.5, 0, 7, 8]);
    expect(rectangles).toContainEqual([4.5, 8, 7, 8]);
  });

  it("bridges a crossing in all four directions", () => {
    const world = makeGridWorld(3, 3);
    for (const index of [1, 3, 4, 5, 7]) wear(world.trailCells, index, "establishedTrail");
    const layer = new Container();

    renderTrailLayer(layer, world);

    expect(fillRectangles(trailAt(layer, 1, 1))).toEqual(
      expect.arrayContaining([
        [3, 0, 10, 8],
        [8, 3, 8, 10],
        [3, 8, 10, 8],
        [0, 3, 8, 10],
      ]),
    );
  });

  it("draws one centered band and no bridge for a lone worn tile", () => {
    const world = makeGridWorld(3, 3);
    wear(world.trailCells, 4, "trace");
    const layer = new Container();

    renderTrailLayer(layer, world);

    const trail = trailAt(layer, 1, 1);
    const bandFills = trail.context.instructions.filter(
      (instruction) =>
        instruction.action === "fill" &&
        instruction.data.path.instructions.some(
          (pathInstruction) => pathInstruction.action === "roundRect",
        ),
    );
    expect(bandFills).toHaveLength(1);
    expect(fillRectangles(trail)).toHaveLength(0);
    const fill = bandFills[0];
    if (fill?.action !== "fill") throw new Error("missing trail fill");
    const band = fill.data.path.instructions[0];
    expect(band?.action).toBe("roundRect");
    expect(band?.data.slice(0, 4)).toEqual([6, 6, 4, 4]);
  });

  it("scatters a few subtle dark specks at stable tile-index positions", () => {
    const world = makeGridWorld(3, 1);
    wear(world.trailCells, 0, "establishedTrail");
    wear(world.trailCells, 1, "establishedTrail");
    const firstLayer = new Container();
    const secondLayer = new Container();

    renderTrailLayer(firstLayer, world);
    renderTrailLayer(secondLayer, world);

    const first = gritSpecks(trailAt(firstLayer, 0, 0));
    const repeated = gritSpecks(trailAt(secondLayer, 0, 0));
    const nextTile = gritSpecks(trailAt(firstLayer, 1, 0));
    expect(first).toHaveLength(3);
    expect(repeated).toEqual(first);
    expect(nextTile.map(({ position }) => position)).not.toEqual(
      first.map(({ position }) => position),
    );
    expect(new Set(first.map(({ position }) => position.join(",")))).toHaveLength(first.length);
    expect(first.every(({ alpha }) => alpha <= 0.4)).toBe(true);
    expect(
      first.every(({ color }) => {
        return (
          ((color >> 16) & 0xff) < ((TRAIL_COLORS.establishedTrail >> 16) & 0xff) &&
          ((color >> 8) & 0xff) < ((TRAIL_COLORS.establishedTrail >> 8) & 0xff) &&
          (color & 0xff) < (TRAIL_COLORS.establishedTrail & 0xff)
        );
      }),
    ).toBe(true);

    const trailWorld = makeGridWorld(5, 1);
    wear(trailWorld.trailCells, 4, "trail");
    const trailLayer = new Container();
    renderTrailLayer(trailLayer, trailWorld);
    const trailGrit = gritSpecks(trailAt(trailLayer, 4, 0));
    expect(new Set(trailGrit.map(({ position }) => position.join(",")))).toHaveLength(
      trailGrit.length,
    );
  });

  it("keeps grit inside the straight-sided interior of rounded trail bands", () => {
    const cases = [
      { level: "trace", tileIndex: 2 },
      { level: "establishedTrail", tileIndex: 18 },
    ] as const;

    for (const { level, tileIndex } of cases) {
      const world = makeGridWorld(tileIndex + 1, 1);
      wear(world.trailCells, tileIndex, level);
      const layer = new Container();
      renderTrailLayer(layer, world);

      const visual = trailVisual(level);
      const radius = Math.min(2, visual.width / 4);
      const bandOffset = (TILE_SIZE - visual.width) / 2;
      const safeStart = Math.ceil(bandOffset + radius);
      const safeEnd = Math.floor(bandOffset + visual.width - radius);
      expect(
        gritSpecks(trailAt(layer, tileIndex, 0)).every(({ position }) => {
          const [x = 0, y = 0] = position;
          return x >= safeStart && y >= safeStart && x + 1 <= safeEnd && y + 1 <= safeEnd;
        }),
      ).toBe(true);
    }
  });

  it("does not bridge toward worn but unwalkable ground", () => {
    const world = makeGridWorld(3, 3);
    wear(world.trailCells, 4, "trail");
    wear(world.trailCells, 5, "trail");
    const east = world.tiles[5];
    if (east === undefined) throw new Error("missing east tile");
    east.terrain = "rock";
    const layer = new Container();

    renderTrailLayer(layer, world);

    expect(layer.children).toHaveLength(1);
    expect(fillRectangles(trailAt(layer, 1, 1))).toHaveLength(0);
  });
});
