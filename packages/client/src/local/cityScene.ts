import {
  type ActiveDirective,
  type Building,
  type CropStage,
  DAYS_PER_SEASON,
  type DirectiveKind,
  FACILITY_BUILD_TICKS,
  type Facility,
  type Field,
  FOOD_RESOURCE_MAX,
  FOOD_RESOURCE_MIN,
  FOOD_TILE_CHANCE,
  FOREST_TILE_CHANCE,
  HOUSE_BUILD_TICKS,
  MAP_HEIGHT,
  MAP_WIDTH,
  type NationCityState,
  type NationState,
  nationSeasonOfTick,
  type Polity,
  type Position,
  SEASONS,
  TERRAIN_PATCH_SIZE,
  type Terrain,
  TICKS_PER_DAY,
  type Tile,
  TRAIL_LEVEL_WEAR,
  type TrailCell,
  type TrailLevel,
  WOOD_RESOURCE_MAX,
  WOOD_RESOURCE_MIN,
  type WorldCity,
  type WorldHistory,
  type WorldMap,
  type WorldMapTerrain,
  type WorldState,
} from "@agent-town/shared";

import { isVisibleGround } from "../render/trailLayer.js";
import { citySceneSeed, createSceneRng } from "./sceneRng.js";

export interface CitySceneInput {
  city: WorldCity;
  cityState: NationCityState;
  nation: NationState;
  polity: Polity;
  worldMap: WorldMap;
  tick: number;
}

/** `WorldMapTerrain` has five values and `Terrain` four: a hill town and a mountain town look alike. */
const LOCAL_TERRAIN: Readonly<Record<WorldMapTerrain, Terrain>> = {
  sea: "water",
  plains: "plains",
  forest: "forest",
  hills: "rock",
  mountains: "rock",
};

/** The quarter is drawn around its own middle; the city's world position seeds and shapes it. */
const QUARTER_CENTRE: Position = { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) };
/** The city's own cell counts double: the quarter stands on it, the neighbours only surround it. */
const CITY_CELL_TERRAIN_WEIGHT = 2;
const NEIGHBOUR_TERRAIN_WEIGHT = 1;
/** Tiles that resample the mix instead of taking their patch's terrain, so patch edges stay ragged. */
const PATCH_VARIATION_CHANCE = 0.18;
/** Wood cover on a forest cell: denser than open ground, still not an unbroken wall of trunks. */
const FOREST_CELL_WOOD_CHANCE = 0.6;
const STREET_BLOCK_WIDTH = 4;
const STREET_BLOCK_HEIGHT = 3;
/** Blocks laid either way from the store, so the street grid can hold the largest drawn quarter. */
const BLOCK_RANGE = 3;
/** Plots inside one block, staggered so a full block reads as dwellings rather than as a wall. */
const BLOCK_PLOT_OFFSETS: readonly Position[] = [
  { x: 1, y: 1 },
  { x: 2, y: 2 },
  { x: 3, y: 1 },
];
/** Houses the quarter gains per development level. */
const HOUSES_PER_DEVELOPMENT_LEVEL = 6;
/** Residents one drawn house stands for: the view is a representative quarter, not the whole city. */
const RESIDENTS_PER_DRAWN_HOUSE = 50;
/** Cleared ground around the store, so the city's own square reads as a square. */
const PLAZA_RADIUS = 1;
/** Tiles beyond the outermost house the street grid still reaches, enclosing the last block. */
const STREET_MARGIN = 1;

function shift(origin: Position, offset: Position): Position {
  return { x: origin.x + offset.x, y: origin.y + offset.y };
}

/**
 * One reserved tile per directive kind, on the ring just outside the square. `isAlreadyActive` gates
 * a directive per kind and city, so six is every mark one city can need at once, and a `Record` keyed
 * by the kind means a seventh kind would fail this file to compile rather than quietly lack a home.
 *
 * All six sit off the avenues (`dx` and `dy` both non-zero) and are held clear of houses, streets and
 * standing resources, so a mark drawn here lands on bare ground whatever the surrounding terrain.
 *
 * They are spread as far as one ring allows rather than as far as would be ideal: excluding the four
 * avenue tiles leaves twelve, in four corner runs of three, and no more than four of those are
 * pairwise non-adjacent. So two pairs touch diagonally. The three kinds `directive-sprites.md` draws
 * as loose props — timber, festival, and the mine's spoil chunk — are the ones kept three tiles apart,
 * because those are the groups that would read as one heap at 16 px if they met.
 */
