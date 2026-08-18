import { existsSync } from "node:fs";
import { join } from "node:path";

import type { AgentState, Tile } from "@agent-town/shared";
import { Container, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";

import { renderAgentLayer } from "../src/render/agentLayer.js";
import {
  agentDepth,
  agentFacingScale,
  agentSpritePath,
  agentTileOffset,
  cropSpritePath,
  fieldSoilPath,
  layoutAgentsOnTiles,
  objectDepth,
  resourceSpritePath,
  SPRITE_ASSETS,
  SPRITE_PATHS,
  seasonGroundTint,
  terrainSpritePath,
  terrainTint,
  treeSpritePath,
  undergrowthSpritePath,
} from "../src/render/sprites.js";
import { VENDORED_ASSET_ROOT } from "./pngTree.js";

describe("field sprites", () => {
  it("gives every crop stage a distinct look", () => {
    const paths = (["fallow", "sown", "growing", "ripe"] as const).map(
      (stage) => `${fieldSoilPath(stage)}|${cropSpritePath(stage) ?? ""}`,
    );

    expect(new Set(paths).size).toBe(4);
  });

  it("draws no crop on a fallow field", () => {
    expect(cropSpritePath("fallow")).toBeNull();
  });

  it("preloads every field tile", () => {
    for (const stage of ["fallow", "sown", "growing", "ripe"] as const) {
      expect(SPRITE_PATHS).toContain(fieldSoilPath(stage));
      const crop = cropSpritePath(stage);
      if (crop !== null) expect(SPRITE_PATHS).toContain(crop);
    }
  });
});

describe("agentTileOffset", () => {
  it("keeps one agent centered and separates same-tile occupants deterministically", () => {
    expect(agentTileOffset(0, 1)).toEqual({ x: 0, y: 0 });
    expect([agentTileOffset(0, 2), agentTileOffset(1, 2)]).toEqual([
      { x: -4, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(Array.from({ length: 4 }, (_, index) => agentTileOffset(index, 4))).toEqual([
      { x: -4, y: -4 },
      { x: 4, y: -4 },
      { x: -4, y: 4 },
      { x: 4, y: 4 },
    ]);
  });
});

describe("objectDepth", () => {
  it("places agents over same-tile features and every lower row over the row above", () => {
    expect(objectDepth(4, "resource")).toBeLessThan(objectDepth(4, "agent"));
    expect(objectDepth(4, "agent")).toBeLessThan(objectDepth(5, "resource"));
  });

  it("stacks an institution above the houses around it and below an old-world landmark", () => {
    expect(objectDepth(4, "house")).toBeLessThan(objectDepth(4, "facility"));
    expect(objectDepth(4, "facility")).toBeLessThan(objectDepth(4, "landmark"));
    expect(objectDepth(4, "agent")).toBeLessThan(objectDepth(5, "resource"));
  });

  it("places old-world landmarks above resources but below residents", () => {
    const landmarkDepth = objectDepth(4, "landmark" as Parameters<typeof objectDepth>[1]);

    expect(objectDepth(4, "resource")).toBeLessThan(landmarkDepth);
    expect(landmarkDepth).toBeLessThan(objectDepth(4, "agent"));
  });
});

describe("agentDepth", () => {
  it("sorts five same-tile agents by their jittered visual y position", () => {
    const agents = Array.from({ length: 5 }, (_, index) => ({
      ...movingAgent(5),
      id: `agent-${index}`,
    }));
    const placements = layoutAgentsOnTiles(agents);
    const upper = placements.find(({ offset }) => offset.y === -4);
    const lower = placements.find(({ offset }) => offset.y === 4);

    expect(upper).toBeDefined();
    expect(lower).toBeDefined();
    expect(agentDepth(2, upper?.offset.y ?? 0)).toBeLessThan(agentDepth(2, lower?.offset.y ?? 0));
    expect(agentDepth(2, lower?.offset.y ?? 0)).toBeLessThan(objectDepth(3, "resource"));
  });
});

function movingAgent(nextX: number): AgentState {
  return {
    id: "agent-1",
    name: "Ada",
    pos: { x: 4, y: 2 },
    carrying: null,
    activity: {
      kind: "moving",
      path: [{ x: nextX, y: 2 }],
      ticksIntoStep: 0,
    },
    tasks: [],
    planSource: "fake",
    llmProvider: null,
    thinking: false,
    lastThought: null,
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
    rationStrain: 0,
    lastRationTick: null,
  };
}

describe("agentFacingScale", () => {
  it("flips a moving agent only when its next step is to the left", () => {
    expect(agentFacingScale(movingAgent(3))).toBe(-1);
    expect(agentFacingScale(movingAgent(5))).toBe(1);
  });
});

describe("agentSpritePath", () => {
  it("always gives the same resident id the same face", () => {
    expect(agentSpritePath("resident-42")).toBe(agentSpritePath("resident-42"));
  });

  it("does not reshuffle surviving faces when a resident is removed", () => {
    const ids = ["resident-a", "resident-b", "resident-c"];
    const before = new Map(ids.map((id) => [id, agentSpritePath(id)]));
    const survivors = ids.filter((id) => id !== "resident-b");

    expect(survivors.map((id) => agentSpritePath(id))).toEqual(
      survivors.map((id) => before.get(id)),
    );
  });

  it("reaches every settlement face across generated resident ids", () => {
    const paths = new Set(
      Array.from({ length: 400 }, (_, index) => agentSpritePath(`resident-${index}`)),
    );

    expect(paths).toEqual(new Set(SPRITE_ASSETS.agents));
  });
});

describe("resident carry sprites", () => {
  it("preloads the log and grain tiles chosen for carried resources", () => {
    expect(SPRITE_ASSETS).toHaveProperty("carry.wood", "/assets/tiny-town/Tiles/tile_0106.png");
    expect(SPRITE_ASSETS).toHaveProperty("carry.food", "/assets/tiny-town/Tiles/tile_0093.png");
    expect(SPRITE_PATHS).toContain("/assets/tiny-town/Tiles/tile_0106.png");
    expect(SPRITE_PATHS).toContain("/assets/tiny-town/Tiles/tile_0093.png");
  });

  it("renders a carried resource as a sprite beside the resident", () => {
    const layer = new Container();
    const agent = {
      ...movingAgent(5),
      carrying: { kind: "wood" as const, amount: 1 },
    };

    renderAgentLayer(layer, [agent], new Map(), {
      selectedAgentId: null,
      hoveredAgentId: null,
    });

    expect(layer.children).toHaveLength(1);
    expect(layer.children[0]?.children.filter((child) => child instanceof Sprite)).toHaveLength(2);
  });
});

describe("resourceSpritePath", () => {
  it("shows a tree only while a wood resource remains", () => {
    const growing: Tile = {
      terrain: "forest",
      resource: { kind: "wood", amount: 1 },
    };
    const depleted: Tile = { terrain: "forest", resource: null };

    expect(resourceSpritePath(growing)).toBe(treeSpritePath("spring", 0));
    expect(resourceSpritePath(depleted)).toBeNull();
  });

  it("shows the food plant only while food remains", () => {
    const growing: Tile = {
      terrain: "plains",
      resource: { kind: "food", amount: 1 },
    };
    const depleted: Tile = {
      terrain: "plains",
      resource: { kind: "food", amount: 0 },
    };

    expect(resourceSpritePath(growing)).toBe(SPRITE_ASSETS.resource.food);
    expect(resourceSpritePath(depleted)).toBeNull();
  });
});

function colorChannels(color: number): number[] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function colorBrightness(color: number): number {
  return colorChannels(color).reduce((total, channel) => total + channel, 0);
}

function colorSaturation(color: number): number {
  const channels = colorChannels(color);
  return Math.max(...channels) - Math.min(...channels);
}

describe("seasonal map sprites", () => {
  it("keeps each tree silhouette stable while its seasonal color changes", () => {
    for (const index of [0, 1, 2]) {
      expect(treeSpritePath("spring", index)).toBe(treeSpritePath("summer", index));
      expect(treeSpritePath("autumn", index)).toBe(treeSpritePath("winter", index));
      expect(treeSpritePath("spring", index)).not.toBe(treeSpritePath("autumn", index));
    }
  });

  it("preloads all three green and autumn tree families", () => {
    const seasonalTrees = new Set<(typeof SPRITE_PATHS)[number]>(
      (["spring", "autumn"] as const).flatMap((season) =>
        [0, 1, 2].map((index) => treeSpritePath(season, index)),
      ),
    );

    expect(seasonalTrees).toHaveLength(6);
    expect([...seasonalTrees].every((path) => SPRITE_PATHS.includes(path))).toBe(true);
  });

  it("gives every season a distinct tint and makes winter palest and least saturated", () => {
    const seasons = ["spring", "summer", "autumn", "winter"] as const;
    const tints = seasons.map(seasonGroundTint);
    const winter = seasonGroundTint("winter");
    const otherTints = seasons.filter((season) => season !== "winter").map(seasonGroundTint);

    expect(new Set(tints)).toHaveLength(seasons.length);
    expect(tints.filter((tint) => tint === 0xffffff).length).toBeLessThanOrEqual(1);
    expect(colorBrightness(winter)).toBeGreaterThan(Math.max(...otherTints.map(colorBrightness)));
    expect(colorSaturation(winter)).toBeLessThan(Math.min(...otherTints.map(colorSaturation)));
  });
});

describe("terrainSpritePath", () => {
  it("uses grass for walkable ground, dirt for rock, and Graphics for water", () => {
    expect(terrainSpritePath("plains", 0)).toBe(SPRITE_ASSETS.terrain.plains[0]);
    expect(terrainSpritePath("forest", 1)).toBe(SPRITE_ASSETS.terrain.forest[0]);
    expect(terrainSpritePath("rock", 0)).toBe(SPRITE_ASSETS.terrain.rock[0]);
    expect(terrainSpritePath("water", 0)).toBeNull();
  });

  it("distinguishes plains and forest by texture at the same tile index", () => {
    expect(terrainSpritePath("plains", 0)).not.toBe(terrainSpritePath("forest", 0));
  });
});

describe("terrainTint", () => {
  it("leaves plains unchanged, cools forests, and shifts rock toward slate", () => {
    const plains = terrainTint("plains");
    const forest = terrainTint("forest");
    const rock = terrainTint("rock");

    expect(plains).toBe(0xffffff);
    expect(forest).toBe(0xedf3ec);
    expect((forest >> 8) & 0xff).toBeLessThan((plains >> 8) & 0xff);
    expect(rock & 0xff).toBeGreaterThan((rock >> 16) & 0xff);
  });
});

describe("undergrowthSpritePath", () => {
  it("adds stable undergrowth only to depleted forest", () => {
    const depletedForest: Tile = { terrain: "forest", resource: null };
    const growingForest: Tile = {
      terrain: "forest",
      resource: { kind: "wood", amount: 1 },
    };
    const depletedPlains: Tile = { terrain: "plains", resource: null };

    expect(undergrowthSpritePath(growingForest, 3)).toBeNull();
    expect(undergrowthSpritePath(depletedPlains, 3)).toBeNull();
    expect(undergrowthSpritePath(depletedForest, 3)).not.toBeNull();
    expect(undergrowthSpritePath(depletedForest, 3)).toBe(undergrowthSpritePath(depletedForest, 3));
  });
});

/**
 * `directive-sprites.md` §5: the tiles for `developTimber`, `openMine` and `holdFestival`. `mineHead`
 * is not under `SPRITE_ASSETS.buildings` — `Facility.kind` (`shared/spatial.ts`) has no such member,
 * and shared/ is frozen, so a mine cannot be a `Building`. `directiveLayer.ts` draws it from raw paths
 * instead, and this group is where those paths live.
 */
describe("SPRITE_ASSETS.directive", () => {
  const timberPaths = [
    SPRITE_ASSETS.directive.timber.stump,
    SPRITE_ASSETS.directive.timber.log,
    SPRITE_ASSETS.directive.timber.axe,
  ];
  const mineHeadPaths = [
    SPRITE_ASSETS.directive.mineHead.roof,
    SPRITE_ASSETS.directive.mineHead.wall,
    SPRITE_ASSETS.directive.mineHead.emblem,
    SPRITE_ASSETS.directive.mineHead.spoil,
  ];
  const festivalPaths = [
    SPRITE_ASSETS.directive.festival.sheaf,
    SPRITE_ASSETS.directive.festival.keg,
  ];

  it("preloads every timber, mine and festival tile", () => {
    for (const path of [...timberPaths, ...mineHeadPaths, ...festivalPaths]) {
      expect(SPRITE_PATHS).toContain(path);
    }
  });

  it("points every directive tile at a file the vendored packs actually ship", () => {
    for (const path of [...timberPaths, ...mineHeadPaths, ...festivalPaths]) {
      const onDisk = join(VENDORED_ASSET_ROOT, path.replace(/^\/assets\//, ""));
      expect(existsSync(onDisk)).toBe(true);
    }
  });

  it("gives the mine head a distinct tile per slot, matching the roof/wall/emblem grammar", () => {
    expect(new Set(mineHeadPaths.slice(0, 3)).size).toBe(3);
  });

  // Reviewer finding: these tiles are what directiveLayer.ts's tests assert paths against, but only
  // the mine head's own distinctness was ever checked here -- pointing every timber or festival slot
  // at one PNG would still pass every prior assertion in this file.
  it("gives the mine head's spoil chunk its own tile too, distinct from the wall, roof and emblem", () => {
    expect(new Set(mineHeadPaths).size).toBe(4);
  });

  it("gives the timber camp's stump, log and axe each their own tile", () => {
    expect(new Set(timberPaths).size).toBe(3);
  });

  it("gives the festival's sheaf and keg each their own tile", () => {
    expect(new Set(festivalPaths).size).toBe(2);
  });
});
