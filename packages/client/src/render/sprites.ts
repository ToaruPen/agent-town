import type { AgentState, Terrain, Tile } from "@agent-town/shared";

export const SPRITE_ASSETS = {
  terrain: {
    grass: [
      // Tiny Town tile 0: plain green grass.
      "/assets/tiny-town/Tiles/tile_0000.png",
      // Tiny Town tile 1: green grass with scattered tufts.
      "/assets/tiny-town/Tiles/tile_0001.png",
    ],
    rock: [
      // Tiny Town tile 25: plain ochre dirt ground.
      "/assets/tiny-town/Tiles/tile_0025.png",
      // Tiny Town tile 40: ochre dirt ground with scattered pebbles.
      "/assets/tiny-town/Tiles/tile_0040.png",
    ],
  },
  resource: {
    // Tiny Town tile 16: lower green tree canopy with a visible trunk.
    tree: "/assets/tiny-town/Tiles/tile_0016.png",
    // Tiny Town tile 2: grass dotted with two bright orange flowers.
    food: "/assets/tiny-town/Tiles/tile_0002.png",
  },
  // Tiny Town tile 94: golden supply chest.
  stockpile: "/assets/tiny-town/Tiles/tile_0094.png",
  agents: [
    // Tiny Dungeon tile 84: purple-robed wizard.
    "/assets/tiny-dungeon/Tiles/tile_0084.png",
    // Tiny Dungeon tile 85: brown-haired adventurer in a blue tunic.
    "/assets/tiny-dungeon/Tiles/tile_0085.png",
    // Tiny Dungeon tile 87: gray-haired bearded knight.
    "/assets/tiny-dungeon/Tiles/tile_0087.png",
  ],
} as const;

export const SPRITE_PATHS = [
  ...SPRITE_ASSETS.terrain.grass,
  ...SPRITE_ASSETS.terrain.rock,
  SPRITE_ASSETS.resource.tree,
  SPRITE_ASSETS.resource.food,
  SPRITE_ASSETS.stockpile,
  ...SPRITE_ASSETS.agents,
] as const;

export function agentFacingScale(agent: AgentState): -1 | 1 {
  if (agent.activity.kind !== "moving") return 1;
  const next = agent.activity.path[0];
  return next !== undefined && next.x < agent.pos.x ? -1 : 1;
}

export function agentSpritePath(agentIndex: number): string {
  return SPRITE_ASSETS.agents[agentIndex % SPRITE_ASSETS.agents.length] ?? SPRITE_ASSETS.agents[0];
}

export function resourceSpritePath(tile: Tile): string | null {
  const resource = tile.resource;
  if (resource === null || resource.amount <= 0) return null;
  return resource.kind === "wood" ? SPRITE_ASSETS.resource.tree : SPRITE_ASSETS.resource.food;
}

export function terrainSpritePath(terrain: Terrain, tileIndex: number): string | null {
  if (terrain === "water") return null;
  const variants = terrain === "rock" ? SPRITE_ASSETS.terrain.rock : SPRITE_ASSETS.terrain.grass;
  return variants[tileIndex % variants.length] ?? variants[0];
}