const DIRECTIVE_ANCHOR_OFFSETS: Readonly<Record<DirectiveKind, Position>> = {
  developTimber: { x: -2, y: -2 },
  openMine: { x: 1, y: -2 },
  encourageStores: { x: 2, y: -1 },
  growCity: { x: 2, y: 2 },
  clearFarmland: { x: -1, y: 2 },
  holdFestival: { x: -2, y: 1 },
};

/**
 * Where C1-8 may put the mark for each active directive, given the store position the rest of the
 * scene is built around. The single formula every anchor-consuming caller goes through — the module's
 * own bare-ground reservation below, the field and granary placement, and every external caller
 * (`cityViewPanel.ts`, `devCityScene.ts`) — so none of them can drift from what the others reserve.
 */
export function directiveAnchorPositions(
  store: Position,
): Readonly<Record<DirectiveKind, Position>> {
  return {
    clearFarmland: shift(store, DIRECTIVE_ANCHOR_OFFSETS.clearFarmland),
    developTimber: shift(store, DIRECTIVE_ANCHOR_OFFSETS.developTimber),
    openMine: shift(store, DIRECTIVE_ANCHOR_OFFSETS.openMine),
    growCity: shift(store, DIRECTIVE_ANCHOR_OFFSETS.growCity),
    encourageStores: shift(store, DIRECTIVE_ANCHOR_OFFSETS.encourageStores),
    holdFestival: shift(store, DIRECTIVE_ANCHOR_OFFSETS.holdFestival),
  };
}

const ANCHOR_POSITIONS: readonly Position[] = Object.values(
  directiveAnchorPositions(QUARTER_CENTRE),
);

const ANCHOR_KEYS: ReadonlySet<string> = new Set(ANCHOR_POSITIONS.map(({ x, y }) => `${x},${y}`));

function isDirectiveAnchor(pos: Position): boolean {
  return ANCHOR_KEYS.has(`${pos.x},${pos.y}`);
}

/**
 * `targetCityId` is read generically: nothing here special-cases any one `DirectiveKind` by name, so a
 * server change to which kinds carry a target never silently needs a matching client edit. A directive
 * whose `targetCityId` names this city belongs to it, whatever kind it is. A directive with
 * `targetCityId: null` carries no target at all; this view puts it on the capital — a client-side
 * rendering choice this function makes, not a rule `ActiveDirective` itself states.
 */
export function activeDirectivesForCity(
  nation: NationState,
  city: WorldCity,
): readonly ActiveDirective[] {
  return nation.activeDirectives.filter(
    (directive) =>
      directive.targetCityId === city.id || (directive.targetCityId === null && city.isCapital),
  );
}

/** `activeDirectivesForCity` collapsed to kinds, which is all `render/directiveLayer.ts` needs: it
 *  draws a fixed mark per kind, never per directive instance. */
export function activeDirectiveKinds(
  nation: NationState,
  city: WorldCity,
): ReadonlySet<DirectiveKind> {
  return new Set(activeDirectivesForCity(nation, city).map((directive) => directive.kind));
}

function randomInteger(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function isInsideQuarter(pos: Position): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < MAP_WIDTH && pos.y < MAP_HEIGHT;
}

interface TerrainWeight {
  terrain: Terrain;
  weight: number;
}

function worldMapTerrainAt(worldMap: WorldMap, x: number, y: number): Terrain | null {
  if (x < 0 || y < 0 || x >= worldMap.width || y >= worldMap.height) return null;
  const cell = worldMap.cells[y * worldMap.width + x];
  return cell === undefined ? null : LOCAL_TERRAIN[cell.terrain];
}

interface NeighbourhoodCell {
  dx: number;
  dy: number;
  weight: number;
}

/** The nine cells the quarter is laid from: the city's own cell, then the eight around it. */
const NEIGHBOURHOOD: readonly NeighbourhoodCell[] = [
  { dx: 0, dy: 0, weight: CITY_CELL_TERRAIN_WEIGHT },
  { dx: -1, dy: -1, weight: NEIGHBOUR_TERRAIN_WEIGHT },
  { dx: 0, dy: -1, weight: NEIGHBOUR_TERRAIN_WEIGHT },
  { dx: 1, dy: -1, weight: NEIGHBOUR_TERRAIN_WEIGHT },
  { dx: -1, dy: 0, weight: NEIGHBOUR_TERRAIN_WEIGHT },
  { dx: 1, dy: 0, weight: NEIGHBOUR_TERRAIN_WEIGHT },
  { dx: -1, dy: 1, weight: NEIGHBOUR_TERRAIN_WEIGHT },
  { dx: 0, dy: 1, weight: NEIGHBOUR_TERRAIN_WEIGHT },
  { dx: 1, dy: 1, weight: NEIGHBOUR_TERRAIN_WEIGHT },
];

