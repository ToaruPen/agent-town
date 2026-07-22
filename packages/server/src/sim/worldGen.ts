import {
  AGENT_NAMES,
  type AgentState,
  FOOD_RESOURCE_MAX,
  FOOD_RESOURCE_MIN,
  FOOD_TILE_CHANCE,
  FOREST_TILE_CHANCE,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Position,
  ROCK_PATCH_CHANCE,
  TERRAIN_PATCH_SIZE,
  type Terrain,
  type Tile,
  WATER_PATCH_CHANCE,
  WOOD_RESOURCE_MAX,
  WOOD_RESOURCE_MIN,
  type WorldState,
} from "@agent-town/shared";

import { createRng } from "./rng.js";

type ImpassableTerrain = Extract<Terrain, "water" | "rock">;

function randomInteger(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function createPatchTerrain(rng: () => number): ImpassableTerrain | null {
  const roll = rng();
  if (roll < WATER_PATCH_CHANCE) return "water";
  if (roll < WATER_PATCH_CHANCE + ROCK_PATCH_CHANCE) return "rock";
  return null;
}

function createPatchTerrains(rng: () => number): (ImpassableTerrain | null)[] {
  const patchColumns = Math.ceil(MAP_WIDTH / TERRAIN_PATCH_SIZE);
  const patchRows = Math.ceil(MAP_HEIGHT / TERRAIN_PATCH_SIZE);
  const patchCount = patchColumns * patchRows;
  const waterIndex = randomInteger(rng, 0, patchCount - 1);
  const rockOffset = randomInteger(rng, 1, patchCount - 1);
  const rockIndex = (waterIndex + rockOffset) % patchCount;

  return Array.from({ length: patchCount }, (_, index) => {
    if (index === waterIndex) return "water";
    if (index === rockIndex) return "rock";
    return createPatchTerrain(rng);
  });
}

function createResourceTile(rng: () => number): Tile {
  if (rng() < FOREST_TILE_CHANCE) {
    return {
      terrain: "forest",
      resource: {
        kind: "wood",
        amount: randomInteger(rng, WOOD_RESOURCE_MIN, WOOD_RESOURCE_MAX),
      },
    };
  }
  if (rng() < FOOD_TILE_CHANCE) {
    return {
      terrain: "plains",
      resource: {
        kind: "food",
        amount: randomInteger(rng, FOOD_RESOURCE_MIN, FOOD_RESOURCE_MAX),
      },
    };
  }
  return { terrain: "plains", resource: null };
}

function createTiles(rng: () => number): Tile[] {
  const patchColumns = Math.ceil(MAP_WIDTH / TERRAIN_PATCH_SIZE);
  const patches = createPatchTerrains(rng);
  const tiles: Tile[] = [];

  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const patchX = Math.floor(x / TERRAIN_PATCH_SIZE);
      const patchY = Math.floor(y / TERRAIN_PATCH_SIZE);
      const terrain = patches[patchY * patchColumns + patchX];
      tiles.push(terrain ? { terrain, resource: null } : createResourceTile(rng));
    }
  }

  return tiles;
}

function agentSpawnPositions(stockpile: Position): Position[] {
  return [
    { x: stockpile.x - 1, y: stockpile.y },
    { x: stockpile.x + 1, y: stockpile.y },
    { x: stockpile.x, y: stockpile.y - 1 },
  ];
}

function createAgents(stockpile: Position): AgentState[] {
  const spawnPositions = agentSpawnPositions(stockpile);
  return AGENT_NAMES.map((name, index) => {
    const pos = spawnPositions[index];
    if (pos === undefined) throw new Error(`missing spawn position for agent ${name}`);
    return {
      id: `agent-${index + 1}`,
      name,
      pos,
      carrying: null,
      activity: { kind: "idle" },
      tasks: [],
      planSource: "fake",
      thinking: false,
    };
  });
}

function makeSpawnAreaWalkable(tiles: Tile[], stockpile: Position, agents: AgentState[]): void {
  for (const pos of [stockpile, ...agents.map(({ pos }) => pos)]) {
    tiles[pos.y * MAP_WIDTH + pos.x] = { terrain: "plains", resource: null };
  }
}

export function generateWorld(seed: number): WorldState {
  const rng = createRng(seed);
  const tiles = createTiles(rng);
  const stockpilePosition: Position = {
    x: Math.floor(MAP_WIDTH / 2),
    y: Math.floor(MAP_HEIGHT / 2),
  };
  const agents = createAgents(stockpilePosition);
  makeSpawnAreaWalkable(tiles, stockpilePosition, agents);

  return {
    tick: 0,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tiles,
    agents,
    stockpile: { pos: stockpilePosition, wood: 0, food: 0 },
  };
}
