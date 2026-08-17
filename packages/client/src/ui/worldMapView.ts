import {
  type NationCityState,
  type Position,
  WORLD_MAP_CELL_SIZE_PX,
  WORLD_MAP_PLAYER_POLITY_ALPHA,
  WORLD_MAP_POLITY_ALPHA,
  WORLD_MAP_SELECTED_POLITY_ALPHA,
  WORLD_MAP_SETTLEMENT_RADIUS_PX,
  type WorldHistory,
  type WorldMapTerrain,
} from "@agent-town/shared";

import {
  MAP_ACCENT_COLOR,
  MAP_CASING_COLOR,
  MAP_CITY_FILL_COLOR,
  MAP_PLAYER_INNER_RULE_COLOR,
} from "../render/colors.js";
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
  /** Whether this cell belongs to the nation the player holds. False for every cell when nobody does. */
  isPlayer: boolean;
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
  /** Whether this city belongs to the player's own nation — the capital cross-hatch's input (visual.md
   *  §2.6). Only meaningful together with `isCapital`; a non-capital city never draws it. */
  isPlayer: boolean;
  /** Population tier, capital shape and the development ratio, decided in `worldCityViewModel`. */
  glyph: CityGlyph;
}

/** An outline edge with the colour to paint it in, so the paint pass makes no colour decisions. */
export interface WorldMapTerritoryEdgeViewModel extends TerritoryEdge {
  bannerColor: string;
  /** Whether this edge belongs to the player's own territory — the inner rule's input (visual.md §2.6).
   *  Independent of `hasCasing`: the inner rule draws at a nation-nation frontier too. */
  isPlayer: boolean;
}

export interface WorldMapRouteViewModel {
  id: string;
  from: Position;
  to: Position;
  isHighlighted: boolean;
}

/**
 * Who the map is drawn *for*, as opposed to what is momentarily under the pointer. The player's nation
 * is a resting state that lasts a session; a hover is transient and universal — it applies to any
 * nation, including rivals (visual.md §2.2.1's equality principle). Keeping the two fields apart is what
 * stops a persistent, singular fact from being read as a transient, universal one at a call site.
 */
export interface WorldMapMarks {
  /**
   * The polity the player holds. `NationWorldState` calls the same id `playerNationId`; on the map every
   * owner is a `polityId`, so it takes the map's vocabulary here. Null marks no nation at all.
   */
  playerPolityId: string | null;
  /**
   * The polity currently under the pointer, or null when nothing is hovered. Null the instant the
   * pointer leaves — there is no resting hover, only the player's own resting mark (visual.md §2.2.1).
   */
  hoveredPolityId: string | null;
}

const NO_MARKS: WorldMapMarks = { playerPolityId: null, hoveredPolityId: null };

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
}

export function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/**
 * Hover outranks the player step, and both outrank the resting alpha. Not because one mark of ownership
 * beats another — they are not competing marks of ownership at all. Hover is transient and universal: it
 * answers "what is under the pointer right now" for any nation, including the player's own, and a player
 * hovering their own territory still needs that answer or "which cells are theirs" would go unanswered
 * for the one nation they are most likely to point at. The player step is persistent and singular — it
 * marks one nation for the whole session regardless of the pointer — so the two never have anything to
 * trade; hover simply wins when both are true of the same cell.
 */
function cellAlpha(
  polityId: string | null,
  hoveredPolityId: string | null,
  playerPolityId: string | null,
): number {
  if (polityId === null) return 0;
  if (polityId === hoveredPolityId) return WORLD_MAP_SELECTED_POLITY_ALPHA;
  return polityId === playerPolityId ? WORLD_MAP_PLAYER_POLITY_ALPHA : WORLD_MAP_POLITY_ALPHA;
}

/**
 * The fill takes the **banner** colour, not the archival `Polity.color` it used to. The archival values
 * are muted for large flat areas and collide across worlds (visual.md §1.3), so the wash was the one
 * surface still carrying a colour the identity channel had already abandoned.
 */
