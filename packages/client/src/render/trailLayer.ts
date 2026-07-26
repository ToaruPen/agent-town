import type { Position, TrailLevel, WorldState } from "@agent-town/shared";
import { type Container, Graphics } from "pixi.js";

import { TRAIL_COLORS } from "./colors.js";
import { TILE_SIZE } from "./mapLayer.js";

export const TRAIL_OBJECT_LABEL = "trail-object";

export interface TrailVisual {
  color: number;
  alpha: number;
  width: number;
}

/** A path reads darker, wider, and more certain the more feet have taken it. */
const TRAIL_VISUALS = {
  trace: { color: TRAIL_COLORS.trace, alpha: 0.45, width: 4 },
  trail: { color: TRAIL_COLORS.trail, alpha: 0.72, width: 7 },
  establishedTrail: { color: TRAIL_COLORS.establishedTrail, alpha: 0.9, width: 10 },
} as const satisfies Readonly<Record<Exclude<TrailLevel, "none">, TrailVisual>>;

export function trailVisual(level: Exclude<TrailLevel, "none">): TrailVisual {
  return TRAIL_VISUALS[level];
}

function positionAt(world: WorldState, index: number): Position {
  return { x: index % world.width, y: Math.floor(index / world.width) };
}

/** Only open ground shows wear; stone, water, and anything built over hide it. */
function isVisibleGround(world: WorldState, pos: Position): boolean {
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) return false;
  const terrain = world.tiles[pos.y * world.width + pos.x]?.terrain;
  if (terrain !== "plains" && terrain !== "forest") return false;
  return !world.buildings.some((building) => building.pos.x === pos.x && building.pos.y === pos.y);
}

function wornLevel(world: WorldState, pos: Position): Exclude<TrailLevel, "none"> | null {
  if (!isVisibleGround(world, pos)) return null;
  const level = world.trailCells[pos.y * world.width + pos.x]?.level;
  return level === undefined || level === "none" ? null : level;
}

/** Draws the walked strip down the tile; a full-height bar keeps a column continuous. */
function drawSegment(graphic: Graphics, visual: TrailVisual): void {
  graphic
    .roundRect((TILE_SIZE - visual.width) / 2, 0, visual.width, TILE_SIZE, visual.width / 2)
    .fill({ color: visual.color, alpha: visual.alpha });
}

/** Bridges to the next tile along the row, so a walked row is not a line of dots. */
function drawJoin(graphic: Graphics, visual: TrailVisual, neighbour: TrailVisual): void {
  const width = Math.min(visual.width, neighbour.width);
  graphic
    .roundRect(TILE_SIZE / 2, (TILE_SIZE - width) / 2, TILE_SIZE / 2, width, width / 2)
    .fill({ color: visual.color, alpha: visual.alpha });
}

function trailGraphic(world: WorldState, pos: Position, level: Exclude<TrailLevel, "none">) {
  const visual = trailVisual(level);
  const graphic = new Graphics();
  drawSegment(graphic, visual);
  const rightLevel = wornLevel(world, { x: pos.x + 1, y: pos.y });
  if (rightLevel !== null) drawJoin(graphic, visual, trailVisual(rightLevel));
  graphic.position.set(pos.x * TILE_SIZE, pos.y * TILE_SIZE);
  graphic.label = TRAIL_OBJECT_LABEL;
  return graphic;
}

function clearTrails(layer: Container): void {
  for (const child of [...layer.children]) {
    if (child.label !== TRAIL_OBJECT_LABEL) continue;
    layer.removeChild(child);
    child.destroy({ children: true });
  }
}

export function renderTrailLayer(layer: Container, world: WorldState): void {
  clearTrails(layer);

  for (let index = 0; index < world.trailCells.length; index += 1) {
    const pos = positionAt(world, index);
    const level = wornLevel(world, pos);
    if (level === null) continue;
    layer.addChild(trailGraphic(world, pos, level));
  }
}