function sampleTerrainMix(worldMap: WorldMap, pos: Position): TerrainWeight[] {
  const weights = new Map<Terrain, number>();
  for (const cell of NEIGHBOURHOOD) {
    const terrain = worldMapTerrainAt(worldMap, pos.x + cell.dx, pos.y + cell.dy);
    if (terrain === null) continue;
    weights.set(terrain, (weights.get(terrain) ?? 0) + cell.weight);
  }
  if (weights.size === 0) weights.set("plains", NEIGHBOUR_TERRAIN_WEIGHT);
  return [...weights].map(([terrain, weight]) => ({ terrain, weight }));
}

function pickTerrain(mix: readonly TerrainWeight[], rng: () => number): Terrain {
  const total = mix.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of mix) {
    roll -= entry.weight;
    if (roll < 0) return entry.terrain;
  }
  return mix[0]?.terrain ?? "plains";
}

function woodedTile(rng: () => number): Tile {
  return {
    terrain: "forest",
    resourceOrigin: "wood",
    resource: { kind: "wood", amount: randomInteger(rng, WOOD_RESOURCE_MIN, WOOD_RESOURCE_MAX) },
  };
}

/** A forest cell is wooded with clearings; open ground carries the lighter scatter of a plains cell. */
function groundTile(terrain: Terrain, rng: () => number): Tile {
  if (terrain === "forest") {
    return rng() < FOREST_CELL_WOOD_CHANCE ? woodedTile(rng) : { terrain, resource: null };
  }
  if (terrain !== "plains") return { terrain, resource: null };
  if (rng() < FOREST_TILE_CHANCE) return woodedTile(rng);
  if (rng() < FOOD_TILE_CHANCE) {
    return {
      terrain: "plains",
      resourceOrigin: "food",
      resource: { kind: "food", amount: randomInteger(rng, FOOD_RESOURCE_MIN, FOOD_RESOURCE_MAX) },
    };
  }
  return { terrain: "plains", resource: null };
}

function createTiles(mix: readonly TerrainWeight[], rng: () => number): Tile[] {
  const patchColumns = Math.ceil(MAP_WIDTH / TERRAIN_PATCH_SIZE);
  const patchRows = Math.ceil(MAP_HEIGHT / TERRAIN_PATCH_SIZE);
  const patches = Array.from({ length: patchColumns * patchRows }, () => pickTerrain(mix, rng));
  const tiles: Tile[] = [];

  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const patchRow = Math.floor(y / TERRAIN_PATCH_SIZE) * patchColumns;
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const patch = patches[patchRow + Math.floor(x / TERRAIN_PATCH_SIZE)] ?? "plains";
      const terrain = rng() < PATCH_VARIATION_CHANCE ? pickTerrain(mix, rng) : patch;
      tiles.push(groundTile(terrain, rng));
    }
  }

  return tiles;
}

function plotCandidates(): Position[] {
  const plots: Position[] = [];
  for (let blockY = -BLOCK_RANGE; blockY <= BLOCK_RANGE; blockY += 1) {
    for (let blockX = -BLOCK_RANGE; blockX <= BLOCK_RANGE; blockX += 1) {
      for (const offset of BLOCK_PLOT_OFFSETS) {
        plots.push({
          x: QUARTER_CENTRE.x + blockX * STREET_BLOCK_WIDTH + offset.x,
          y: QUARTER_CENTRE.y + blockY * STREET_BLOCK_HEIGHT + offset.y,
        });
      }
    }
  }
  return plots;
}

function chebyshevDistance(from: Position, to: Position): number {
  return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
}

/**
 * The square and the directive anchors are the city's own open ground. Without this the nearest
 * plots land diagonally against the store, on top of the props `renderMapLayer` draws beside it.
 */
function isReservedGround(pos: Position): boolean {
  return chebyshevDistance(pos, QUARTER_CENTRE) <= PLAZA_RADIUS || isDirectiveAnchor(pos);
}

/** Plots fill outward from the store, shuffled within each ring, so growth reads as growth. */
function choosePlots(count: number, rng: () => number): Position[] {
  return plotCandidates()
    .filter((pos) => isInsideQuarter(pos) && !isReservedGround(pos))
    .map((pos) => ({ pos, order: chebyshevDistance(pos, QUARTER_CENTRE) + rng() }))
    .toSorted((left, right) => left.order - right.order)
    .slice(0, count)
    .map(({ pos }) => pos);
}

