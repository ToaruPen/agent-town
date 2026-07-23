import type { HistoricalLandmark, LandmarkKind } from "@agent-town/shared";
import { type Container, Graphics } from "pixi.js";

import { TILE_SIZE } from "./mapLayer.js";
import { objectDepth } from "./sprites.js";

const LANDMARK_LABEL = "landmark-object";
const STONE_COLOR = 0x8c8f8b;
const STONE_SHADOW = 0x454a49;
const EMBER_COLOR = 0xd7864b;
const LEY_COLOR = 0x8878a6;
const SELECTED_COLOR = 0xded3b3;

function drawRuin(graphic: Graphics): void {
  graphic
    .rect(2, 9, 5, 5)
    .fill(STONE_SHADOW)
    .rect(8, 6, 6, 8)
    .fill(STONE_COLOR)
    .rect(10, 4, 2, 3)
    .fill(STONE_COLOR);
}

function drawBorderFort(graphic: Graphics): void {
  graphic
    .rect(2, 5, 12, 9)
    .fill(STONE_SHADOW)
    .rect(4, 7, 8, 7)
    .fill(STONE_COLOR)
    .moveTo(8, 7)
    .lineTo(8, 2)
    .stroke({ color: STONE_COLOR, width: 1 })
    .poly([8, 2, 13, 4, 8, 5])
    .fill(EMBER_COLOR);
}

function drawStandingStone(graphic: Graphics): void {
  graphic
    .poly([5, 14, 6, 3, 9, 1, 12, 4, 11, 14])
    .fill(STONE_SHADOW)
    .moveTo(9, 4)
    .lineTo(8, 11)
    .stroke({ color: LEY_COLOR, width: 1 });
}

function drawLandmark(graphic: Graphics, kind: LandmarkKind): void {
  if (kind === "ruin") {
    drawRuin(graphic);
    return;
  }
  if (kind === "borderFort") {
    drawBorderFort(graphic);
    return;
  }
  drawStandingStone(graphic);
}

function landmarkGraphic(landmark: HistoricalLandmark, selected: boolean): Graphics {
  const graphic = new Graphics();
  drawLandmark(graphic, landmark.kind);
  if (selected) {
    graphic.rect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2).stroke({ color: SELECTED_COLOR, width: 1 });
  }
  graphic.position.set(landmark.pos.x * TILE_SIZE, landmark.pos.y * TILE_SIZE);
  graphic.label = LANDMARK_LABEL;
  graphic.zIndex = objectDepth(landmark.pos.y, "landmark");
  return graphic;
}

function clearLandmarks(layer: Container): void {
  for (const child of [...layer.children]) {
    if (child.label !== LANDMARK_LABEL) continue;
    layer.removeChild(child);
    child.destroy({ children: true });
  }
}

export function renderHistoryLayer(
  layer: Container,
  landmarks: HistoricalLandmark[],
  selectedLandmarkId: string | null,
): void {
  clearLandmarks(layer);
  for (const landmark of landmarks) {
    layer.addChild(landmarkGraphic(landmark, landmark.id === selectedLandmarkId));
  }
}
