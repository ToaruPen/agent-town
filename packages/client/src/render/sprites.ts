import type { AgentState, Terrain, Tile } from "@agent-town/shared";

export type WorldObjectKind = "resource" | "stockpile" | "house" | "tombstone" | "agent";

const OBJECT_DEPTHS: Record<WorldObjectKind, number> = {
  resource: 0,
  stockpile: 1,
  house: 2,
  tombstone: 3,
  agent: 4,
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
  // Tiny Town tile 67: red-roofed house front.
  house: "/assets/tiny-town/Tiles/tile_0067.png",
  // Tiny Dungeon tile 65: gray inscribed tombstone.
  tombstone: "/assets/tiny-dungeon/Tiles/tile_0065.png",
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
  SPRITE_ASSETS.house,
  SPRITE_ASSETS.tombstone,
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