/**
 * Development level drives the count and population caps it. A capital holds thousands, so one
 * drawn house stands for many families and the quarter never tries to be the whole city.
 */
function drawnHouseCount(cityState: NationCityState): number {
  const fromDevelopment =
    Math.max(0, Math.floor(cityState.developmentLevel)) * HOUSES_PER_DEVELOPMENT_LEVEL;
  const fromPopulation = Math.ceil(Math.max(0, cityState.population) / RESIDENTS_PER_DRAWN_HOUSE);
  return Math.min(fromDevelopment, fromPopulation);
}

interface QuarterBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function houseBounds(plots: readonly Position[]): QuarterBounds | null {
  if (plots.length === 0) return null;
  const xs = plots.map(({ x }) => x);
  const ys = plots.map(({ y }) => y);
  return {
    minX: Math.max(0, Math.min(...xs) - STREET_MARGIN),
    minY: Math.max(0, Math.min(...ys) - STREET_MARGIN),
    maxX: Math.min(MAP_WIDTH - 1, Math.max(...xs) + STREET_MARGIN),
    maxY: Math.min(MAP_HEIGHT - 1, Math.max(...ys) + STREET_MARGIN),
  };
}

/** The two ways through the store are the city's avenues; the rest of the grid is a lane. */
function streetLevelAt(pos: Position): Exclude<TrailLevel, "none"> | null {
  const dx = pos.x - QUARTER_CENTRE.x;
  const dy = pos.y - QUARTER_CENTRE.y;
  if (dx % STREET_BLOCK_WIDTH !== 0 && dy % STREET_BLOCK_HEIGHT !== 0) return null;
  return dx === 0 || dy === 0 ? "establishedTrail" : "trail";
}

interface Street {
  pos: Position;
  level: Exclude<TrailLevel, "none">;
}

function layStreets(bounds: QuarterBounds | null): Street[] {
  if (bounds === null) return [];
  const streets: Street[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      // The avenues still cross the square; only the anchors are kept out from under a road.
      if (isDirectiveAnchor({ x, y })) continue;
      const level = streetLevelAt({ x, y });
      if (level !== null) streets.push({ pos: { x, y }, level });
    }
  }
  return streets;
}

interface Bearing {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

/** Clockwise from east, matching `Math.atan2`'s sign convention in a y-down grid. */
const BEARINGS: readonly Bearing[] = [
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
];

/** Snaps the direction from one world-map position to another onto one of 8 compass directions. */
function bearingTo(from: Position, to: Position): Bearing | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  return BEARINGS[octant] ?? null;
}

/** How far the built quarter reaches from its centre in the worst-case direction, so a road can start
 *  clear of every chosen plot regardless of which way it leaves. */
function footprintExtent(bounds: QuarterBounds | null): number {
  if (bounds === null) return PLAZA_RADIUS;
  return Math.max(
    QUARTER_CENTRE.x - bounds.minX,
    bounds.maxX - QUARTER_CENTRE.x,
    QUARTER_CENTRE.y - bounds.minY,
    bounds.maxY - QUARTER_CENTRE.y,
  );
}

/** A straight line from just outside the built quarter to the edge of the drawn grid, in one
 *  direction. This is "a road leaving the city" (plan §C1-8), not the whole route to its partner —
 *  the partner may be far outside the 64x48 quarter the local view depicts at all. */
function roadPositions(bearing: Bearing, startDistance: number): Position[] {
  const step: Position = { x: bearing.dx, y: bearing.dy };
  const positions: Position[] = [];
  let pos = shift(QUARTER_CENTRE, {
    x: step.x * (startDistance + 1),
    y: step.y * (startDistance + 1),
  });
  while (isInsideQuarter(pos)) {
    // Matches `layStreets`: the avenues cross the square, but the anchors stay bare ground.
    if (!isDirectiveAnchor(pos)) positions.push(pos);
    pos = shift(pos, step);
  }
  return positions;
}

/**
 * One bearing per trade route touching this city, toward whichever end is not this city.
 * `WorldTradeRoute` carries only `cityIds`, so the partner's position is resolved through
 * `worldMap.cities`; a route whose partner is not in that list contributes no road rather than a guess.
 */
