import {
  type Position,
  TRAIL_LEVEL_WEAR,
  type TrailLevel,
  type WorldState,
} from "@agent-town/shared";
import { type Container, Graphics } from "pixi.js";

import { TRAIL_COLORS, TRAIL_GRIT_COLOR } from "./colors.js";
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

const TRAIL_GRIT_COUNTS = {
  trace: 1,
  trail: 2,
  establishedTrail: 3,
} as const satisfies Readonly<Record<Exclude<TrailLevel, "none">, number>>;
const TRAIL_GRIT_ALPHA = 0.35;

export function trailVisual(level: Exclude<TrailLevel, "none">): TrailVisual {
  return TRAIL_VISUALS[level];
}

function positionAt(world: WorldState, index: number): Position {
  return { x: index % world.width, y: Math.floor(index / world.width) };
}

/** Only open ground shows wear; stone, water, and anything built over hide it. */
export function isVisibleGround(world: WorldState, pos: Position): boolean {
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) return false;
  const terrain = world.tiles[pos.y * world.width + pos.x]?.terrain;
  if (terrain !== "plains" && terrain !== "forest") return false;
  return !world.buildings.some((building) => building.pos.x === pos.x && building.pos.y === pos.y);
}

export function wornLevel(world: WorldState, pos: Position): Exclude<TrailLevel, "none"> | null {
  if (!isVisibleGround(world, pos)) return null;
  const level = world.trailCells[pos.y * world.width + pos.x]?.level;
  return level === undefined || level === "none" ? null : level;
}

function trafficVisual(
  level: Exclude<TrailLevel, "none">,
  wear: number,
  showTrafficOverlay: boolean,
): TrailVisual {
  const visual = trailVisual(level);
  if (!showTrafficOverlay) return visual;
  const intensity = Math.min(1, Math.max(0, wear / TRAIL_LEVEL_WEAR.establishedTrail));
  return { ...visual, alpha: visual.alpha + (1 - visual.alpha) * intensity };
}

/** A small radius keeps joined runs straight while softening isolated path corners. */
function bandRadius(width: number): number {
  return Math.min(2, width / 4);
}

function drawBand(graphic: Graphics, visual: TrailVisual): void {
  const offset = (TILE_SIZE - visual.width) / 2;
  graphic
    .roundRect(offset, offset, visual.width, visual.width, bandRadius(visual.width))
    .fill({ color: visual.color, alpha: visual.alpha });
}

interface NeighbourOffset {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

const CARDINAL_OFFSETS: readonly NeighbourOffset[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function bridgeRectangle(offset: NeighbourOffset, width: number): [number, number, number, number] {
  const centered = (TILE_SIZE - width) / 2;
  if (offset.x < 0) return [0, centered, TILE_SIZE / 2, width];
  if (offset.x > 0) return [TILE_SIZE / 2, centered, TILE_SIZE / 2, width];
  if (offset.y < 0) return [centered, 0, width, TILE_SIZE / 2];
  return [centered, TILE_SIZE / 2, width, TILE_SIZE / 2];
}

function drawBridge(
  graphic: Graphics,
  visual: TrailVisual,
  neighbour: TrailVisual,
  offset: NeighbourOffset,
): void {
  const width = Math.min(visual.width, neighbour.width);
  graphic.rect(...bridgeRectangle(offset, width)).fill({
    color: visual.color,
    alpha: visual.alpha,
  });
}

/** A tile-index mix keeps the ground texture fixed across redraws and replay. */
function gritCoordinate(tileIndex: number, salt: number, span: number): number {
  const mixed = Math.imul(tileIndex + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x27d4eb2d);
  return (mixed >>> 0) % span;
}

function drawGrit(
  graphic: Graphics,
  visual: TrailVisual,
  level: Exclude<TrailLevel, "none">,
  tileIndex: number,
): void {
  const bandOffset = (TILE_SIZE - visual.width) / 2;
  const radius = bandRadius(visual.width);
  const inset = Math.ceil(bandOffset + radius);
  const lastStart = Math.floor(bandOffset + visual.width - radius - 1);
  const span = Math.max(1, lastStart - inset + 1);
  const baseX = gritCoordinate(tileIndex, 0, span);
  const baseY = gritCoordinate(tileIndex, 1, span);
  for (let index = 0; index < TRAIL_GRIT_COUNTS[level]; index += 1) {
    const x = inset + ((baseX + index * 2) % span);
    const y = inset + ((baseY + index * 3) % span);
    graphic.rect(x, y, 1, 1).fill({ color: TRAIL_GRIT_COLOR, alpha: TRAIL_GRIT_ALPHA });
  }
}

function trailGraphic(
  world: WorldState,
  pos: Position,
  level: Exclude<TrailLevel, "none">,
  tileIndex: number,
  showTrafficOverlay: boolean,
) {
  const cell = world.trailCells[pos.y * world.width + pos.x];
  const visual = trafficVisual(level, cell?.wear ?? 0, showTrafficOverlay);
  const graphic = new Graphics();
  drawBand(graphic, visual);
  for (const offset of CARDINAL_OFFSETS) {
    const neighbourPos = { x: pos.x + offset.x, y: pos.y + offset.y };
    const neighbourLevel = wornLevel(world, neighbourPos);
    if (neighbourLevel === null) continue;
    const neighbourCell = world.trailCells[neighbourPos.y * world.width + neighbourPos.x];
    drawBridge(
      graphic,
      visual,
      trafficVisual(neighbourLevel, neighbourCell?.wear ?? 0, showTrafficOverlay),
      offset,
    );
  }
  drawGrit(graphic, visual, level, tileIndex);
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

export function renderTrailLayer(
  layer: Container,
  world: WorldState,
  showTrafficOverlay = false,
): void {
  clearTrails(layer);

  for (let index = 0; index < world.trailCells.length; index += 1) {
    const pos = positionAt(world, index);
    const level = wornLevel(world, pos);
    if (level === null) continue;
    layer.addChild(trailGraphic(world, pos, level, index, showTrafficOverlay));
  }
}
