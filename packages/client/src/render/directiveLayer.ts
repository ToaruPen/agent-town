import type { DirectiveKind, Position } from "@agent-town/shared";
import { type Container, Graphics, Sprite } from "pixi.js";

import { objectDepth, SPRITE_ASSETS, TILE_SIZE, type WorldObjectKind } from "./sprites.js";

export const DIRECTIVE_OBJECT_LABEL = "directive-object";

/**
 * One sprite's worth of what `renderDirectiveLayer` draws, kept separate from the Pixi calls that
 * realize it. `Sprite.from(path)` returns the same placeholder texture for every unpreloaded path in
 * the vitest/node test environment, so a test asserting on rendered `Sprite`s cannot tell a swapped
 * path from a correct one; asserting on this data directly (see `timberCampProps` and friends in
 * `directiveLayer.test.ts`) can.
 */
export interface DirectiveProp {
  readonly path: string;
  /** Pixel position, already offset from the anchor -- not a tile position. */
  readonly pos: Position;
  readonly depth: number;
}

function prop(
  path: string,
  anchor: Position,
  offsetX: number,
  offsetY: number,
  kind: WorldObjectKind,
): DirectiveProp {
  return {
    path,
    pos: { x: anchor.x * TILE_SIZE + offsetX, y: anchor.y * TILE_SIZE + offsetY },
    depth: objectDepth(anchor.y, kind),
  };
}

const TIMBER_OFFSET = TILE_SIZE / 4;

/** `directive-sprites.md` Part 2: stump on the anchor, log and axe at quarter-tile offsets either
 *  side of it -- the same sub-tile idiom `mapLayer.ts` already uses for the stockpile's basket+log. */
export function timberCampProps(anchor: Position): readonly DirectiveProp[] {
  return [
    prop(SPRITE_ASSETS.directive.timber.stump, anchor, 0, 0, "resource"),
    prop(SPRITE_ASSETS.directive.timber.log, anchor, TIMBER_OFFSET, 2, "stockpile"),
    prop(SPRITE_ASSETS.directive.timber.axe, anchor, -TIMBER_OFFSET, -2, "stockpile"),
  ];
}

const MINE_SPOIL_OFFSET = TILE_SIZE / 2;

/**
 * `directive-sprites.md` Part 3: the mine head fits the roof/wall/emblem grammar
 * `structureLayer.ts` already uses for real buildings, but it cannot flow through that module --
 * `FacilityKind` (`shared/spatial.ts`, frozen) has no `mineHead` member, so nothing here can become a
 * `Building`. The three tiles are drawn directly instead, at the same depth `objectDepth` would give a
 * `facility` on this tile, so a real building elsewhere on the map still sorts correctly against it.
 */
export function mineHeadProps(anchor: Position): readonly DirectiveProp[] {
  return [
    prop(SPRITE_ASSETS.directive.mineHead.wall, anchor, 0, 0, "facility"),
    prop(SPRITE_ASSETS.directive.mineHead.roof, anchor, 0, -TILE_SIZE, "facility"),
    prop(SPRITE_ASSETS.directive.mineHead.emblem, anchor, 0, 0, "facility"),
    prop(SPRITE_ASSETS.directive.mineHead.spoil, anchor, MINE_SPOIL_OFFSET, 0, "resource"),
  ];
}

const FESTIVAL_PROP_OFFSET = TILE_SIZE / 4;

/** `directive-sprites.md` Part 4: the sheaf and keg drawn beside the pennant (`pennantGraphic` below)
 *  -- dressing, not a claim that anything was built, since `holdFestival` costs no materials and
 *  completes in one season. */
export function festivalSpriteProps(anchor: Position): readonly DirectiveProp[] {
  return [
    prop(SPRITE_ASSETS.directive.festival.sheaf, anchor, -FESTIVAL_PROP_OFFSET, 2, "stockpile"),
    prop(SPRITE_ASSETS.directive.festival.keg, anchor, FESTIVAL_PROP_OFFSET, 2, "stockpile"),
  ];
}

/** Same idiom as `mapLayer.ts`'s stockpile props: a bare sprite sized to the tile grid, sorted by
 *  `objectDepth` among the layer's other direct children rather than nested in its own container. */
function drawProps(layer: Container, props: readonly DirectiveProp[]): void {
  for (const description of props) {
    const sprite = Sprite.from(description.path);
    sprite.position.set(description.pos.x, description.pos.y);
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.label = DIRECTIVE_OBJECT_LABEL;
    sprite.zIndex = description.depth;
    layer.addChild(sprite);
  }
}

/** Drawn fresh rather than extracted from the frozen `historyLayer.ts`'s `drawBorderFort` (which
 *  `directive-sprites.md` D-1 proposed): AGENTS.md freezes the client's resident/terrain renderers and
 *  says a frozen boundary that looks wrong is a stop-and-report, not an edit. Same five-call shape --
 *  a 1px pole and a 5x3 pennant triangle -- filled with the nation's own banner colour instead of a
 *  fixed ember tone, so an active festival also reads as *whose* festival. */
const PENNANT_POLE_COLOR = 0x8c8f8b;

function pennantGraphic(anchor: Position, flagColor: number): Graphics {
  const graphic = new Graphics()
    .moveTo(8, 7)
    .lineTo(8, 2)
    .stroke({ color: PENNANT_POLE_COLOR, width: 1 })
    .poly([8, 2, 13, 4, 8, 5])
    .fill(flagColor);
  graphic.position.set(anchor.x * TILE_SIZE, anchor.y * TILE_SIZE);
  graphic.label = DIRECTIVE_OBJECT_LABEL;
  graphic.zIndex = objectDepth(anchor.y, "landmark");
  return graphic;
}

function clearDirectiveObjects(layer: Container): void {
  for (const child of [...layer.children]) {
    if (child.label !== DIRECTIVE_OBJECT_LABEL) continue;
    layer.removeChild(child);
    child.destroy({ children: true });
  }
}

/**
 * Draws the three directives `directive-sprites.md` could not give a `Building` shape --
 * `developTimber`, `openMine`, `holdFestival`. `clearFarmland` and `encourageStores` render as
 * ordinary buildings from `cityScene.ts`'s own synthesis instead; `growCity` draws nothing here at
 * all, its effect being the house count and street grid `cityScene.ts` already grows with
 * `developmentLevel`. Visible only for the `DirectiveKind`s present in `activeKinds`, matching every
 * other mark in the local view: a directive that has completed leaves `activeDirectives`, and with it
 * this layer, because the client has no other record that it ever ran.
 */
export function renderDirectiveLayer(
  layer: Container,
  anchors: Readonly<Record<DirectiveKind, Position>>,
  activeKinds: ReadonlySet<DirectiveKind>,
  bannerColor: number,
): void {
  clearDirectiveObjects(layer);
  if (activeKinds.has("developTimber")) drawProps(layer, timberCampProps(anchors.developTimber));
  if (activeKinds.has("openMine")) drawProps(layer, mineHeadProps(anchors.openMine));
  if (activeKinds.has("holdFestival")) {
    layer.addChild(pennantGraphic(anchors.holdFestival, bannerColor));
    drawProps(layer, festivalSpriteProps(anchors.holdFestival));
  }
}