function tradeRouteBearings(input: CitySceneInput): Bearing[] {
  const bearings: Bearing[] = [];
  for (const route of input.worldMap.tradeRoutes) {
    if (!route.cityIds.includes(input.city.id)) continue;
    const partnerId = route.cityIds.find((id) => id !== input.city.id);
    const partner = input.worldMap.cities.find((city) => city.id === partnerId);
    if (partner === undefined) continue;
    const bearing = bearingTo(input.city.pos, partner.pos);
    if (bearing !== null) bearings.push(bearing);
  }
  return bearings;
}

function tradeRoads(input: CitySceneInput, bounds: QuarterBounds | null): Street[] {
  const startDistance = footprintExtent(bounds);
  return tradeRouteBearings(input).flatMap((bearing) =>
    roadPositions(bearing, startDistance).map((pos) => ({
      pos,
      level: "establishedTrail" as const,
    })),
  );
}

/** A plot, a street or the square is ground the city itself cleared, whatever lay there before. */
function clearFootprint(tiles: Tile[], positions: readonly Position[]): void {
  for (const pos of positions) {
    if (!isInsideQuarter(pos)) continue;
    tiles[pos.y * MAP_WIDTH + pos.x] = { terrain: "plains", resource: null };
  }
}

function plazaPositions(): Position[] {
  const positions: Position[] = [];
  for (let dy = -PLAZA_RADIUS; dy <= PLAZA_RADIUS; dy += 1) {
    for (let dx = -PLAZA_RADIUS; dx <= PLAZA_RADIUS; dx += 1) {
      positions.push({ x: QUARTER_CENTRE.x + dx, y: QUARTER_CENTRE.y + dy });
    }
  }
  return positions;
}

function drawnHouses(plots: readonly Position[]): Building[] {
  return plots.map((pos) => ({
    kind: "house",
    pos,
    progress: HOUSE_BUILD_TICKS,
    complete: true,
  }));
}

/** The trail layer reads `level` and `wear`; the rest is here because `TrailCell` requires it. */
function trailCell(level: TrailLevel): TrailCell {
  return {
    wear: TRAIL_LEVEL_WEAR[level],
    level,
    passagesToday: 0,
    purposeWear: {
      survival: 0,
      gathering: 0,
      construction: 0,
      facilityService: 0,
      wandering: 0,
    },
    dominantPurpose: null,
    facilityWear: {},
    causedByFacilityIds: [],
    lastUsedAtTick: null,
  };
}

/**
 * `renderMapLayer` reads the season through the resident helper, which runs at 4800 ticks per
 * season while the nation clock runs at 300. A nation tick passed straight through would leave the
 * ground in spring for sixteen nation seasons, so the display tick is back-computed instead.
 */
function displayTick(tick: number): number {
  return SEASONS.indexOf(nationSeasonOfTick(tick)) * DAYS_PER_SEASON * TICKS_PER_DAY;
}

/** No layer the city view drives reads history; it is here because `WorldState` requires it. */
function sceneHistory(input: CitySceneInput): WorldHistory {
  return {
    startYear: 0,
    currentYear: 0,
    polities: [input.polity],
    events: [],
    landmarks: [],
    settlementOrigin: null,
    worldMap: input.worldMap,
  };
}

const CROP_STAGE_BY_SEASON: Readonly<Record<(typeof SEASONS)[number], CropStage>> = {
  // A directive-cleared field tracks the calendar, the same as any other farmland would.
  spring: "sown",
  summer: "growing",
  autumn: "ripe",
  winter: "fallow",
};

/**
 * `clearFarmland` is visible only while it sits in `nation.activeDirectives`. The client has no record
 * of a directive once it completes — `SeasonReport.completedDirectiveIds` is last-season-only and
 * carries ids, not kinds — so a permanently-standing field would claim a result the server never sent.
 */
function clearFarmlandField(season: (typeof SEASONS)[number], anchor: Position): Field {
  return {
    kind: "field",
    pos: anchor,
    progress: 0,
    complete: false,
    stage: CROP_STAGE_BY_SEASON[season],
  };
}

/**
 * `communalGranary` is an existing `FacilityKind`, so `encourageStores` renders as an ordinary
 * `Facility` `Building` — unlike `openMine` (`directiveLayer.ts`), this needs no new shared type. Same
 * visibility rule as the field above: it disappears the season the directive completes.
 */
