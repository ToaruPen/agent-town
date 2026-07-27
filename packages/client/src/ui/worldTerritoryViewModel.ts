import type { Position, WorldMap } from "@agent-town/shared";

/** Enough of a `WorldMap` to find its borders: extraction reads ownership and terrain, nothing else. */
export type TerritoryMap = Pick<WorldMap, "width" | "height" | "cells">;

export type TerritorySide = "top" | "right" | "bottom" | "left";

export interface TerritoryEdge {
  /** The owned cell the edge belongs to. Each side is drawn by its own cell, never shared. */
  pos: Position;
  side: TerritorySide;
  polityId: string;
  /**
   * Whether to draw the outward casing behind the banner. True only where the territory meets sea,
   * unowned land or the map rim — see `NEIGHBOUR_OFFSETS` below for why never at a frontier.
   */
  hasCasing: boolean;
}

const NEIGHBOUR_OFFSETS: Readonly<Record<TerritorySide, Position>> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Fixed so the edge list is deterministic for a given map, which is what makes it comparable. */
const SIDES: readonly TerritorySide[] = ["top", "right", "bottom", "left"];

/**
 * Sea is unowned however the cell is labelled, matching `polityIdAtWorldMapPosition`, so a coastline
 * always produces an edge. Off-map is unowned too: a nation on the rim keeps its outline.
 */
function ownerAt(map: TerritoryMap, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  const cell = map.cells[y * map.width + x];
  if (cell === undefined || cell.terrain === "sea") return null;
  return cell.polityId;
}

/**
 * The outer boundary of each nation's territory, one edge per owned side whose neighbour has a
 * different owner. Interior sides are not emitted: stroking every cell would draw the grid, which is
 * the Risk-map failure this design exists to avoid.
 *
 * Extraction lives here rather than in the paint function so the rules above are testable and so a
 * second renderer at another cell size consumes the same decisions.
 */
function edgesAroundCell(map: TerritoryMap, x: number, y: number): TerritoryEdge[] {
  const owner = ownerAt(map, x, y);
  if (owner === null) return [];
  const edges: TerritoryEdge[] = [];
  for (const side of SIDES) {
    const offset = NEIGHBOUR_OFFSETS[side];
    const neighbour = ownerAt(map, x + offset.x, y + offset.y);
    if (neighbour === owner) continue;
    // The casing's job is making a banner legible against *terrain* — `moss` is only ΔE 16.8 from
    // plains. Against another banner it separates nothing, and two casings at a 6 px cell would put
    // 4 px of dark across the frontier and leave no terrain showing in either cell.
    edges.push({ pos: { x, y }, side, polityId: owner, hasCasing: neighbour === null });
  }
  return edges;
}

export function extractTerritoryEdges(map: TerritoryMap): TerritoryEdge[] {
  const edges: TerritoryEdge[] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) edges.push(...edgesAroundCell(map, x, y));
  }
  return edges;
}
