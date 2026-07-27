import {
  type NationCityState,
  type Position,
  WORLD_MAP_CELL_SIZE_PX,
  WORLD_MAP_POLITY_ALPHA,
  WORLD_MAP_SELECTED_POLITY_ALPHA,
  WORLD_MAP_SETTLEMENT_RADIUS_PX,
  type WorldHistory,
  type WorldMapTerrain,
} from "@agent-town/shared";

import { MAP_ACCENT_COLOR, MAP_CASING_COLOR, MAP_CITY_FILL_COLOR } from "../render/colors.js";
import { assignNationBanners } from "../render/nationBanner.js";
import { type CityGlyph, chronicleCityGlyph } from "./worldCityViewModel.js";
import { extractTerritoryEdges, type TerritoryEdge } from "./worldTerritoryViewModel.js";

const TERRAIN_VIEW = {
  sea: { label: "海", color: "#1b3442" },
  plains: { label: "平地", color: "#7d8c62" },
  forest: { label: "森", color: "#465f4d" },
  hills: { label: "丘陵", color: "#80745e" },
  mountains: { label: "山地", color: "#aaa08d" },
} as const satisfies Readonly<Record<WorldMapTerrain, { label: string; color: string }>>;

export interface WorldMapCellViewModel {
  pos: Position;
  terrain: WorldMapTerrain;
  terrainLabel: string;
  terrainColor: string;
  polityId: string | null;
  polityColor: string | null;
  polityAlpha: number;
}

export interface WorldMapCityViewModel {
  id: string;
  name: string;
  pos: Position;
  polityId: string;
  /** The nation's derived banner colour, which is the identity channel at alpha 1.0 — not the
   *  archival `Polity.color`, whose muted values collide. See visual.md §2.0 and §2.1. */
  bannerColor: string;
  isCapital: boolean;
  isHighlighted: boolean;
  /** Population tier, capital shape and the development ratio, decided in `worldCityViewModel`. */
  glyph: CityGlyph;
}

/** An outline edge with the colour to paint it in, so the paint pass makes no colour decisions. */
export interface WorldMapTerritoryEdgeViewModel extends TerritoryEdge {
  bannerColor: string;
}

export interface WorldMapRouteViewModel {
  id: string;
  from: Position;
  to: Position;
  isHighlighted: boolean;
}

export interface WorldMapViewModel {
  width: number;
  height: number;
  cells: WorldMapCellViewModel[];
  cities: WorldMapCityViewModel[];
  territoryEdges: WorldMapTerritoryEdgeViewModel[];
  tradeRoutes: WorldMapRouteViewModel[];
  settlement: {
    pos: Position;
    label: "現在地";
  };
  selectedPolityId: string | null;
}

export function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function cellAlpha(polityId: string | null, selectedPolityId: string | null): number {
  if (polityId === null) return 0;
  return polityId === selectedPolityId ? WORLD_MAP_SELECTED_POLITY_ALPHA : WORLD_MAP_POLITY_ALPHA;
}

function buildCells(
  history: WorldHistory,
  selectedPolityId: string | null,
): WorldMapCellViewModel[] {
  const { width } = history.worldMap;
  const polityColors = new Map(
    history.polities.map(({ id, color }) => [id, hexColor(color)] as const),
  );
  return history.worldMap.cells.map(({ terrain, polityId }, index) => ({
    pos: { x: index % width, y: Math.floor(index / width) },
    terrain,
    terrainLabel: TERRAIN_VIEW[terrain].label,
    terrainColor: TERRAIN_VIEW[terrain].color,
    polityId,
    polityColor: polityId === null ? null : (polityColors.get(polityId) ?? null),
    polityAlpha: cellAlpha(polityId, selectedPolityId),
  }));
}

/** Banners come from `history.polities`, the set fixed at world generation, so a nation's colour
 *  never shifts because the live list changed order or lost a member (visual.md §2.1, property 1). */
function bannerColors(history: WorldHistory): Map<string, string> {
  return new Map(
    assignNationBanners(history.polities).map(
      ({ nationId, color }) => [nationId, hexColor(color)] as const,
    ),
  );
}

function buildCities(
  history: WorldHistory,
  selectedPolityId: string | null,
  banners: ReadonlyMap<string, string>,
  cityStates: ReadonlyMap<string, NationCityState>,
): WorldMapCityViewModel[] {
  return history.worldMap.cities.map(({ id, name, pos, polityId, isCapital }) => ({
    id,
    name,
    pos,
    polityId,
    bannerColor: banners.get(polityId) ?? hexColor(MAP_CITY_FILL_COLOR),
    isCapital,
    isHighlighted: polityId === selectedPolityId,
    glyph: chronicleCityGlyph(cityStates.get(id) ?? null, { isCapital }),
  }));
}

function buildTerritoryEdges(
  history: WorldHistory,
  banners: ReadonlyMap<string, string>,
): WorldMapTerritoryEdgeViewModel[] {
  return extractTerritoryEdges(history.worldMap).map((edge) => ({
    ...edge,
    bannerColor: banners.get(edge.polityId) ?? hexColor(MAP_CITY_FILL_COLOR),
  }));
}