function encourageStoresGranary(directive: ActiveDirective, anchor: Position): Facility {
  const elapsedSeasons = Math.max(0, directive.totalSeasons - directive.seasonsRemaining);
  const ticksPerSeason = FACILITY_BUILD_TICKS.communalGranary / directive.totalSeasons;
  return {
    kind: "communalGranary",
    id: `directive-mark-${directive.id}`,
    demandId: `directive-mark-${directive.id}`,
    institutionId: `directive-mark-${directive.id}`,
    pos: anchor,
    progress: Math.min(FACILITY_BUILD_TICKS.communalGranary, ticksPerSeason * elapsedSeasons),
    complete: false,
    woodDelivered: 0,
    inventory: { wood: 0, food: 0 },
    operation: "inactive",
    blockedReason: null,
    maintenanceDue: 0,
    statsToday: {
      visits: 0,
      foodPreserved: 0,
      foodImported: 0,
      foodExported: 0,
      woodSpent: 0,
      woodReceived: 0,
      rationMeals: 0,
      maintenanceWork: 0,
    },
    lastUsedAtTick: null,
    lastTradeTick: null,
    siteRationale: { score: 0, contributions: [] },
    provenance: {
      causedByEventIds: [],
      proposedByAgentIds: [],
      supportedByAgentIds: [],
      opposedByAgentIds: [],
      decidedAtTick: directive.issuedAtTick,
    },
  };
}

/**
 * The two directives whose mark is an ordinary `Building`, read straight off `activeDirectives` and
 * placed at whichever anchors the caller passes in — never re-derived here, so a field or granary can
 * only ever land where `directiveAnchorPositions` itself would put it. Exported so that contract is
 * directly checkable: a caller that fed the wrong anchor is the only way this could ever disagree.
 */
export function directiveBuildings(
  activeForCity: readonly ActiveDirective[],
  season: (typeof SEASONS)[number],
  anchors: Readonly<Record<DirectiveKind, Position>>,
): Building[] {
  const buildings: Building[] = [];
  if (activeForCity.some((directive) => directive.kind === "clearFarmland")) {
    buildings.push(clearFarmlandField(season, anchors.clearFarmland));
  }
  const granary = activeForCity.find((directive) => directive.kind === "encourageStores");
  if (granary !== undefined)
    buildings.push(encourageStoresGranary(granary, anchors.encourageStores));
  return buildings;
}

/**
 * A deterministic, non-authoritative view of one of the player's cities, in the shape the frozen
 * resident-scale renderers already consume. Same input, deeply identical output.
 */
export function synthesizeCityScene(input: CitySceneInput): WorldState {
  const rng = createSceneRng(citySceneSeed(input.city.id, input.city.pos));
  const tiles = createTiles(sampleTerrainMix(input.worldMap, input.city.pos), rng);
  const plots = choosePlots(drawnHouseCount(input.cityState), rng);
  const bounds = houseBounds(plots);
  const streets = layStreets(bounds);
  const roads = tradeRoads(input, bounds);
  clearFootprint(tiles, [
    ...plazaPositions(),
    ...ANCHOR_POSITIONS,
    ...plots,
    ...streets.map(({ pos }) => pos),
    ...roads.map(({ pos }) => pos),
  ]);

  const activeForCity = activeDirectivesForCity(input.nation, input.city);
  const season = nationSeasonOfTick(input.tick);
  // The one place the store's own position is decided; `directiveAnchorPositions` is then called on
  // this exact value; so `stockpile.pos` below and the anchors buildings are placed at can never read
  // two different positions for the store, even if this stops being `QUARTER_CENTRE` outright someday.
  const storePos: Position = { ...QUARTER_CENTRE };
  const anchors = directiveAnchorPositions(storePos);

  const scene: WorldState = {
    tick: displayTick(input.tick),
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tiles,
    agents: [],
    // `renderMapLayer` draws the stockpile unconditionally, so the city store is not optional. No
    // layer reads the amounts, and a nation-wide figure at one city's store would be a wrong one.
    stockpile: { pos: storePos, wood: 0, food: 0 },
    buildings: [...drawnHouses(plots), ...directiveBuildings(activeForCity, season, anchors)],
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [],
    trailCells: Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => trailCell("none")),
    history: sceneHistory(input),
  };

  // Wear draws only on open ground with nothing built on it, so a street or road laid elsewhere
  // vanishes. Roads are written after streets, so where a diagonal road happens to cross the street
  // grid it stays the road's own `establishedTrail` write — both are that level already in practice.
  for (const { pos, level } of [...streets, ...roads]) {
    if (!isVisibleGround(scene, pos)) continue;
    scene.trailCells[pos.y * MAP_WIDTH + pos.x] = trailCell(level);
  }

  return scene;
}
