import {
  type Building,
  FACILITY_BUILD_TICKS,
  type Facility,
  type FacilityKind,
  type House,
  isFacility,
  isHouse,
} from "@agent-town/shared";
import { type Container, Graphics, Sprite } from "pixi.js";

import { FACILITY_COLORS } from "./colors.js";
import { TILE_SIZE } from "./mapLayer.js";
import { objectDepth, SPRITE_ASSETS } from "./sprites.js";

export const CONSTRUCTION_ALPHA = 0.45;
export const HOUSE_OBJECT_LABEL = "house-object";
export const FACILITY_OBJECT_LABEL = "facility-object";
export const FACILITY_PROGRESS_LABEL = "facility-progress";

export interface FacilityVisual {
  bodyColor: number;
  roofColor: number;
  emblem: "grain" | "awning" | "scales";
}

/** Each institution reads at a glance: a grain store, a stall, a counted-out store. */
const FACILITY_VISUALS = {
  communalGranary: {
    bodyColor: FACILITY_COLORS.communalGranary,
    roofColor: 0x5f4626,
    emblem: "grain",
  },
  grainMarket: { bodyColor: FACILITY_COLORS.grainMarket, roofColor: 0x7a3527, emblem: "awning" },
  rationDepot: { bodyColor: FACILITY_COLORS.rationDepot, roofColor: 0x3d4a50, emblem: "scales" },
} as const satisfies Readonly<Record<FacilityKind, FacilityVisual>>;

export function facilityVisual(kind: FacilityKind): FacilityVisual {
  return FACILITY_VISUALS[kind];
}

const AWNING_STRIPE_LEFTS = [3, 6, 9] as const;

function drawGranary(graphic: Graphics, visual: FacilityVisual): void {
  graphic
    .rect(3, 7, 10, 8)
    .fill(visual.bodyColor)
    .poly([2, 7, 8, 2, 14, 7])
    .fill(visual.roofColor)
    .circle(6, 11, 1)
    .circle(8, 10, 1)
    .circle(10, 11, 1)
    .fill(visual.roofColor);
}

function drawMarket(graphic: Graphics, visual: FacilityVisual): void {
  graphic.rect(3, 8, 10, 7).fill(visual.bodyColor);
  for (const [stripe, left] of AWNING_STRIPE_LEFTS.entries()) {
    graphic.rect(left, 4, 3, 4).fill(stripe % 2 === 0 ? visual.roofColor : visual.bodyColor);
  }
  graphic.rect(2, 3, 12, 1).fill(visual.roofColor);
}

function drawDepot(graphic: Graphics, visual: FacilityVisual): void {
  graphic
    .rect(3, 5, 10, 10)
    .fill(visual.bodyColor)
    .rect(3, 5, 10, 2)
    .fill(visual.roofColor)
    .rect(4, 10, 8, 1)
    .fill(visual.roofColor)
    .rect(7, 8, 2, 2)
    .fill(visual.roofColor);
}

function drawFacility(graphic: Graphics, visual: FacilityVisual): void {
  if (visual.emblem === "grain") {
    drawGranary(graphic, visual);
    return;
  }
  if (visual.emblem === "awning") {
    drawMarket(graphic, visual);
    return;
  }
  drawDepot(graphic, visual);
}

export function facilityProgressRatio(kind: FacilityKind, progress: number): number {
  return Math.min(1, Math.max(0, progress / FACILITY_BUILD_TICKS[kind]));
}

function progressGraphic(facility: Facility): Graphics {
  const ratio = facilityProgressRatio(facility.kind, facility.progress);
  const progress = new Graphics()
    .rect(2, 14, 12, 1)
    .fill(0x1d2428)
    .rect(2, 14, 12 * ratio, 1)
    .fill(0xfff176);
  progress.label = FACILITY_PROGRESS_LABEL;
  return progress;
}

function facilityGraphic(facility: Facility): Graphics {
  const graphic = new Graphics();
  drawFacility(graphic, facilityVisual(facility.kind));
  graphic.position.set(facility.pos.x * TILE_SIZE, facility.pos.y * TILE_SIZE);
  graphic.alpha = facility.complete ? 1 : CONSTRUCTION_ALPHA;
  if (!facility.complete) graphic.addChild(progressGraphic(facility));
  graphic.label = FACILITY_OBJECT_LABEL;
  graphic.zIndex = objectDepth(facility.pos.y, "facility");
  return graphic;
}

function houseSprite(house: House): Sprite {
  const sprite = Sprite.from(SPRITE_ASSETS.house);
  sprite.anchor.set(0.5, 1);
  sprite.position.set(house.pos.x * TILE_SIZE + TILE_SIZE / 2, (house.pos.y + 1) * TILE_SIZE);
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.alpha = house.complete ? 1 : CONSTRUCTION_ALPHA;
  sprite.label = HOUSE_OBJECT_LABEL;
  sprite.zIndex = objectDepth(house.pos.y, "house");
  return sprite;
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
    if (isHouse(building)) layer.addChild(houseSprite(building));
    else if (isFacility(building)) layer.addChild(facilityGraphic(building));
  }
}