function buildRoutes(
  history: WorldHistory,
  selectedPolityId: string | null,
): WorldMapRouteViewModel[] {
  const cities = new Map(history.worldMap.cities.map((city) => [city.id, city]));
  return history.worldMap.tradeRoutes.flatMap(({ id, cityIds }) => {
    const from = cities.get(cityIds[0]);
    const to = cities.get(cityIds[1]);
    if (from === undefined || to === undefined) return [];
    return [
      {
        id,
        from: from.pos,
        to: to.pos,
        isHighlighted: from.polityId === selectedPolityId || to.polityId === selectedPolityId,
      },
    ];
  });
}

/**
 * `cityStates` is optional because the chronicle map has no nation state to give it: the live host
 * that carries one arrives with the world map's own surface. Cities without it draw at the smallest
 * tier. Pass `nations.flatMap(({ cities }) => cities)` once there is a nation snapshot to hand.
 */
export function buildWorldMapViewModel(
  history: WorldHistory,
  selectedPolityId: string | null,
  cityStates: readonly NationCityState[] = [],
): WorldMapViewModel {
  const banners = bannerColors(history);
  return {
    width: history.worldMap.width,
    height: history.worldMap.height,
    cells: buildCells(history, selectedPolityId),
    cities: buildCities(
      history,
      selectedPolityId,
      banners,
      new Map(cityStates.map((state) => [state.cityId, state] as const)),
    ),
    territoryEdges: buildTerritoryEdges(history, banners),
    tradeRoutes: buildRoutes(history, selectedPolityId),
    settlement: {
      pos: history.worldMap.settlementFrontierPos,
      label: "現在地",
    },
    selectedPolityId,
  };
}

export function worldMapPositionFromPointer(
  view: WorldMapViewModel,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  clientX: number,
  clientY: number,
): Position | null {
  const relativeX = clientX - bounds.left;
  const relativeY = clientY - bounds.top;
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    relativeX < 0 ||
    relativeY < 0 ||
    relativeX >= bounds.width ||
    relativeY >= bounds.height
  ) {
    return null;
  }
  return {
    x: Math.floor((relativeX / bounds.width) * view.width),
    y: Math.floor((relativeY / bounds.height) * view.height),
  };
}

export function polityIdAtWorldMapPosition(view: WorldMapViewModel, pos: Position): string | null {
  if (
    !Number.isInteger(pos.x) ||
    !Number.isInteger(pos.y) ||
    pos.x < 0 ||
    pos.y < 0 ||
    pos.x >= view.width ||
    pos.y >= view.height
  ) {
    return null;
  }
  const cell = view.cells[pos.y * view.width + pos.x];
  return cell?.terrain === "sea" ? null : (cell?.polityId ?? null);
}

function cellOrigin(pos: Position): Position {
  return {
    x: pos.x * WORLD_MAP_CELL_SIZE_PX,
    y: pos.y * WORLD_MAP_CELL_SIZE_PX,
  };
}

function cellCenter(pos: Position): Position {
  const origin = cellOrigin(pos);
  return {
    x: origin.x + WORLD_MAP_CELL_SIZE_PX / 2,
    y: origin.y + WORLD_MAP_CELL_SIZE_PX / 2,
  };
}

function drawTerrain(context: CanvasRenderingContext2D, view: WorldMapViewModel): void {
  for (const cell of view.cells) {
    const origin = cellOrigin(cell.pos);
    context.fillStyle = cell.terrainColor;
    context.fillRect(origin.x, origin.y, WORLD_MAP_CELL_SIZE_PX, WORLD_MAP_CELL_SIZE_PX);
  }
}

function drawPolityOverlays(
  context: CanvasRenderingContext2D,
  cells: WorldMapCellViewModel[],
): void {
  const previousAlpha = context.globalAlpha;
  for (const cell of cells) {
    if (cell.polityColor === null) continue;
    const origin = cellOrigin(cell.pos);
    context.globalAlpha = cell.polityAlpha;
    context.fillStyle = cell.polityColor;
    context.fillRect(origin.x, origin.y, WORLD_MAP_CELL_SIZE_PX, WORLD_MAP_CELL_SIZE_PX);
  }
  context.globalAlpha = previousAlpha;
}

/** 1 px at the 6 px chronicle cell (visual.md §2.7); the playable surface uses 2 px. */
const BORDER_WIDTH_PX = 1;
const CASING_WIDTH_PX = 1;
const CASING_ALPHA = 0.55;

/**
 * The rectangle to fill for one edge. `fillRect` rather than `stroke` because a stroked path centres
 * on the line and lands on half pixels, which at a 6 px cell blurs the only identity channel there is.
 */
