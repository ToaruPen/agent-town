import {
  type Building,
  FACILITY_BUILD_TICKS,
  type Facility,
  type FacilityKind,
  isFacility,
  isHouse,
} from "@agent-town/shared";
import { Container, Graphics, Sprite } from "pixi.js";

import { TILE_SIZE } from "./mapLayer.js";
import { BUILDING_SHADOW_WIDTH_RATIO, shadowGraphic } from "./shadow.js";
import { buildingSprites, objectDepth, type WorldObjectKind } from "./sprites.js";

export const CONSTRUCTION_ALPHA = 0.45;
export const HOUSE_OBJECT_LABEL = "house-object";
export const FACILITY_OBJECT_LABEL = "facility-object";
export const FACILITY_PROGRESS_LABEL = "facility-progress";

export function facilityProgressRatio(kind: FacilityKind, progress: number): number {
  return Math.min(1, Math.max(0, progress / FACILITY_BUILD_TICKS[kind]));
}

function progressGraphic(facility: Facility, alpha: number): Graphics {
  const ratio = facilityProgressRatio(facility.kind, facility.progress);
  const progress = new Graphics()
    .rect(2, 14, 12, 1)
    .fill(0x1d2428)
    .rect(2, 14, 12 * ratio, 1)
    .fill(0xfff176);
  progress.label = FACILITY_PROGRESS_LABEL;
  progress.alpha = alpha;
  return progress;
}

function buildingPart(
  path: string,
  y: number,
  alpha: number,
  label: string,
  depth: number,
): Sprite {
  const sprite = Sprite.from(path);
  sprite.position.set(0, y);
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.alpha = alpha;
  sprite.label = label;
  sprite.zIndex = depth;
  return sprite;
}

function buildingContainer(building: Building): Container {
  const isHouseBuilding = isHouse(building);
  const kind: WorldObjectKind = isHouseBuilding ? "house" : "facility";
  const label = isHouseBuilding ? HOUSE_OBJECT_LABEL : FACILITY_OBJECT_LABEL;
  const depth = objectDepth(building.pos.y, kind);
  const alpha = building.complete ? 1 : CONSTRUCTION_ALPHA;
  const paths = buildingSprites(building);
  const container = new Container();
  container.position.set(building.pos.x * TILE_SIZE, building.pos.y * TILE_SIZE);
  container.label = label;
  container.zIndex = depth;
  const shadow = shadowGraphic(BUILDING_SHADOW_WIDTH_RATIO);
  shadow.position.set(TILE_SIZE / 2, TILE_SIZE - 2);
  shadow.alpha = alpha;
  container.addChild(shadow);
  container.addChild(buildingPart(paths.wall, 0, alpha, label, depth));
  container.addChild(buildingPart(paths.roof, -TILE_SIZE, alpha, label, depth));
  if (paths.emblem !== null) {
    container.addChild(buildingPart(paths.emblem, 0, alpha, label, depth));
  }
  if (isFacility(building) && !building.complete) {
    container.addChild(progressGraphic(building, alpha));
  }
  return container;
}

function clearStructures(layer: Container): void {
  for (const child of [...layer.children]) {
    if (child.label !== HOUSE_OBJECT_LABEL && child.label !== FACILITY_OBJECT_LABEL) continue;
    layer.removeChild(child);
    child.destroy({ children: true });
  }
}

export function renderStructureLayer(layer: Container, buildings: Building[]): void {
  clearStructures(layer);

  for (const building of buildings) {
    layer.addChild(buildingContainer(building));
  }
}
