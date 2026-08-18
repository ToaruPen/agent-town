import type { DirectiveKind, Position } from "@agent-town/shared";
import { type Container, Graphics, Sprite } from "pixi.js";

import { objectDepth, SPRITE_ASSETS, TILE_SIZE, type WorldObjectKind } from "./sprites.js";

export const DIRECTIVE_OBJECT_LABEL = "directive-object";

/** Same idiom as `mapLayer.ts`'s stockpile props: a bare sprite sized to the tile grid, sorted by
 *  `objectDepth` among the layer's other direct children rather than nested in its own container. */
function addProp(
  layer: Container,
  path: string,
  anchor: Position,
  offsetX: number,
  offsetY: number,
  kind: WorldObjectKind,
): void {
  const sprite = Sprite.from(path);
  sprite.position.set(anchor.x * TILE_SIZE + offsetX, anchor.y * TILE_SIZE + offsetY);
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.label = DIRECTIVE_OBJECT_LABEL;
  sprite.zIndex = objectDepth(anchor.y, kind);
  layer.addChild(sprite);
}

const TIMBER_OFFSET = TILE_SIZE / 4;

/** `directive-sprites.md` Part 2: stump on the anchor, log and axe at quarter-tile offsets either
 *  side of it -- the same sub-tile idiom `mapLayer.ts` already uses for the stockpile's basket+log. */
function renderTimberCamp(layer: Container, anchor: Position): void {
  addProp(layer, SPRITE_ASSETS.directive.timber.stump, anchor, 0, 0, "resource");
  addProp(layer, SPRITE_ASSETS.directive.timber.log, anchor, TIMBER_OFFSET, 2, "stockpile");
  addProp(layer, SPRITE_ASSETS.directive.timber.axe, anchor, -TIMBER_OFFSET, -2, "stockpile");
}

const MINE_SPOIL_OFFSET = TILE_SIZE / 2;

/**
 * `directive-sprites.md` Part 3: the mine head fits the roof/wall/emblem grammar
 * `structureLayer.ts` already uses for real buildings, but it cannot flow through that module --
 * `FacilityKind` (`shared/spatial.ts`, frozen) has no `mineHead` member, so nothing here can become a
 * `Building`. The three tiles are drawn directly instead, at the same depth `objectDepth` would give a
 * `facility` on this tile, so a real building elsewhere on the map still sorts correctly against it.
 */
function renderMineHead(layer: Container, anchor: Position): void {
  addProp(layer, SPRITE_ASSETS.directive.mineHead.wall, anchor, 0, 0, "facility");
  addProp(layer, SPRITE_ASSETS.directive.mineHead.roof, anchor, 0, -TILE_SIZE, "facility");
  addProp(layer, SPRITE_ASSETS.directive.mineHead.emblem, anchor, 0, 0, "facility");
  addProp(layer, SPRITE_ASSETS.directive.mineHead.spoil, anchor, MINE_SPOIL_OFFSET, 0, "resource");
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

const FESTIVAL_PROP_OFFSET = TILE_SIZE / 4;

/**
 * `directive-sprites.md` Part 4: a pennant marks the festival itself; the sheaf and keg beneath it are
 * dressing, not a claim that anything was built -- `holdFestival` costs no materials and completes in
 * one season, so nothing here should read as construction.
 */
function renderFestival(layer: Container, anchor: Position, bannerColor: number): void {
  layer.addChild(pennantGraphic(anchor, bannerColor));
  addProp(
    layer,
    SPRITE_ASSETS.directive.festival.sheaf,
    anchor,
    -FESTIVAL_PROP_OFFSET,
    2,
    "stockpile",
  );
  addProp(
    layer,
    SPRITE_ASSETS.directive.festival.keg,
    anchor,
    FESTIVAL_PROP_OFFSET,
    2,
    "stockpile",
  );
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
  if (activeKinds.has("developTimber")) renderTimberCamp(layer, anchors.developTimber);
  if (activeKinds.has("openMine")) renderMineHead(layer, anchors.openMine);
  if (activeKinds.has("holdFestival")) renderFestival(layer, anchors.holdFestival, bannerColor);
}
