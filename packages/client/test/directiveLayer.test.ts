import type { DirectiveKind, Position } from "@agent-town/shared";
import type { FillInstruction, GraphicsInstructions } from "pixi.js";
import { Container, Graphics, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";

import { DIRECTIVE_OBJECT_LABEL, renderDirectiveLayer } from "../src/render/directiveLayer.js";
import { objectDepth, TILE_SIZE } from "../src/render/sprites.js";

const ANCHORS: Readonly<Record<DirectiveKind, Position>> = {
  clearFarmland: { x: 30, y: 20 },
  developTimber: { x: 10, y: 12 },
  openMine: { x: 45, y: 8 },
  growCity: { x: 50, y: 40 },
  encourageStores: { x: 5, y: 5 },
  holdFestival: { x: 20, y: 30 },
};
const BANNER_COLOR = 0x6f9f91;

function directiveObjects(layer: Container): (Sprite | Graphics)[] {
  return layer.children.filter(
    (child): child is Sprite | Graphics =>
      child.label === DIRECTIVE_OBJECT_LABEL &&
      (child instanceof Sprite || child instanceof Graphics),
  );
}

function spritesAt(sprites: readonly Sprite[], x: number, y: number): Sprite[] {
  return sprites.filter((sprite) => sprite.position.x === x && sprite.position.y === y);
}

function isFillInstruction(instruction: GraphicsInstructions): instruction is FillInstruction {
  return instruction.action === "fill";
}

describe("renderDirectiveLayer", () => {
  it("draws nothing when no directive it depicts is active", () => {
    const layer = new Container();
    renderDirectiveLayer(layer, ANCHORS, new Set(), BANNER_COLOR);
    expect(directiveObjects(layer)).toEqual([]);
  });

  it("draws no mark for a directive kind it does not depict, even when active", () => {
    // clearFarmland, encourageStores and growCity are handled elsewhere (cityScene.ts's own
    // Building synthesis, or nothing at all for growCity) -- this layer only ever marks the
    // three directives directive-sprites.md could not give a Building shape.
    const layer = new Container();
    renderDirectiveLayer(
      layer,
      ANCHORS,
      new Set(["clearFarmland", "encourageStores", "growCity"]),
      BANNER_COLOR,
    );
    expect(directiveObjects(layer)).toEqual([]);
  });

  describe("developTimber", () => {
    it("draws the stump, log and axe at quarter-tile offsets from the anchor", () => {
      const layer = new Container();
      renderDirectiveLayer(layer, ANCHORS, new Set(["developTimber"]), BANNER_COLOR);

      const sprites = directiveObjects(layer).filter(
        (child): child is Sprite => child instanceof Sprite,
      );
      expect(sprites).toHaveLength(3);

      const anchor = ANCHORS.developTimber;
      const baseX = anchor.x * TILE_SIZE;
      const baseY = anchor.y * TILE_SIZE;

      const stump = spritesAt(sprites, baseX, baseY);
      const log = spritesAt(sprites, baseX + TILE_SIZE / 4, baseY + 2);
      const axe = spritesAt(sprites, baseX - TILE_SIZE / 4, baseY - 2);
      expect(stump).toHaveLength(1);
      expect(log).toHaveLength(1);
      expect(axe).toHaveLength(1);
      expect(stump[0]?.zIndex).toBe(objectDepth(anchor.y, "resource"));
      expect(log[0]?.zIndex).toBe(objectDepth(anchor.y, "stockpile"));
      expect(axe[0]?.zIndex).toBe(objectDepth(anchor.y, "stockpile"));
    });
  });

  describe("openMine", () => {
    it("draws the roof above the anchor, the wall and emblem on it, and a spoil chunk beside it", () => {
      const layer = new Container();
      renderDirectiveLayer(layer, ANCHORS, new Set(["openMine"]), BANNER_COLOR);

      const sprites = directiveObjects(layer).filter(
        (child): child is Sprite => child instanceof Sprite,
      );
      expect(sprites).toHaveLength(4);

      const anchor = ANCHORS.openMine;
      const baseX = anchor.x * TILE_SIZE;
      const baseY = anchor.y * TILE_SIZE;
      const facilityDepth = objectDepth(anchor.y, "facility");

      const roof = spritesAt(sprites, baseX, baseY - TILE_SIZE);
      // Wall and emblem share the building's own tile, matching structureLayer.ts's grammar.
      const onTile = spritesAt(sprites, baseX, baseY);
      const spoil = spritesAt(sprites, baseX + TILE_SIZE / 2, baseY);
      expect(roof).toHaveLength(1);
      expect(onTile).toHaveLength(2);
      expect(spoil).toHaveLength(1);
      expect(roof[0]?.zIndex).toBe(facilityDepth);
      expect(onTile.every((sprite) => sprite.zIndex === facilityDepth)).toBe(true);
      expect(spoil[0]?.zIndex).toBe(objectDepth(anchor.y, "resource"));
    });
  });

  describe("holdFestival", () => {
    it("draws a pennant filled with the nation's banner colour, plus a sheaf and a keg", () => {
      const layer = new Container();
      renderDirectiveLayer(layer, ANCHORS, new Set(["holdFestival"]), BANNER_COLOR);

      const objects = directiveObjects(layer);
      const pennants = objects.filter((child): child is Graphics => child instanceof Graphics);
      const sprites = objects.filter((child): child is Sprite => child instanceof Sprite);
      expect(pennants).toHaveLength(1);
      expect(sprites).toHaveLength(2);

      const anchor = ANCHORS.holdFestival;
      const pennant = pennants[0];
      expect(pennant?.position).toMatchObject({ x: anchor.x * TILE_SIZE, y: anchor.y * TILE_SIZE });
      expect(pennant?.zIndex).toBe(objectDepth(anchor.y, "landmark"));

      const fill = pennant?.context.instructions.filter(isFillInstruction).at(-1);
      expect(fill?.data.style.color).toBe(BANNER_COLOR);

      const stockpileDepth = objectDepth(anchor.y, "stockpile");
      expect(sprites.every((sprite) => sprite.zIndex === stockpileDepth)).toBe(true);
      // Two distinct ground props, not the same prop drawn twice at the same spot.
      const positions = new Set(sprites.map(({ position }) => `${position.x},${position.y}`));
      expect(positions.size).toBe(2);
    });

    it("changes the pennant colour with the banner it is given", () => {
      const layer = new Container();
      const otherColor = 0xd7864b;
      renderDirectiveLayer(layer, ANCHORS, new Set(["holdFestival"]), otherColor);

      const pennant = directiveObjects(layer).find(
        (child): child is Graphics => child instanceof Graphics,
      );
      const fill = pennant?.context.instructions.filter(isFillInstruction).at(-1);
      expect(fill?.data.style.color).toBe(otherColor);
    });
  });

  it("draws every mark at once when every depicted directive is active", () => {
    const layer = new Container();
    renderDirectiveLayer(
      layer,
      ANCHORS,
      new Set(["developTimber", "openMine", "holdFestival"]),
      BANNER_COLOR,
    );
    // 3 timber props + 4 mine sprites + (1 pennant + 2 festival props) = 10.
    expect(directiveObjects(layer)).toHaveLength(10);
  });

  it("clears a stale mark once its directive is no longer active", () => {
    const layer = new Container();
    renderDirectiveLayer(layer, ANCHORS, new Set(["openMine"]), BANNER_COLOR);
    expect(directiveObjects(layer).length).toBeGreaterThan(0);

    renderDirectiveLayer(layer, ANCHORS, new Set(), BANNER_COLOR);
    expect(directiveObjects(layer)).toEqual([]);
  });

  it("destroys what it removes rather than merely detaching it", () => {
    const layer = new Container();
    renderDirectiveLayer(layer, ANCHORS, new Set(["developTimber"]), BANNER_COLOR);
    const before = directiveObjects(layer);
    expect(before.length).toBeGreaterThan(0);

    renderDirectiveLayer(layer, ANCHORS, new Set(), BANNER_COLOR);
    expect(before.every((child) => child.destroyed)).toBe(true);
  });

  it("leaves children with a different label untouched", () => {
    const layer = new Container();
    const other = new Sprite();
    other.label = "not-a-directive-object";
    layer.addChild(other);

    renderDirectiveLayer(layer, ANCHORS, new Set(["openMine"]), BANNER_COLOR);
    renderDirectiveLayer(layer, ANCHORS, new Set(), BANNER_COLOR);

    expect(layer.children).toContain(other);
    expect(other.destroyed).toBe(false);
  });
});
