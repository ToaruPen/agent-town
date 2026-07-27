import {
  type Building,
  DAYS_PER_SEASON,
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

/** Plots fill outward from the store, shuffled within each ring, so growth reads as growth. */
function choosePlots(count: number, rng: () => number): Position[] {
  return plotCandidates()
    .filter(isInsideQuarter)
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
      const level = streetLevelAt({ x, y });
      if (level !== null) streets.push({ pos: { x, y }, level });
    }
  }
  return streets;
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

/**
 * A deterministic, non-authoritative view of one of the player's cities, in the shape the frozen
 * resident-scale renderers already consume. Same input, deeply identical output.
 */
export function synthesizeCityScene(input: CitySceneInput): WorldState {
  const rng = createSceneRng(citySceneSeed(input.city.id, input.city.pos));
  const tiles = createTiles(sampleTerrainMix(input.worldMap, input.city.pos), rng);
  const plots = choosePlots(drawnHouseCount(input.cityState), rng);
  const streets = layStreets(houseBounds(plots));
  clearFootprint(tiles, [...plazaPositions(), ...plots, ...streets.map(({ pos }) => pos)]);

  const scene: WorldState = {
    tick: displayTick(input.tick),
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tiles,
    agents: [],
    // `renderMapLayer` draws the stockpile unconditionally, so the city store is not optional. No
    // layer reads the amounts, and a nation-wide figure at one city's store would be a wrong one.
    stockpile: { pos: { ...QUARTER_CENTRE }, wood: 0, food: 0 },
    buildings: drawnHouses(plots),
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [],
    trailCells: Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => trailCell("none")),
    history: sceneHistory(input),
  };

  // Wear draws only on open ground with nothing built on it, so a street laid elsewhere vanishes.
  for (const { pos, level } of streets) {
    if (!isVisibleGround(scene, pos)) continue;
    scene.trailCells[pos.y * MAP_WIDTH + pos.x] = trailCell(level);
  }

  return scene;
}
