import type {
  AgentState,
  CropStage,
  Facility,
  House,
  SEASONS,
  Terrain,
  Tile,
} from "@agent-town/shared";

import { TERRAIN_TINTS } from "./colors.js";

export const TILE_SIZE = 16;
export type Season = (typeof SEASONS)[number];

export type WorldObjectKind =
  | "resource"
  | "stockpile"
  | "field"
  | "house"
  | "facility"
  | "landmark"
  | "tombstone"
  | "agent";

const OBJECT_DEPTHS: Record<WorldObjectKind, number> = {
  resource: 0,
  stockpile: 1,
  field: 2,
  house: 2,
  facility: 3,
  landmark: 4,
  tombstone: 5,
  agent: 6,
};
const DEPTHS_PER_ROW = 10;

export function objectDepth(tileY: number, kind: WorldObjectKind): number {
  return (tileY + 1) * DEPTHS_PER_ROW + OBJECT_DEPTHS[kind];
}

export function agentDepth(tileY: number, offsetY: number): number {
  return objectDepth(tileY, "agent") + offsetY / DEPTHS_PER_ROW;
}

const TWO_AGENT_OFFSETS = [
  { x: -4, y: 0 },
  { x: 4, y: 0 },
] as const;
const THREE_AGENT_OFFSETS = [
  { x: 0, y: -4 },
  { x: -4, y: 4 },
  { x: 4, y: 4 },
] as const;
const FOUR_AGENT_OFFSETS = [
  { x: -4, y: -4 },
  { x: 4, y: -4 },
  { x: -4, y: 4 },
  { x: 4, y: 4 },
] as const;
const MANY_AGENT_OFFSETS = [
  ...FOUR_AGENT_OFFSETS,
  { x: 0, y: -4 },
  { x: 0, y: 4 },
  { x: -4, y: 0 },
  { x: 4, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: -2 },
] as const;

export interface AgentTilePlacement {
  agent: AgentState;
  offset: { x: number; y: number };
}

export interface BuildingSprites {
  /** Tile drawn one row above the building's own tile. */
  roof: string;
  /** Tile drawn on the building's own tile. */
  wall: string;
  /** Optional emblem that names the institution at a glance. */
  emblem: string | null;
}

export function agentTileOffset(
  occupantIndex: number,
  occupantCount: number,
): {
  x: number;
  y: number;
} {
  if (occupantCount <= 1) return { x: 0, y: 0 };
  const offsets =
    occupantCount === 2
      ? TWO_AGENT_OFFSETS
      : occupantCount === 3
        ? THREE_AGENT_OFFSETS
        : occupantCount === 4
          ? FOUR_AGENT_OFFSETS
          : MANY_AGENT_OFFSETS;
  return offsets[occupantIndex % offsets.length] ?? { x: 0, y: 0 };
}