function buildCells(
  history: WorldHistory,
  hoveredPolityId: string | null,
  banners: ReadonlyMap<string, string>,
  playerPolityId: string | null,
): WorldMapCellViewModel[] {
  const { width } = history.worldMap;
  return history.worldMap.cells.map(({ terrain, polityId }, index) => ({
    pos: { x: index % width, y: Math.floor(index / width) },
    terrain,
    terrainLabel: TERRAIN_VIEW[terrain].label,
    terrainColor: TERRAIN_VIEW[terrain].color,
    polityId,
    polityColor: polityId === null ? null : (banners.get(polityId) ?? null),
    polityAlpha: cellAlpha(polityId, hoveredPolityId, playerPolityId),
    isPlayer: polityId !== null && polityId === playerPolityId,
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
  hoveredPolityId: string | null,
  banners: ReadonlyMap<string, string>,
  cityStates: ReadonlyMap<string, NationCityState>,
  playerPolityId: string | null,
): WorldMapCityViewModel[] {
  return history.worldMap.cities.map(({ id, name, pos, polityId, isCapital }) => ({
    id,
    name,
    pos,
    polityId,
    bannerColor: banners.get(polityId) ?? hexColor(MAP_CITY_FILL_COLOR),
    isCapital,
    isHighlighted: polityId === hoveredPolityId,
    isPlayer: polityId === playerPolityId,
    glyph: chronicleCityGlyph(cityStates.get(id) ?? null, { isCapital }),
  }));
}

function buildTerritoryEdges(
  history: WorldHistory,
  banners: ReadonlyMap<string, string>,
  playerPolityId: string | null,
): WorldMapTerritoryEdgeViewModel[] {
  return extractTerritoryEdges(history.worldMap).map((edge) => ({
    ...edge,
    bannerColor: banners.get(edge.polityId) ?? hexColor(MAP_CITY_FILL_COLOR),
    isPlayer: edge.polityId === playerPolityId,
  }));
}

function buildRoutes(
  history: WorldHistory,
  hoveredPolityId: string | null,
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
        isHighlighted: from.polityId === hoveredPolityId || to.polityId === hoveredPolityId,
      },
    ];
  });
}

/**
 * `cityStates` is optional because the chronicle map has no nation state to give it: the live host
 * that carries one arrives with the world map's own surface. Cities without it draw at the smallest
 * tier. Pass `nations.flatMap(({ cities }) => cities)` once there is a nation snapshot to hand.
 *
 * `marks` carries both the player's resting state and the pointer's transient one, since neither is a
 * bare string parameter's job: `playerPolityId` lasts a session, `hoveredPolityId` lasts as long as the
 * pointer sits still, and a lone positional string could not tell a caller which one it was setting.
 */
export function buildWorldMapViewModel(
  history: WorldHistory,
  cityStates: readonly NationCityState[] = [],
  marks: WorldMapMarks = NO_MARKS,
): WorldMapViewModel {
  const banners = bannerColors(history);
  const { playerPolityId, hoveredPolityId } = marks;
  return {
    width: history.worldMap.width,
    height: history.worldMap.height,
    cells: buildCells(history, hoveredPolityId, banners, playerPolityId),
    cities: buildCities(
      history,
      hoveredPolityId,
      banners,
      new Map(cityStates.map((state) => [state.cityId, state] as const)),
      playerPolityId,
    ),
    territoryEdges: buildTerritoryEdges(history, banners, playerPolityId),
    tradeRoutes: buildRoutes(history, hoveredPolityId),
    settlement: {
      pos: history.worldMap.settlementFrontierPos,
      label: "現在地",
    },
  };
}

