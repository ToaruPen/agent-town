import {
  type NationCityState,
  type NationState,
  type Position,
  type Season,
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
import { seasonGroundTint } from "../render/sprites.js";
import { type CityGlyph, chronicleCityGlyph } from "./worldCityViewModel.js";
import {
  TERRITORY_CHANGE_FLASH_PEAK_ALPHA,
  territoryChangePhase,
} from "./worldMapChangeViewModel.js";
import { cityConstructionProgress } from "./worldMapConstructionViewModel.js";
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
  /** visual.md §2.4: the recent-change hatch's own alpha for this instant, 0 outside its window. While
   *  this is above 0 (or while a flash is live), `polityColor` is the tracked change's own banner, not
   *  necessarily the colour a plain lookup of `polityId` would give — see `WorldMapMarks.territoryChanges`. */
  recentChangeHatchAlpha: number;
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
  /**
   * Whether this city's local view is the one currently docked beside the map (traversal.md §2.2). The
   * continuity cue: both surfaces are visible at once and no transition carries the player's place for
   * them, so the map has to say it instead.
   */
  isOpen: boolean;
  /** Population tier, capital shape and the development ratio, decided in `worldCityViewModel`. */
  glyph: CityGlyph;
  /** visual.md §2.4: the progress arc's own fraction, 0..1, or null when no active directive targets
   *  this city. Deliberately not animated — it only ever advances once per season resolution. */
  constructionProgress: number | null;
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
 * What the host's own accumulator tracks per changed cell index (visual.md §2.4), fed in through
 * `WorldMapMarks.territoryChanges`. `polityId` is the wire's own new owner (`WorldCellChange.polityId`),
 * not derived from `WorldHistory`: `history.worldMap.cells` only refreshes on a `welcome`, so a change
 * can still be live before the cell's own resting fields have caught up to it.
 */
export interface TrackedTerritoryChange {
  polityId: string | null;
  changeTick: number;
}

/**
 * Layer 2's own wash (visual.md §2.4). `season` is the resting colour to fill toward, or null when this
 * surface has no season to report at all — the chronicle's static archive mount, which has no live clock
 * and must not invent one just to satisfy this field; the paint layer draws nothing in that case rather
 * than guessing. `previousSeason`/`crossfadeProgress` are either both null (settled, single fill) or both
 * present (a live 600 ms wall-clock crossfade, `previousSeason` fading out as `season` fades in). The host
 * is the only owner of the clock that produces `crossfadeProgress` — this module only ever turns it into a
 * frame, the same idiom `pulsePhase` already uses for the locate pulse.
 */
export interface WorldMapSeasonWash {
  season: Season | null;
  previousSeason: Season | null;
  crossfadeProgress: number | null;
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
  /**
   * Progress through the on-demand locate pulse (visual.md §2.6), from 0 to 1 across its 500 ms
   * wall-clock span, or null when no pulse is live. A plain number like every other field here — the
   * host computes it fresh from its own animation deadline on every paint, so this module only ever
   * turns a phase into a frame and never touches the clock that produced it.
   */
  pulsePhase: number | null;
  /**
   * The city id the docked local view currently shows, or null while it is closed. Independent of
   * `playerPolityId`: the player step marks a whole nation for the session, this marks the one city
   * (always the player's own, in N1) whose local view is on screen right now.
   */
  openCityId: string | null;
  /**
   * The current tick — the input every phase in `worldMapChangeViewModel.ts` is a pure function of, and
   * also the recent-change hatch's own moving `onStripe` phase (visual.md §2.2.3/§2.4). A plain number
   * like `pulsePhase`: the host reads it fresh from the payload that arrived, and this module only ever
   * turns it into a frame.
   */
  tick: number;
  /**
   * Territory changes the host is still animating, keyed by cell index (visual.md §2.4). Accumulated by
   * the host from the wire's own per-season delta (`WorldCellChange`) and pruned once each entry's own
   * window has fully decayed — never re-derived here by diffing `history` against a previous snapshot, or
   * a coalesced update would silently lose a flash.
   */
  territoryChanges: ReadonlyMap<number, TrackedTerritoryChange>;
  /**
   * Every living nation's own state (visual.md §2.4's construction-progress arc reads `activeDirectives`
   * from here, per city). Not narrowed further: a city's owning nation is only known once its cities are
   * being built, so `buildCities` does that lookup itself rather than a caller pre-joining the two.
   * Empty means no city ever shows a progress arc, which is what the chronicle's static host mount wants.
   */
  nations: readonly NationState[];
  /** The layer-2 season wash (visual.md §2.4) — the host's own wall-clock crossfade, already resolved
   *  to a number by the time it reaches this module, the same idiom `pulsePhase` uses. */
  seasonWash: WorldMapSeasonWash;
}

const NO_MARKS: WorldMapMarks = {
  playerPolityId: null,
  hoveredPolityId: null,
  pulsePhase: null,
  openCityId: null,
  tick: 0,
  territoryChanges: new Map(),
  nations: [],
  seasonWash: { season: null, previousSeason: null, crossfadeProgress: null },
};

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
  /** See `WorldMapMarks.pulsePhase` — carried through unchanged for `drawTerritoryBorders`. */
  pulsePhase: number | null;
  /** See `WorldMapMarks.tick` — carried through unchanged for the recent-change hatch's moving phase. */
  tick: number;
  /** See `WorldMapMarks.seasonWash` — carried through unchanged for `drawSeasonWash`. */
  seasonWash: WorldMapSeasonWash;
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

interface CellChangeVisuals {
  polityColor: string | null;
  polityAlpha: number;
  recentChangeHatchAlpha: number;
}

/**
 * Resolves what a cell's territory layers paint this tick, given its resting fill and whatever change the
 * host is still tracking for it. A cell with no tracked change, or one whose new owner is null (no banner
 * to flash or hatch into — visual.md §2.4 has no stated treatment for a cell changing to unowned, and
 * suppressing the mark is the safe reading), just reproduces its resting fill unchanged.
 */
function cellChangeVisuals(
  restingColor: string | null,
  restingAlpha: number,
  tracked: TrackedTerritoryChange | undefined,
  banners: ReadonlyMap<string, string>,
  tick: number,
  index: number,
): CellChangeVisuals {
  const resting: CellChangeVisuals = {
    polityColor: restingColor,
    polityAlpha: restingAlpha,
    recentChangeHatchAlpha: 0,
  };
  if (tracked === undefined || tracked.polityId === null) return resting;
  const changeColor = banners.get(tracked.polityId) ?? null;
  if (changeColor === null) return resting;

  const phase = territoryChangePhase(tick, tracked.changeTick, index);
  if (phase.flashProgress !== null) {
    // visual.md:825's two-step respecification: full strength for the whole window, not a decay — see
    // `territoryChangePhase`'s own comment for why the phase math no longer hands back a fraction to
    // blend toward `restingAlpha` here.
    return {
      polityColor: changeColor,
      polityAlpha: TERRITORY_CHANGE_FLASH_PEAK_ALPHA,
      recentChangeHatchAlpha: 0,
    };
  }
  if (phase.hatchAlpha > 0) {
    return {
      polityColor: changeColor,
      polityAlpha: restingAlpha,
      recentChangeHatchAlpha: phase.hatchAlpha,
    };
  }
  return resting;
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
  tick: number,
  territoryChanges: ReadonlyMap<number, TrackedTerritoryChange>,
): WorldMapCellViewModel[] {
  const { width } = history.worldMap;
  return history.worldMap.cells.map(({ terrain, polityId }, index) => {
    const restingColor = polityId === null ? null : (banners.get(polityId) ?? null);
    const restingAlpha = cellAlpha(polityId, hoveredPolityId, playerPolityId);
    const visuals = cellChangeVisuals(
      restingColor,
      restingAlpha,
      territoryChanges.get(index),
      banners,
      tick,
      index,
    );
    return {
      pos: { x: index % width, y: Math.floor(index / width) },
      terrain,
      terrainLabel: TERRAIN_VIEW[terrain].label,
      terrainColor: TERRAIN_VIEW[terrain].color,
      polityId,
      polityColor: visuals.polityColor,
      polityAlpha: visuals.polityAlpha,
      recentChangeHatchAlpha: visuals.recentChangeHatchAlpha,
    };
  });
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

/** Every nation's `activeDirectives`, keyed by its own id — `buildCities` looks a city's own owning
 *  nation up here rather than a caller pre-joining the two, so one nation's directives can never leak
 *  onto a rival's city glyph by accident. */
function directivesByPolityId(
  nations: readonly NationState[],
): Map<string, NationState["activeDirectives"]> {
  return new Map(nations.map((nation) => [nation.id, nation.activeDirectives] as const));
}

function buildCities(
  history: WorldHistory,
  hoveredPolityId: string | null,
  banners: ReadonlyMap<string, string>,
  cityStates: ReadonlyMap<string, NationCityState>,
  playerPolityId: string | null,
  openCityId: string | null,
  nations: readonly NationState[],
): WorldMapCityViewModel[] {
  const directives = directivesByPolityId(nations);
  return history.worldMap.cities.map(({ id, name, pos, polityId, isCapital }) => ({
    id,
    name,
    pos,
    polityId,
    bannerColor: banners.get(polityId) ?? hexColor(MAP_CITY_FILL_COLOR),
    isCapital,
    isHighlighted: polityId === hoveredPolityId,
    isPlayer: polityId === playerPolityId,
    isOpen: id === openCityId,
    glyph: chronicleCityGlyph(cityStates.get(id) ?? null, { isCapital }),
    constructionProgress: cityConstructionProgress(directives.get(polityId) ?? [], id, isCapital),
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
  const {
    playerPolityId,
    hoveredPolityId,
    pulsePhase,
    openCityId,
    tick,
    territoryChanges,
    nations,
    seasonWash,
  } = marks;
  return {
    width: history.worldMap.width,
    height: history.worldMap.height,
    cells: buildCells(history, hoveredPolityId, banners, playerPolityId, tick, territoryChanges),
    cities: buildCities(
      history,
      hoveredPolityId,
      banners,
      new Map(cityStates.map((state) => [state.cityId, state] as const)),
      playerPolityId,
      openCityId,
      nations,
    ),
    territoryEdges: buildTerritoryEdges(history, banners, playerPolityId),
    tradeRoutes: buildRoutes(history, hoveredPolityId),
    settlement: {
      pos: history.worldMap.settlementFrontierPos,
      label: "現在地",
    },
    pulsePhase,
    tick,
    seasonWash,
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

/** visual.md §2.4: "The wash is not free, and 0.10 is the budget." The first thing to reduce if terrain
 *  reading proves too weak — see 0.06's own note in the design doc — not the territory fill, which is
 *  carrying more information. */
export const SEASON_WASH_ALPHA = 0.1;

/**
 * Layer 2 (visual.md §2.2/§2.4): one flat wash across the whole map in the current season's own tint,
 * reusing `SEASON_GROUND_TINTS` rather than a second palette. A live crossfade splits the same 0.10
 * budget between the previous season fading out and the new one fading in, so the wash never reads
 * brighter mid-crossfade than it does at rest on either side of it.
 */
function drawSeasonWash(context: CanvasRenderingContext2D, view: WorldMapViewModel): void {
  const { season, previousSeason, crossfadeProgress } = view.seasonWash;
  if (season === null) return;
  const previousAlpha = context.globalAlpha;
  const width = view.width * WORLD_MAP_CELL_SIZE_PX;
  const height = view.height * WORLD_MAP_CELL_SIZE_PX;
  if (previousSeason !== null && crossfadeProgress !== null) {
    context.globalAlpha = SEASON_WASH_ALPHA * (1 - crossfadeProgress);
    context.fillStyle = hexColor(seasonGroundTint(previousSeason));
    context.fillRect(0, 0, width, height);
    context.globalAlpha = SEASON_WASH_ALPHA * crossfadeProgress;
    context.fillStyle = hexColor(seasonGroundTint(season));
    context.fillRect(0, 0, width, height);
    context.globalAlpha = previousAlpha;
    return;
  }
  context.globalAlpha = SEASON_WASH_ALPHA;
  context.fillStyle = hexColor(seasonGroundTint(season));
  context.fillRect(0, 0, width, height);
  context.globalAlpha = previousAlpha;
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

/**
 * visual.md §2.2.3: hatch a cell when its diagonal band index falls on the stripe. §2.4 reuses this same
 * function for the recent-change hatch with a moving `phase`, in place of the contested hatch's static 0.
 */
function onStripe(cx: number, cy: number, phase: number): boolean {
  return (cx + cy + phase) % 4 === 0;
}

const RECENT_CHANGE_HATCH_LINE_WIDTH_PX = 1;

/** Layer 5 (visual.md §2.2/§2.4): a diagonal 1 px line per stripe-selected changed cell, in that cell's
 *  own tracked banner colour, at its own decaying alpha. */
function drawRecentChangeHatch(
  context: CanvasRenderingContext2D,
  cells: readonly WorldMapCellViewModel[],
  tick: number,
): void {
  const previousAlpha = context.globalAlpha;
  context.lineWidth = RECENT_CHANGE_HATCH_LINE_WIDTH_PX;
  for (const cell of cells) {
    if (cell.recentChangeHatchAlpha <= 0 || cell.polityColor === null) continue;
    if (!onStripe(cell.pos.x, cell.pos.y, tick)) continue;
    const origin = cellOrigin(cell.pos);
    context.globalAlpha = cell.recentChangeHatchAlpha;
    context.strokeStyle = cell.polityColor;
    context.beginPath();
    context.moveTo(origin.x, origin.y + WORLD_MAP_CELL_SIZE_PX);
    context.lineTo(origin.x + WORLD_MAP_CELL_SIZE_PX, origin.y);
    context.stroke();
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
/** The locate pulse's peak values (visual.md §2.6): full alpha, and the band widened by one pixel to
 *  reach the banner while keeping its own resting position — see the expansion note below. */
const PULSE_ALPHA_PEAK = 1;
const PULSE_EXPANSION_PX = 1;

/**
 * A symmetric rise and fall: 0 at either end of the pulse, 1 at its midpoint. Pure in `phase` alone, so
 * the paint layer below never needs the clock that produced it — the same phase always paints the same
 * frame, the constraint every other visual channel in this module already holds.
 */
function pulseEnvelope(phase: number): number {
  return 1 - Math.abs(phase * 2 - 1);
}

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
  pulsePhase: number | null = null,
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
  //
  // A live locate pulse rides on top of that resting line rather than replacing it: `pulseEnvelope`
  // is 0 at either end of the 500 ms span, so a null or completed pulse reproduces the resting values
  // exactly, and only a live one bends the alpha, inset and width toward the peak partway through.
  //
  // The inset shrinks and the width grows by the same amount, so the band's far edge — the resting
  // rule's own inward side — stays fixed while the near edge reaches out to meet the banner. That is
  // what "expansion" means here: at the peak the rule spans both its own resting band and the banner's
  // band as one 2 px mark, rather than relocating a same-size 1 px mark from one to the other.
  const pulse = pulsePhase === null ? 0 : pulseEnvelope(pulsePhase);
  context.globalAlpha = INNER_RULE_ALPHA + pulse * (PULSE_ALPHA_PEAK - INNER_RULE_ALPHA);
  context.fillStyle = hexColor(MAP_PLAYER_INNER_RULE_COLOR);
  for (const edge of edges) {
    if (!edge.isPlayer) continue;
    const [x, y, width, height] = edgeRect(
      edge,
      INNER_RULE_WIDTH_PX + pulse * PULSE_EXPANSION_PX,
      BORDER_WIDTH_PX - pulse * PULSE_EXPANSION_PX,
    );
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

/** One band clear of the casing, so the ring reads as its own mark rather than a thicker casing. */
const OPEN_CITY_RING_GAP_PX = 2;
const OPEN_CITY_RING_WIDTH_PX = 1.5;

/**
 * traversal.md §2.2: the open city is marked as open on the map, the continuity cue for a docked layout
 * where both surfaces stay on screen and no transition carries the player's place for them. Reuses the
 * warm-white the player's own inner rule already claims (visual.md §2.6) — in N1 the docked view only
 * ever targets the player's own capital, so the same "player identity, drawn with a finer pen" idiom
 * applies without inventing a second colour.
 */
function drawOpenCityRing(
  context: CanvasRenderingContext2D,
  center: Position,
  glyph: CityGlyph,
): void {
  context.beginPath();
  context.arc(center.x, center.y, glyph.radiusPx + OPEN_CITY_RING_GAP_PX, 0, Math.PI * 2);
  context.strokeStyle = hexColor(MAP_PLAYER_INNER_RULE_COLOR);
  context.lineWidth = OPEN_CITY_RING_WIDTH_PX;
  context.stroke();
}

const CONSTRUCTION_ARC_WIDTH_PX = 2;
/** Canvas angle 0 is 3 o'clock; 12 o'clock is a quarter turn back from there. Canvas's own increasing-
 *  angle direction is already clockwise, so the sweep needs no sign flip. */
const CONSTRUCTION_ARC_START_ANGLE = -Math.PI / 2;

/**
 * visual.md §2.4: a progress arc on the city's own casing ring, 12 o'clock clockwise, deliberately not
 * animated — it only advances once per season resolution, so it needs no motion to be noticed. Traced at
 * the glyph's own radius (the same path the casing stroke above already follows) rather than offset like
 * the open-city ring, matching "on the city's casing ring" rather than "one band clear of it". Always a
 * circular arc regardless of the glyph's own shape (circle or diamond) — the same "ring overlay drawn
 * independent of glyph shape" idiom `drawOpenCityRing` already uses.
 */
function drawConstructionArc(
  context: CanvasRenderingContext2D,
  center: Position,
  glyph: CityGlyph,
  progress: number,
): void {
  const sweep = Math.min(Math.max(progress, 0), 1) * Math.PI * 2;
  if (sweep <= 0) return;
  context.beginPath();
  context.arc(
    center.x,
    center.y,
    glyph.radiusPx,
    CONSTRUCTION_ARC_START_ANGLE,
    CONSTRUCTION_ARC_START_ANGLE + sweep,
  );
  context.strokeStyle = hexColor(MAP_ACCENT_COLOR);
  context.lineWidth = CONSTRUCTION_ARC_WIDTH_PX;
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
    if (city.isOpen) {
      drawOpenCityRing(context, cellCenter(city.pos), city.glyph);
    }
    if (city.constructionProgress !== null) {
      drawConstructionArc(context, cellCenter(city.pos), city.glyph, city.constructionProgress);
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
  drawSeasonWash(context, view);
  drawPolityOverlays(context, view.cells);
  drawRecentChangeHatch(context, view.cells, view.tick);
  drawTerritoryBorders(context, view.territoryEdges, view.pulsePhase);
  drawRoutes(context, view);
  drawCities(context, view);
  drawSettlement(context, view);
}