function edgeRect(
  edge: WorldMapTerritoryEdgeViewModel,
  width: number,
  outward: boolean,
): [number, number, number, number] {
  const origin = cellOrigin(edge.pos);
  const cell = WORLD_MAP_CELL_SIZE_PX;
  // A band either just inside the cell's own side, or just outside it for the casing behind it.
  const near = outward ? -width : 0;
  const far = outward ? cell : cell - width;
  switch (edge.side) {
    case "top":
      return [origin.x, origin.y + near, cell, width];
    case "bottom":
      return [origin.x, origin.y + far, cell, width];
    case "left":
      return [origin.x + near, origin.y, width, cell];
    default:
      return [origin.x + far, origin.y, width, cell];
  }
}

/**
 * The slice of the 2D context the border pass actually uses. Narrowed to these three so the geometry
 * below can be tested without a canvas, which is the only channel this map's identity travels on.
 */
export type BorderPaintContext = Pick<
  CanvasRenderingContext2D,
  "fillRect" | "fillStyle" | "globalAlpha"
>;

/**
 * Casing first, then every border, so a neighbour's casing can never land on top of a banner. Both
 * are separate passes over the edge list for the same reason `renderWorldMapCanvas` is layered.
 */
export function drawTerritoryBorders(
  context: BorderPaintContext,
  edges: readonly WorldMapTerritoryEdgeViewModel[],
): void {
  const previousAlpha = context.globalAlpha;
  context.globalAlpha = CASING_ALPHA;
  context.fillStyle = hexColor(MAP_CASING_COLOR);
  for (const edge of edges) {
    if (!edge.hasCasing) continue;
    const [x, y, width, height] = edgeRect(edge, CASING_WIDTH_PX, true);
    context.fillRect(x, y, width, height);
  }
  context.globalAlpha = previousAlpha;

  for (const edge of edges) {
    context.fillStyle = edge.bannerColor;
    const [x, y, width, height] = edgeRect(edge, BORDER_WIDTH_PX, false);
    context.fillRect(x, y, width, height);
  }
}

function drawRoutes(context: CanvasRenderingContext2D, view: WorldMapViewModel): void {
  context.lineCap = "round";
  for (const route of view.tradeRoutes) {
    const from = cellCenter(route.from);
    const to = cellCenter(route.to);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = route.isHighlighted ? "#fff176" : "#c8b88a";
    context.lineWidth = route.isHighlighted ? 2 : 1;
    context.stroke();
  }
}

/** A diamond marks a capital, which frees the radius to mean population honestly (visual.md §2.3). */
function traceCityGlyph(
  context: CanvasRenderingContext2D,
  center: Position,
  glyph: CityGlyph,
): void {
  context.beginPath();
  if (glyph.shape === "circle") {
    context.arc(center.x, center.y, glyph.radiusPx, 0, Math.PI * 2);
    return;
  }
  context.moveTo(center.x, center.y - glyph.radiusPx);
  context.lineTo(center.x + glyph.radiusPx, center.y);
  context.lineTo(center.x, center.y + glyph.radiusPx);
  context.lineTo(center.x - glyph.radiusPx, center.y);
  context.closePath();
}

function drawCities(context: CanvasRenderingContext2D, view: WorldMapViewModel): void {
  for (const city of view.cities) {
    traceCityGlyph(context, cellCenter(city.pos), city.glyph);
    context.fillStyle = city.isHighlighted ? hexColor(MAP_ACCENT_COLOR) : city.bannerColor;
    context.fill();
    // The casing is what keeps a banner colour legible on any terrain — visual.md §2.2.2.
    context.strokeStyle = hexColor(MAP_CASING_COLOR);
    context.lineWidth = city.glyph.ringWidthPx;
    context.stroke();
  }
}

function drawSettlement(context: CanvasRenderingContext2D, view: WorldMapViewModel): void {
  const center = cellCenter(view.settlement.pos);
  const radius = WORLD_MAP_SETTLEMENT_RADIUS_PX;
  context.beginPath();
  context.moveTo(center.x, center.y - radius);
  context.lineTo(center.x + radius, center.y);
  context.lineTo(center.x, center.y + radius);
  context.lineTo(center.x - radius, center.y);
  context.closePath();
  context.fillStyle = "#f0d57b";
  context.fill();
  context.strokeStyle = "#141b1e";
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  context.moveTo(center.x - radius, center.y - radius);
  context.lineTo(center.x + radius, center.y + radius);
  context.moveTo(center.x + radius, center.y - radius);
  context.lineTo(center.x - radius, center.y + radius);
  context.strokeStyle = "#fff8dc";
  context.stroke();

  context.fillStyle = "#fff8dc";
  context.textBaseline = "middle";
  context.fillText(view.settlement.label, center.x + radius * 2, center.y);
}

export function renderWorldMapCanvas(canvas: HTMLCanvasElement, view: WorldMapViewModel): void {
  canvas.width = view.width * WORLD_MAP_CELL_SIZE_PX;
  canvas.height = view.height * WORLD_MAP_CELL_SIZE_PX;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.imageSmoothingEnabled = false;
  drawTerrain(context, view);
  drawPolityOverlays(context, view.cells);
  drawTerritoryBorders(context, view.territoryEdges);
  drawRoutes(context, view);
  drawCities(context, view);
  drawSettlement(context, view);
}
