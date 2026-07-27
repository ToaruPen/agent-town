import {
  MAP_HEIGHT,
  MAP_WIDTH,
  NATION_CITY_DEVELOPMENT_CAP,
  NATION_TICKS_PER_SEASON,
  type NationCityState,
  type NationState,
  type Polity,
  type Position,
  SEASONS,
  type Terrain,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_WIDTH,
  type WorldMap,
  type WorldMapTerrain,
  type WorldState,
} from "@agent-town/shared";
import { Application, Assets, Container, TextureStyle } from "pixi.js";

import {
  type CitySceneInput,
  directiveAnchorPositions,
  synthesizeCityScene,
} from "./local/cityScene.js";
import { renderMapLayer, TILE_SIZE } from "./render/mapLayer.js";
import { SPRITE_PATHS } from "./render/sprites.js";
import { renderStructureLayer } from "./render/structureLayer.js";
import { renderTrailLayer } from "./render/trailLayer.js";

// A separate Vite entry point inherits neither of these from `main.ts`. Without the preload every
// `Sprite.from(path)` resolves to nothing and the canvas comes up blank, which reads exactly like a
// broken terrain mix; without the scale mode the 16 px tiles are blurred.
TextureStyle.defaultOptions.scaleMode = "nearest";
await Assets.load([...SPRITE_PATHS]);

const POLITY_ID = "polity-1";

type NeighbourhoodName = "plains" | "forest" | "hills" | "mountains" | "coast" | "valley";

function uniformNeighbourhood(terrain: WorldMapTerrain): readonly WorldMapTerrain[] {
  return Array.from({ length: 9 }, () => terrain);
}

/** Row-major 3×3 world-map neighbourhoods, the city's own cell in the middle. */
const NEIGHBOURHOODS: Readonly<Record<NeighbourhoodName, readonly WorldMapTerrain[]>> = {
  plains: uniformNeighbourhood("plains"),
  forest: uniformNeighbourhood("forest"),
  hills: uniformNeighbourhood("hills"),
  mountains: uniformNeighbourhood("mountains"),
  coast: ["sea", "sea", "sea", "sea", "plains", "plains", "plains", "plains", "forest"],
  valley: [
    "mountains",
    "hills",
    "hills",
    "hills",
    "plains",
    "plains",
    "forest",
    "forest",
    "plains",
  ],
};

const NEIGHBOURHOOD_LABELS: Readonly<Record<NeighbourhoodName, string>> = {
  plains: "平原",
  forest: "森",
  hills: "丘",
  mountains: "山地",
  coast: "海辺",
  valley: "山あいの谷",
};

const SEASON_LABELS: Readonly<Record<(typeof SEASONS)[number], string>> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

const TERRAIN_LABELS: Readonly<Record<Terrain, string>> = {
  plains: "草地",
  forest: "森",
  rock: "岩",
  water: "水",
};

/** Positions far enough inside the world map that every city's 3×3 neighbourhood exists. */
const CITY_POSITIONS: readonly Position[] = [
  { x: 41, y: 27 },
  { x: 24, y: 18 },
  { x: 58, y: 12 },
  { x: 33, y: 44 },
  { x: 70, y: 39 },
  { x: 12, y: 31 },
];

const DEV_POLITY: Polity = {
  id: POLITY_ID,
  name: "石帯連合",
  adjective: "石帯の",
  color: 0x6f9f91,
  values: [
    { value: "stewardship", weight: 0.7, changedByEventIds: [] },
    { value: "commerce", weight: 0.4, changedByEventIds: [] },
  ],
  foundingMyth: "石を数えた者たちの盟約。",
  formativeTraumaEventIds: [],
  taboo: "森を焼くこと",
  ambition: "石の道を伸ばすこと",
  governance: "長老評議",
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}

