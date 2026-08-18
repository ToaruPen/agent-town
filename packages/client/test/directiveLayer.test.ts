import type { DirectiveKind, Position } from "@agent-town/shared";
import type { FillInstruction, GraphicsInstructions } from "pixi.js";
import { Container, Graphics, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";

import {
  DIRECTIVE_OBJECT_LABEL,
  festivalSpriteProps,
  mineHeadProps,
  renderDirectiveLayer,
  timberCampProps,
} from "../src/render/directiveLayer.js";
import { objectDepth, SPRITE_ASSETS, TILE_SIZE } from "../src/render/sprites.js";

const ANCHORS: Readonly<Record<DirectiveKind, Position>> = {
  clearFarmland: { x: 30, y: 20 },
  developTimber: { x: 10, y: 12 },
  openMine: { x: 45, y: 8 },
  growCity: { x: 50, y: 40 },
  encourageStores: { x: 5, y: 5 },
  holdFestival: { x: 20, y: 30 },
};
const BANNER_COLOR = 0x6f9f91;

/**
 * `Sprite.from(path)` returns the same placeholder texture for every unpreloaded path in the
 * vitest/node test environment (`a.texture === b.texture` regardless of `path`), so a test asserting
 * on rendered `Sprite`s cannot tell a swapped stump/log/axe apart, nor prove they aren't all the same
 * tile. These three `describe` blocks assert on the pure prop-description functions directly instead,
 * where `path` is plain data: a swapped or duplicated path fails one of these by name.
 */
describe("timberCampProps", () => {
  it("gives the stump, log and axe their own vendored tile, at quarter-tile offsets from the anchor", () => {
    const anchor = ANCHORS.developTimber;
    const baseX = anchor.x * TILE_SIZE;
    const baseY = anchor.y * TILE_SIZE;

    expect(timberCampProps(anchor)).toEqual([
      {
        path: SPRITE_ASSETS.directive.timber.stump,
        pos: { x: baseX, y: baseY },
        depth: objectDepth(anchor.y, "resource"),
      },
      {
        path: SPRITE_ASSETS.directive.timber.log,
        pos: { x: baseX + TILE_SIZE / 4, y: baseY + 2 },
        depth: objectDepth(anchor.y, "stockpile"),
      },
      {
        path: SPRITE_ASSETS.directive.timber.axe,
        pos: { x: baseX - TILE_SIZE / 4, y: baseY - 2 },
        depth: objectDepth(anchor.y, "stockpile"),
      },
    ]);
  });
});

describe("mineHeadProps", () => {
  it("gives the wall, roof, emblem and spoil their own vendored tile, roof above and spoil beside the anchor", () => {
    const anchor = ANCHORS.openMine;
    const baseX = anchor.x * TILE_SIZE;
    const baseY = anchor.y * TILE_SIZE;
    const facilityDepth = objectDepth(anchor.y, "facility");

    expect(mineHeadProps(anchor)).toEqual([
      {
        path: SPRITE_ASSETS.directive.mineHead.wall,
        pos: { x: baseX, y: baseY },
        depth: facilityDepth,
      },
      {
        path: SPRITE_ASSETS.directive.mineHead.roof,
        pos: { x: baseX, y: baseY - TILE_SIZE },
        depth: facilityDepth,
      },
      {
        path: SPRITE_ASSETS.directive.mineHead.emblem,
        pos: { x: baseX, y: baseY },
        depth: facilityDepth,
      },
      {
        path: SPRITE_ASSETS.directive.mineHead.spoil,
        pos: { x: baseX + TILE_SIZE / 2, y: baseY },
        depth: objectDepth(anchor.y, "resource"),
      },
    ]);
  });
});

describe("festivalSpriteProps", () => {
  it("gives the sheaf and keg their own vendored tile, either side of the pennant", () => {
    const anchor = ANCHORS.holdFestival;
    const baseX = anchor.x * TILE_SIZE;
    const baseY = anchor.y * TILE_SIZE;
    const stockpileDepth = objectDepth(anchor.y, "stockpile");

    expect(festivalSpriteProps(anchor)).toEqual([
      {
        path: SPRITE_ASSETS.directive.festival.sheaf,
        pos: { x: baseX - TILE_SIZE / 4, y: baseY + 2 },
        depth: stockpileDepth,
      },
      {
        path: SPRITE_ASSETS.directive.festival.keg,
        pos: { x: baseX + TILE_SIZE / 4, y: baseY + 2 },
        depth: stockpileDepth,
      },
    ]);
  });
});

function directiveObjects(layer: Container): (Sprite | Graphics)[] {
  return layer.children.filter(
    (child): child is Sprite | Graphics =>
      child.label === DIRECTIVE_OBJECT_LABEL &&
      (child instanceof Sprite || child instanceof Graphics),
  );
}

function isFillInstruction(instruction: GraphicsInstructions): instruction is FillInstruction {
  return instruction.action === "fill";
}

/**
 * Wiring proof: given the prop lists above are already checked for content, these confirm
 * `renderDirectiveLayer` actually draws one Pixi object per description, gates by `activeKinds`, and
 * clears its own children correctly on the next call -- not what path each sprite ended up with.
 */
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

  it("draws one sprite per timberCampProps entry when developTimber is active", () => {
    const layer = new Container();
    renderDirectiveLayer(layer, ANCHORS, new Set(["developTimber"]), BANNER_COLOR);
    expect(directiveObjects(layer)).toHaveLength(timberCampProps(ANCHORS.developTimber).length);
  });

  it("draws one sprite per mineHeadProps entry when openMine is active", () => {
    const layer = new Container();
    renderDirectiveLayer(layer, ANCHORS, new Set(["openMine"]), BANNER_COLOR);
    expect(directiveObjects(layer)).toHaveLength(mineHeadProps(ANCHORS.openMine).length);
  });

  describe("holdFestival", () => {
    it("draws a pennant filled with the nation's banner colour, plus one sprite per festivalSpriteProps entry", () => {
      const layer = new Container();
      renderDirectiveLayer(layer, ANCHORS, new Set(["holdFestival"]), BANNER_COLOR);

      const objects = directiveObjects(layer);
      const pennants = objects.filter((child): child is Graphics => child instanceof Graphics);
      const sprites = objects.filter((child): child is Sprite => child instanceof Sprite);
      expect(pennants).toHaveLength(1);
      expect(sprites).toHaveLength(festivalSpriteProps(ANCHORS.holdFestival).length);

      const anchor = ANCHORS.holdFestival;
      const pennant = pennants[0];
      expect(pennant?.position).toMatchObject({ x: anchor.x * TILE_SIZE, y: anchor.y * TILE_SIZE });
      expect(pennant?.zIndex).toBe(objectDepth(anchor.y, "landmark"));

      const fill = pennant?.context.instructions.filter(isFillInstruction).at(-1);
      expect(fill?.data.style.color).toBe(BANNER_COLOR);
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
    const expectedCount =
      timberCampProps(ANCHORS.developTimber).length +
      mineHeadProps(ANCHORS.openMine).length +
      1 + // pennant
      festivalSpriteProps(ANCHORS.holdFestival).length;
    expect(directiveObjects(layer)).toHaveLength(expectedCount);
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