export function layoutAgentsOnTiles(agents: AgentState[]): AgentTilePlacement[] {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const key = `${agent.pos.x},${agent.pos.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const indexes = new Map<string, number>();
  return agents.map((agent) => {
    const key = `${agent.pos.x},${agent.pos.y}`;
    const occupantIndex = indexes.get(key) ?? 0;
    indexes.set(key, occupantIndex + 1);
    return {
      agent,
      offset: agentTileOffset(occupantIndex, counts.get(key) ?? 1),
    };
  });
}

export function layoutAgentsFrontToBack(agents: AgentState[]): AgentTilePlacement[] {
  return layoutAgentsOnTiles(agents)
    .map((placement, additionIndex) => ({ additionIndex, placement }))
    .toSorted((left, right) => {
      const leftDepth = agentDepth(left.placement.agent.pos.y, left.placement.offset.y);
      const rightDepth = agentDepth(right.placement.agent.pos.y, right.placement.offset.y);
      return rightDepth - leftDepth || right.additionIndex - left.additionIndex;
    })
    .map(({ placement }) => placement);
}

export const SPRITE_ASSETS = {
  terrain: {
    plains: [
      // Tiny Town tile 0: plain green grass.
      "/assets/tiny-town/Tiles/tile_0000.png",
    ],
    forest: [
      // Tiny Town tile 1: green grass with scattered tufts.
      "/assets/tiny-town/Tiles/tile_0001.png",
    ],
    rock: [
      // Tiny Town tile 25: plain ochre dirt ground.
      "/assets/tiny-town/Tiles/tile_0025.png",
      // Tiny Town tile 40: ochre dirt ground with scattered pebbles.
      "/assets/tiny-town/Tiles/tile_0040.png",
    ],
    undergrowth: [
      // Tiny Town tile 29: a cluster of mushrooms.
      "/assets/tiny-town/Tiles/tile_0029.png",
      // Tiny Town tile 17: a young green sprout.
      "/assets/tiny-town/Tiles/tile_0017.png",
    ],
  },
  resource: {
    tree: {
      green: [
        // Tiny Town tile 16: broad round green tree.
        "/assets/tiny-town/Tiles/tile_0016.png",
        // Tiny Town tile 28: oval green tree.
        "/assets/tiny-town/Tiles/tile_0028.png",
        // Tiny Town tile 4: conical green tree.
        "/assets/tiny-town/Tiles/tile_0004.png",
      ],
      autumn: [
        // Tiny Town tile 15: broad round autumn tree.
        "/assets/tiny-town/Tiles/tile_0015.png",
        // Tiny Town tile 27: oval autumn tree.
        "/assets/tiny-town/Tiles/tile_0027.png",
        // Tiny Town tile 3: conical autumn tree.
        "/assets/tiny-town/Tiles/tile_0003.png",
      ],
    },
    // Tiny Town tile 17: a young green sprout.
    food: "/assets/tiny-town/Tiles/tile_0017.png",
  },
  buildings: {
    house: {
      // Tiny Town tile 67: a red gable roof.
      roof: "/assets/tiny-town/Tiles/tile_0067.png",
      // Tiny Town tile 86: a timber wall with a door.
      wall: "/assets/tiny-town/Tiles/tile_0086.png",
      emblem: null,
    },
    communalGranary: {
      // Tiny Town tile 63: a slate gable roof.
      roof: "/assets/tiny-town/Tiles/tile_0063.png",
      // Tiny Town tile 74: a timber wall with a wide doorway.
      wall: "/assets/tiny-town/Tiles/tile_0074.png",
      // Tiny Town tile 116: a pitchfork.
      emblem: "/assets/tiny-town/Tiles/tile_0116.png",
    },
    grainMarket: {
      // Tiny Town tile 55: a red roof with a dormer.
      roof: "/assets/tiny-town/Tiles/tile_0055.png",
      // Tiny Town tile 75: a plain timber wall.
      wall: "/assets/tiny-town/Tiles/tile_0075.png",
      // Tiny Town tile 93: a bundle of grain.
      emblem: "/assets/tiny-town/Tiles/tile_0093.png",
    },
    rationDepot: {
      // Tiny Town tile 51: a slate roof with a dormer.
      roof: "/assets/tiny-town/Tiles/tile_0051.png",
      // Tiny Town tile 78: a slate wall with a doorway.
      wall: "/assets/tiny-town/Tiles/tile_0078.png",
      // Tiny Town tile 83: a wooden notice board.
      emblem: "/assets/tiny-town/Tiles/tile_0083.png",
    },
  },
  field: {
    soil: {
      // Tiny Farm tile 0: a rounded plot of dry soil with soft grass edges.
      fallow: "/assets/tiny-farm/Tiles/tile_0000.png",
      // Tiny Farm tile 1: the same rounded plot in darker, worked soil.
      worked: "/assets/tiny-farm/Tiles/tile_0001.png",
    },
    crop: {
      // Tiny Farm tile 64: small green sprouts.
      sown: "/assets/tiny-farm/Tiles/tile_0064.png",
      // Tiny Farm tile 65: taller green shoots.
      growing: "/assets/tiny-farm/Tiles/tile_0065.png",
      // Tiny Farm tile 66: golden ears on the stalk.
      ripe: "/assets/tiny-farm/Tiles/tile_0066.png",
    },
  },
  stockpile: {
    // Tiny Town tile 130: a woven food basket.
    basket: "/assets/tiny-town/Tiles/tile_0130.png",
    // Tiny Town tile 106: a cut log.
    log: "/assets/tiny-town/Tiles/tile_0106.png",
  },
  carry: {
    // Tiny Town tile 106: a cut log.
    wood: "/assets/tiny-town/Tiles/tile_0106.png",
    // Tiny Town tile 93: a bundle of grain.
    food: "/assets/tiny-town/Tiles/tile_0093.png",
  },
  // Tiny Dungeon tile 65: gray inscribed tombstone.
  tombstone: "/assets/tiny-dungeon/Tiles/tile_0065.png",
  agents: [
    // Tiny Dungeon tile 84: purple-hatted wizard.
    "/assets/tiny-dungeon/Tiles/tile_0084.png",
    // Tiny Dungeon tile 85: brown-haired settler in a pale-blue tunic.
    "/assets/tiny-dungeon/Tiles/tile_0085.png",
    // Tiny Dungeon tile 86: bald settler with a full brown beard, in a brown apron.
    "/assets/tiny-dungeon/Tiles/tile_0086.png",
    // Tiny Dungeon tile 88: brown-haired settler in a tan apron.
    "/assets/tiny-dungeon/Tiles/tile_0088.png",
    // Tiny Dungeon tile 98: short-haired settler in gray armour.
    "/assets/tiny-dungeon/Tiles/tile_0098.png",
    // Tiny Dungeon tile 99: long-haired settler in purple.
    "/assets/tiny-dungeon/Tiles/tile_0099.png",
    // Tiny Dungeon tile 100: gray-haired settler in brown.
    "/assets/tiny-dungeon/Tiles/tile_0100.png",
    // Tiny Dungeon tile 112: bearded farmer with a green headband.
    "/assets/tiny-dungeon/Tiles/tile_0112.png",
    // Tiny Farm tile 108: brown-haired settler in blue dungarees.
    "/assets/tiny-farm/Tiles/tile_0108.png",
    // Tiny Farm tile 109: straw-hatted settler in blue dungarees.
    "/assets/tiny-farm/Tiles/tile_0109.png",
  ],
} as const;

export const SPRITE_PATHS = [
  ...SPRITE_ASSETS.terrain.plains,
  ...SPRITE_ASSETS.terrain.forest,
  ...SPRITE_ASSETS.terrain.rock,
  ...SPRITE_ASSETS.terrain.undergrowth,
  ...SPRITE_ASSETS.resource.tree.green,
  ...SPRITE_ASSETS.resource.tree.autumn,
  SPRITE_ASSETS.resource.food,
  SPRITE_ASSETS.buildings.house.roof,
  SPRITE_ASSETS.buildings.house.wall,
  SPRITE_ASSETS.buildings.communalGranary.roof,
  SPRITE_ASSETS.buildings.communalGranary.wall,
  SPRITE_ASSETS.buildings.communalGranary.emblem,
  SPRITE_ASSETS.buildings.grainMarket.roof,
  SPRITE_ASSETS.buildings.grainMarket.wall,
  SPRITE_ASSETS.buildings.grainMarket.emblem,
  SPRITE_ASSETS.buildings.rationDepot.roof,
  SPRITE_ASSETS.buildings.rationDepot.wall,
  SPRITE_ASSETS.buildings.rationDepot.emblem,
  SPRITE_ASSETS.field.soil.fallow,
  SPRITE_ASSETS.field.soil.worked,
  SPRITE_ASSETS.field.crop.sown,
  SPRITE_ASSETS.field.crop.growing,
  SPRITE_ASSETS.field.crop.ripe,
  SPRITE_ASSETS.stockpile.basket,
  SPRITE_ASSETS.stockpile.log,
  SPRITE_ASSETS.carry.wood,
  SPRITE_ASSETS.carry.food,
  SPRITE_ASSETS.tombstone,
  ...SPRITE_ASSETS.agents,
] as const;

export function agentFacingScale(agent: AgentState): -1 | 1 {
  if (agent.activity.kind !== "moving") return 1;
  const next = agent.activity.path[0];
  return next !== undefined && next.x < agent.pos.x ? -1 : 1;
}

/** Stable per resident, so a death cannot reshuffle the faces of the living. */
export function agentSpritePath(agentId: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < agentId.length; index += 1) {
    hash ^= agentId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (
    SPRITE_ASSETS.agents[(hash >>> 0) % SPRITE_ASSETS.agents.length] ?? SPRITE_ASSETS.agents[0]
  );
}

export function buildingSprites(building: House | Facility): BuildingSprites {
  return SPRITE_ASSETS.buildings[building.kind];
}

/** Ground tile under a field: dry soil when fallow, worked soil once sown. */
export function fieldSoilPath(stage: CropStage): string {
  return stage === "fallow" ? SPRITE_ASSETS.field.soil.fallow : SPRITE_ASSETS.field.soil.worked;
}

const CROP_SPRITE_PATHS = {
  fallow: null,
  sown: SPRITE_ASSETS.field.crop.sown,
  growing: SPRITE_ASSETS.field.crop.growing,
  ripe: SPRITE_ASSETS.field.crop.ripe,
} as const satisfies Readonly<Record<CropStage, string | null>>;

/** Crop drawn over the soil, or null when the field is bare. */
export function cropSpritePath(stage: CropStage): string | null {
  return CROP_SPRITE_PATHS[stage];
}

export function treeSpritePath(season: Season, tileIndex: number): (typeof SPRITE_PATHS)[number] {
  const palette =
    season === "spring" || season === "summer"
      ? SPRITE_ASSETS.resource.tree.green
      : SPRITE_ASSETS.resource.tree.autumn;
  return palette[tileIndex % palette.length] ?? palette[0];
}

const SEASON_GROUND_TINTS: Record<Season, number> = {
  spring: 0xe2f2d8,
  summer: 0xf8e6bd,
  autumn: 0xe9bd8f,
  winter: 0xf0f2f4,
};

export function seasonGroundTint(season: Season): number {
  return SEASON_GROUND_TINTS[season];
}

export function resourceSpritePath(tile: Tile): string | null {
  const resource = tile.resource;
  if (resource === null || resource.amount <= 0) return null;
  return resource.kind === "wood" ? treeSpritePath("spring", 0) : SPRITE_ASSETS.resource.food;
}

export function terrainSpritePath(terrain: Terrain, tileIndex: number): string | null {
  if (terrain === "water") return null;
  const variants = SPRITE_ASSETS.terrain[terrain];
  return variants[tileIndex % variants.length] ?? variants[0];
}

/** A restrained multiply suggests terrain shade without obscuring its identifying texture. */
export function terrainTint(terrain: Terrain): number {
  return TERRAIN_TINTS[terrain];
}

/** Undergrowth for a forest tile whose wood is gone, so the clearing still reads as forest. */
export function undergrowthSpritePath(tile: Tile, tileIndex: number): string | null {
  if (tile.terrain !== "forest" || (tile.resource?.amount ?? 0) > 0) return null;
  const variants = SPRITE_ASSETS.terrain.undergrowth;
  return variants[tileIndex % variants.length] ?? variants[0];
}