function addOption(select: HTMLSelectElement, value: string, label: string): void {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function isNeighbourhoodName(value: string): value is NeighbourhoodName {
  return Object.hasOwn(NEIGHBOURHOODS, value);
}

function buildWorldMap(neighbourhood: readonly WorldMapTerrain[], pos: Position): WorldMap {
  const cells = Array.from({ length: WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT }, () => ({
    terrain: "plains" as WorldMapTerrain,
    polityId: POLITY_ID,
  }));
  for (const [index, terrain] of neighbourhood.entries()) {
    const x = pos.x - 1 + (index % 3);
    const y = pos.y - 1 + Math.floor(index / 3);
    cells[y * WORLD_MAP_WIDTH + x] = { terrain, polityId: POLITY_ID };
  }
  return {
    width: WORLD_MAP_WIDTH,
    height: WORLD_MAP_HEIGHT,
    cells,
    cities: [],
    tradeRoutes: [],
    borderChanges: [],
    settlementFrontierPos: { x: 1, y: 1 },
  };
}

function buildNation(cityState: NationCityState): NationState {
  return {
    id: POLITY_ID,
    controller: "player",
    autoPilot: false,
    stocks: { food: 640, materials: 420, wealth: 310 },
    cities: [cityState],
    territoryCellCount: 184,
    population: 9200,
    stability: 61,
    culture: 38,
    foodProduction: 226,
    materialProduction: 141,
    activeDirectives: [],
    prosperity: {
      population: 0.42,
      production: 0.5,
      wealth: 0.31,
      stability: 0.61,
      culture: 0.19,
      total: 415,
    },
    lastReport: null,
  };
}

interface DevControls {
  neighbourhood: HTMLSelectElement;
  season: HTMLSelectElement;
  city: HTMLSelectElement;
  development: HTMLInputElement;
  population: HTMLInputElement;
  status: HTMLElement;
}

function readSceneInput(controls: DevControls): CitySceneInput {
  const cityIndex = Number(controls.city.value);
  const pos = CITY_POSITIONS[cityIndex] ?? { x: 41, y: 27 };
  const cityState: NationCityState = {
    cityId: `city-${POLITY_ID}-${cityIndex + 1}`,
    population: Number(controls.population.value),
    developmentLevel: Number(controls.development.value),
  };
  const name = controls.neighbourhood.value;
  return {
    city: {
      id: cityState.cityId,
      name: `第${cityIndex + 1}都市`,
      pos,
      polityId: POLITY_ID,
      isCapital: cityIndex === 0,
      foundedByEventId: "event-founding",
    },
    cityState,
    nation: buildNation(cityState),
    polity: DEV_POLITY,
    worldMap: buildWorldMap(NEIGHBOURHOODS[isNeighbourhoodName(name) ? name : "plains"], pos),
    tick: Number(controls.season.value) * NATION_TICKS_PER_SEASON,
  };
}

function describeScene(scene: WorldState): string {
  const counts = new Map<Terrain, number>();
  for (const tile of scene.tiles) counts.set(tile.terrain, (counts.get(tile.terrain) ?? 0) + 1);
  const composition = [...counts]
    .toSorted(([, left], [, right]) => right - left)
    .map(([terrain, count]) => `${TERRAIN_LABELS[terrain]} ${count}`)
    .join(" / ");
  const streets = scene.trailCells.filter(({ level }) => level !== "none").length;
  const trees = scene.tiles.filter((tile) => tile.resource?.kind === "wood").length;
  const anchors = Object.entries(directiveAnchorPositions(scene))
    .map(([kind, pos]) => `${kind} ${pos.x},${pos.y}`)
    .join(" / ");
  return `家 ${scene.buildings.length} / 街路 ${streets} / 木 ${trees} / ${composition}\n施策の予約地: ${anchors}`;
}

const app = new Application();
await app.init({
  background: 0x1d2428,
  width: MAP_WIDTH * TILE_SIZE,
  height: MAP_HEIGHT * TILE_SIZE,
});
requireElement<HTMLElement>("#dev-stage").append(app.canvas);

// The container topology is `main.ts`'s: the three layers write into shared parents, and each clears
// only its own labels, so front-to-back ordering lives in these flags rather than in the renderers.
const world = new Container();
const groundLayer = new Container();
const trailLayer = new Container();
const objectLayer = new Container();
world.sortableChildren = true;
objectLayer.sortableChildren = true;
groundLayer.zIndex = 0;
trailLayer.zIndex = 1;
objectLayer.zIndex = 2;
trailLayer.eventMode = "none";
world.addChild(groundLayer, trailLayer, objectLayer);
app.stage.addChild(world);

const controls: DevControls = {
  neighbourhood: requireElement<HTMLSelectElement>("#dev-neighbourhood"),
  season: requireElement<HTMLSelectElement>("#dev-season"),
  city: requireElement<HTMLSelectElement>("#dev-city"),
  development: requireElement<HTMLInputElement>("#dev-development"),
  population: requireElement<HTMLInputElement>("#dev-population"),
  status: requireElement<HTMLElement>("#dev-status"),
};

for (const [name, label] of Object.entries(NEIGHBOURHOOD_LABELS)) {
  addOption(controls.neighbourhood, name, label);
}
for (const [index, season] of SEASONS.entries()) {
  addOption(controls.season, String(index), SEASON_LABELS[season]);
}
for (const index of CITY_POSITIONS.keys()) {
  addOption(controls.city, String(index), `第${index + 1}都市`);
}
// The simulation cannot take a city past the cap, so the page must not be able to depict one that is.
controls.development.max = String(NATION_CITY_DEVELOPMENT_CAP);
controls.neighbourhood.value = "valley";

function draw(): void {
  const scene = synthesizeCityScene(readSceneInput(controls));
  renderMapLayer(groundLayer, objectLayer, scene);
  renderTrailLayer(trailLayer, scene);
  renderStructureLayer(objectLayer, scene.buildings);
  controls.status.textContent = describeScene(scene);
}

for (const control of [
  controls.neighbourhood,
  controls.season,
  controls.city,
  controls.development,
  controls.population,
]) {
  control.addEventListener("input", draw);
}

draw();
