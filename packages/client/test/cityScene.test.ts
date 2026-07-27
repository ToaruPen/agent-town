import {
  type DirectiveKind,
  MAP_HEIGHT,
  MAP_WIDTH,
  NATION_CITY_DEVELOPMENT_CAP,
  NATION_TICKS_PER_SEASON,
  type NationCityState,
  type NationState,
  nationSeasonOfTick,
  type Polity,
  type Position,
  seasonOfTick,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_WIDTH,
  type WorldCity,
  type WorldMap,
  type WorldMapTerrain,
} from "@agent-town/shared";
import { Container, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";

import {
  type CitySceneInput,
  directiveAnchorPositions,
  synthesizeCityScene,
} from "../src/local/cityScene.js";
import { citySceneSeed } from "../src/local/sceneRng.js";
import { renderMapLayer, TILE_SIZE } from "../src/render/mapLayer.js";
import { HOUSE_OBJECT_LABEL, renderStructureLayer } from "../src/render/structureLayer.js";
import { isVisibleGround, renderTrailLayer, TRAIL_OBJECT_LABEL } from "../src/render/trailLayer.js";

interface SceneOptions {
  terrain: WorldMapTerrain;
  pos: Position;
  cityId: string;
  population: number;
  developmentLevel: number;
  tick: number;
}

const DEFAULT_OPTIONS: SceneOptions = {
  terrain: "plains",
  pos: { x: 40, y: 30 },
  cityId: "city-polity-1-1",
  population: 4000,
  developmentLevel: 3,
  tick: 0,
};

function makeWorldMap(terrain: WorldMapTerrain): WorldMap {
  return {
    width: WORLD_MAP_WIDTH,
    height: WORLD_MAP_HEIGHT,
    cells: Array.from({ length: WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT }, () => ({
      terrain,
      polityId: "polity-1",
    })),
    cities: [],
    tradeRoutes: [],
    borderChanges: [],
    settlementFrontierPos: { x: 1, y: 1 },
  };
}

function makePolity(): Polity {
  return {
    id: "polity-1",
    name: "石帯連合",
    adjective: "石帯の",
    color: 0x6f9f91,
    values: [{ value: "stewardship", weight: 0.7, changedByEventIds: [] }],
    foundingMyth: "石を数えた者たちの盟約。",
    formativeTraumaEventIds: [],
    taboo: "森を焼くこと",
    ambition: "石の道を伸ばすこと",
    governance: "長老評議",
  };
}

function makeCity(cityId: string, pos: Position): WorldCity {
  return {
    id: cityId,
    name: "石帯府",
    pos,
    polityId: "polity-1",
    isCapital: true,
    foundedByEventId: "event-1",
  };
}

function makeNation(cityState: NationCityState): NationState {
  return {
    id: "polity-1",
    controller: "player",
    autoPilot: false,
    stocks: { food: 600, materials: 400, wealth: 300 },
    cities: [cityState],
    territoryCellCount: 180,
    population: 9000,
    stability: 62,
    culture: 40,
    foodProduction: 220,
    materialProduction: 140,
    activeDirectives: [],
    prosperity: {
      population: 0.4,
      production: 0.5,
      wealth: 0.3,
      stability: 0.62,
      culture: 0.2,
      total: 412,
    },
    lastReport: null,
  };
}

function makeInput(overrides: Partial<SceneOptions> = {}): CitySceneInput {
  const options: SceneOptions = { ...DEFAULT_OPTIONS, ...overrides };
  const cityState: NationCityState = {
    cityId: options.cityId,
    population: options.population,
    developmentLevel: options.developmentLevel,
  };
  return {
    city: makeCity(options.cityId, options.pos),
    cityState,
    nation: makeNation(cityState),
    polity: makePolity(),
    worldMap: makeWorldMap(options.terrain),
    tick: options.tick,
  };
}

function countTerrain(scene: ReturnType<typeof synthesizeCityScene>, terrain: string): number {
  return scene.tiles.filter((tile) => tile.terrain === terrain).length;
}

/** Every kind the simulation can have running at once: `isAlreadyActive` gates per kind and city. */
const DIRECTIVE_KINDS: readonly DirectiveKind[] = [
  "clearFarmland",
  "developTimber",
  "openMine",
  "growCity",
  "encourageStores",
  "holdFestival",
];

/** The most crowded quarter the simulation can ask for: development at its cap, houses maxed out. */
const CROWDED_CITY: Partial<SceneOptions> = {
  developmentLevel: NATION_CITY_DEVELOPMENT_CAP,
  population: 6000,
};

function chebyshev(from: Position, to: Position): number {
  return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
}

describe("citySceneSeed", () => {
  it("keeps one seed per identifier and position", () => {
    expect(citySceneSeed("city-polity-1-1", { x: 40, y: 30 })).toBe(
      citySceneSeed("city-polity-1-1", { x: 40, y: 30 }),
    );
  });

  it("separates worlds that reuse the seed-invariant identifiers", () => {
    const sameIdElsewhere = citySceneSeed("city-polity-1-1", { x: 41, y: 30 });
    expect(citySceneSeed("city-polity-1-1", { x: 40, y: 30 })).not.toBe(sameIdElsewhere);
    expect(citySceneSeed("city-polity-1-2", { x: 40, y: 30 })).not.toBe(
      citySceneSeed("city-polity-1-1", { x: 40, y: 30 }),
    );
  });
});

describe("synthesizeCityScene", () => {
  it("renders the same quarter for the same city twice", () => {
    expect(synthesizeCityScene(makeInput())).toEqual(synthesizeCityScene(makeInput()));
  });

  it("gives two cities in different places different towns", () => {
    expect(synthesizeCityScene(makeInput({ pos: { x: 40, y: 30 } }))).not.toEqual(
      synthesizeCityScene(makeInput({ pos: { x: 41, y: 30 } })),
    );
  });

  it("fills a mountain neighbourhood with more rock than a plains one", () => {
    const mountains = synthesizeCityScene(makeInput({ terrain: "mountains" }));
    const plains = synthesizeCityScene(makeInput({ terrain: "plains" }));

    expect(countTerrain(mountains, "rock")).toBeGreaterThan(countTerrain(plains, "rock"));
  });

  it("grows the drawn quarter with development level and never shrinks it", () => {
    const counts = Array.from({ length: NATION_CITY_DEVELOPMENT_CAP }, (_, index) => index + 1).map(
      (developmentLevel) => synthesizeCityScene(makeInput({ developmentLevel })).buildings.length,
    );

    expect(counts).toEqual([...counts].toSorted((left, right) => left - right));
    const first = counts.at(0) ?? 0;
    const last = counts.at(-1) ?? 0;
    expect(last).toBeGreaterThan(first);
  });

  it("saturates the drawn quarter against a small city's population", () => {
    const villagePopulation = 100;
    const village = synthesizeCityScene(
      makeInput({ population: villagePopulation, developmentLevel: NATION_CITY_DEVELOPMENT_CAP }),
    );
    const capital = synthesizeCityScene(
      makeInput({ population: 4000, developmentLevel: NATION_CITY_DEVELOPMENT_CAP }),
    );

    expect(village.buildings.length).toBeLessThan(capital.buildings.length);
  });

  it("lays every street where the trail layer can still draw wear", () => {
    for (const terrain of ["plains", "forest", "hills", "mountains", "sea"] as const) {
      const scene = synthesizeCityScene(makeInput({ terrain }));
      const worn = scene.trailCells
        .map((cell, index) => ({ cell, index }))
        .filter(({ cell }) => cell.level !== "none");

      expect(worn.length).toBeGreaterThan(0);
      for (const { index } of worn) {
        const pos = { x: index % scene.width, y: Math.floor(index / scene.width) };
        expect(isVisibleGround(scene, pos)).toBe(true);
      }
    }
  });

  it("puts the ground in the season the nation clock is actually in", () => {
    for (let tick = 0; tick < NATION_TICKS_PER_SEASON * 9; tick += 37) {
      const scene = synthesizeCityScene(makeInput({ tick }));
      expect(seasonOfTick(scene.tick)).toBe(nationSeasonOfTick(tick));
    }
  });

  it("stands the city store at the middle of the quarter it depicts", () => {
    const scene = synthesizeCityScene(makeInput());

    expect(scene.width).toBe(MAP_WIDTH);
    expect(scene.height).toBe(MAP_HEIGHT);
    expect(scene.stockpile.pos).toEqual({
      x: Math.floor(MAP_WIDTH / 2),
      y: Math.floor(MAP_HEIGHT / 2),
    });
  });

  /** The store's own props sit at `stockpileX ± TILE_SIZE/4`, so a neighbouring house collides. */
  it("leaves the square around the store open", () => {
    const scene = synthesizeCityScene(makeInput(CROWDED_CITY));

    const crowding = scene.buildings.filter(({ pos }) => chebyshev(pos, scene.stockpile.pos) <= 1);
    expect(crowding).toEqual([]);
  });

  /** What the dev page draws, pinned where a browser is not available to look at it. */
  it("gives the frozen renderers a ground sprite per tile, a street and a house apiece", () => {
    const scene = synthesizeCityScene(makeInput());
    const groundLayer = new Container();
    const trailLayer = new Container();
    const objectLayer = new Container();

    renderMapLayer(groundLayer, objectLayer, scene);
    renderTrailLayer(trailLayer, scene);
    renderStructureLayer(objectLayer, scene.buildings);

    const dryTiles = scene.tiles.filter(({ terrain }) => terrain !== "water");
    expect(dryTiles).toHaveLength(MAP_WIDTH * MAP_HEIGHT);
    expect(groundLayer.children.filter((child) => child instanceof Sprite)).toHaveLength(
      dryTiles.length,
    );
    expect(scene.buildings.length).toBeGreaterThan(0);
    expect(trailLayer.children.filter(({ label }) => label === TRAIL_OBJECT_LABEL)).toHaveLength(
      scene.trailCells.filter(({ level }) => level !== "none").length,
    );
    expect(objectLayer.children.filter(({ label }) => label === HOUSE_OBJECT_LABEL)).toHaveLength(
      scene.buildings.length,
    );

    const storeX = scene.stockpile.pos.x * TILE_SIZE;
    const storeY = scene.stockpile.pos.y * TILE_SIZE;
    const store = objectLayer.children
      .filter((child) => child instanceof Sprite && child.position.y === storeY)
      .map(({ position }) => position.x);
    expect(store).toContain(storeX - TILE_SIZE / 4);
    expect(store).toContain(storeX + TILE_SIZE / 4);
  });
});

/**
 * C1-8 draws a mark per active directive and `directive-sprites.md` §7 left the anchor point open.
 * These pin the room the layout keeps for it, so that slice never reverse-engineers the patch layout.
 */
describe("directiveAnchorPositions", () => {
  it("gives every directive kind an anchor of its own beside the store", () => {
    const scene = synthesizeCityScene(makeInput());
    const anchors = directiveAnchorPositions(scene);

    const positions = DIRECTIVE_KINDS.map((kind) => anchors[kind]);
    expect(new Set(positions.map(({ x, y }) => `${x},${y}`)).size).toBe(DIRECTIVE_KINDS.length);
    for (const pos of positions) {
      // On the ring just outside the square, which is what keeps them off the store's own props.
      expect(chebyshev(pos, scene.stockpile.pos)).toBe(2);
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThan(MAP_WIDTH);
      expect(pos.y).toBeLessThan(MAP_HEIGHT);
    }
  });

  /**
   * One ring cannot hold six non-adjacent tiles, so the loose-prop groups are the ones spread out.
   * `openMine` is a building in `directive-sprites.md` §3 and is here only for the optional spoil
   * chunk §5 lists beside it; spacing it too is free, and cheaper than revisiting this if it lands.
   */
  it("keeps the anchors that may carry loose props well clear of each other", () => {
    const anchors = directiveAnchorPositions(synthesizeCityScene(makeInput()));
    const propKinds: readonly DirectiveKind[] = ["developTimber", "holdFestival", "openMine"];

    for (const kind of propKinds) {
      for (const other of propKinds) {
        if (kind === other) continue;
        expect(chebyshev(anchors[kind], anchors[other])).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps every anchor free of houses, streets and standing resources", () => {
    for (const terrain of ["plains", "forest", "hills", "mountains", "sea"] as const) {
      const scene = synthesizeCityScene(makeInput({ ...CROWDED_CITY, terrain }));
      const anchors = directiveAnchorPositions(scene);

      expect(scene.buildings.length).toBeGreaterThan(0);
      for (const kind of DIRECTIVE_KINDS) {
        const pos = anchors[kind];
        const index = pos.y * scene.width + pos.x;
        expect(scene.buildings.filter((building) => chebyshev(building.pos, pos) === 0)).toEqual(
          [],
        );
        expect(scene.trailCells[index]?.level).toBe("none");
        // A prop group needs bare ground under it: no tree or grain already standing on the tile.
        expect(scene.tiles[index]?.terrain).toBe("plains");
        expect(scene.tiles[index]?.resource).toBeNull();
      }
    }
  });

  it("puts the anchors in the same places for the same city twice", () => {
    expect(directiveAnchorPositions(synthesizeCityScene(makeInput()))).toEqual(
      directiveAnchorPositions(synthesizeCityScene(makeInput())),
    );
  });
});