/**
 * The minimal grid shape either resolver below needs. Narrowed rather than `WorldMapViewModel` itself so
 * a caller can resolve a position straight off the raw `WorldHistory["worldMap"]` — hover fires on every
 * `pointermove`, dozens of times a second, and building the styled view model (banner colours, city
 * glyphs, territory edges) just to hit-test a cell would be wasted work. The full view model still
 * satisfies this shape, so every existing caller is unaffected.
 */
interface WorldMapGrid {
  width: number;
  height: number;
}

interface PolityLookupGrid extends WorldMapGrid {
  cells: readonly { terrain: WorldMapTerrain; polityId: string | null }[];
}

export function worldMapPositionFromPointer(
  view: WorldMapGrid,
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

export function polityIdAtWorldMapPosition(view: PolityLookupGrid, pos: Position): string | null {
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
/** visual.md §2.6: one band further in than the banner, on the player's own edges only. */
const INNER_RULE_WIDTH_PX = 1;
const INNER_RULE_ALPHA = 0.85;

/**
 * The rectangle to fill for one edge, offset `insetPx` from the cell's own side. `fillRect` rather than
 * `stroke` because a stroked path centres on the line and lands on half pixels, which at a 6 px cell
 * blurs the only identity channel there is. Negative sits outside the cell (the casing), zero sits
 * flush with the cell's own side (the banner), positive sits further inside it (the player's inner
 * rule, one band past the banner).
 */
function edgeRect(
  edge: WorldMapTerritoryEdgeViewModel,
  width: number,
  insetPx: number,
): [number, number, number, number] {
  const origin = cellOrigin(edge.pos);
  const cell = WORLD_MAP_CELL_SIZE_PX;
  const near = insetPx;
  const far = cell - width - insetPx;
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
    const [x, y, width, height] = edgeRect(edge, CASING_WIDTH_PX, -CASING_WIDTH_PX);
    context.fillRect(x, y, width, height);
  }
  context.globalAlpha = previousAlpha;

  for (const edge of edges) {
    context.fillStyle = edge.bannerColor;
    const [x, y, width, height] = edgeRect(edge, BORDER_WIDTH_PX, 0);
    context.fillRect(x, y, width, height);
  }

  // The player's own edges get a second, warm-white line one band past the banner — visual.md §2.6's
  // "key move". Unconditioned on `hasCasing`: it is what still separates the player's border at a
  // nation-nation frontier, where there is never any casing.
  context.globalAlpha = INNER_RULE_ALPHA;
  context.fillStyle = hexColor(MAP_PLAYER_INNER_RULE_COLOR);
  for (const edge of edges) {
    if (!edge.isPlayer) continue;
    const [x, y, width, height] = edgeRect(edge, INNER_RULE_WIDTH_PX, BORDER_WIDTH_PX);
    context.fillRect(x, y, width, height);
  }
  context.globalAlpha = previousAlpha;
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

/**
 * The player's capital gets a cross over its diamond — the same idiom `drawSettlement` already uses for
 * 現在地 (visual.md §2.6), reusing its exact geometry with the glyph's own radius in place of the fixed
 * settlement radius. It is what frees the diamond shape to mean "capital" while this mark alone means
 * "the player's own capital"; a rival's capital stays a plain diamond.
 */
function drawCapitalCrossHatch(
  context: CanvasRenderingContext2D,
  center: Position,
  glyph: CityGlyph,
): void {
  const radius = glyph.radiusPx;
  context.beginPath();
  context.moveTo(center.x - radius, center.y - radius);
  context.lineTo(center.x + radius, center.y + radius);
  context.moveTo(center.x + radius, center.y - radius);
  context.lineTo(center.x - radius, center.y + radius);
  context.strokeStyle = hexColor(MAP_PLAYER_INNER_RULE_COLOR);
  context.lineWidth = 1;
  context.stroke();
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
    if (city.isCapital && city.isPlayer) {
      drawCapitalCrossHatch(context, cellCenter(city.pos), city.glyph);
    }
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
