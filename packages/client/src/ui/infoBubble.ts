import {
  type AgentState,
  dayOfTick,
  type HistoricalLandmark,
  HOUSE_BUILD_TICKS,
  HOUSE_CAPACITY,
  type House,
  isWinter,
  type Position,
  type ResourceKind,
  type Tile,
  type WorldHistory,
  type WorldState,
} from "@agent-town/shared";
import { Container, type FederatedPointerEvent, Graphics, Rectangle, Text } from "pixi.js";

import { TILE_SIZE } from "../render/mapLayer.js";
import { layoutAgentsFrontToBack, layoutAgentsOnTiles } from "../render/sprites.js";
import { buildProviderBadge } from "./providerBadge.js";
import type { DeathEvent } from "./survivalViewModel.js";
import { buildSurvivalHudViewModel } from "./survivalViewModel.js";

const MAX_TAP_DISTANCE = 8;
const MAX_TAP_DURATION_MS = 300;
const BUBBLE_FONT_SIZE = 8;
const BUBBLE_LINE_HEIGHT = 10;
const BUBBLE_MAX_TEXT_WIDTH = 150;
const BUBBLE_PADDING = 5;
const BUBBLE_RADIUS = 3;
const BUBBLE_TAIL_SIZE = 4;
const BUBBLE_EDGE_GAP = 2;
const BUBBLE_FILL_COLOR = 0xfff8dc;
const BUBBLE_STROKE_COLOR = 0x34302a;
const BUBBLE_TEXT_COLOR = 0x241f1a;

export const INFO_BUBBLE_LABEL = "info-bubble";

export type InfoBubbleTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "tombstone"; eventId: string }
  | { kind: "house"; pos: Position }
  | { kind: "landmark"; landmarkId: string }
  | { kind: "stockpile" }
  | { kind: "resource"; tileIndex: number; resourceKind: ResourceKind }
  | { kind: "terrain"; tileIndex: number };

export interface AgentBubbleText {
  title: string;
  badge: string;
  lines: string[];
}

export interface TapPoint {
  x: number;
  y: number;
  at: number;
}

export interface InfoBubblePointer extends TapPoint {
  pointerId: number;
}

export interface InfoBubbleGesture {
  canActivate(): boolean;
  cancel(): void;
  end(pointer: InfoBubblePointer, releasedInside: boolean): boolean;
  move(pointer: InfoBubblePointer): "inactive" | "invalid" | "pending";
  start(pointer: InfoBubblePointer): void;
}

export interface InfoBubblePlacement {
  x: number;
  top: number;
  bottom: number;
}

export interface ScreenBounds {
  width: number;
  height: number;
}

export interface ScreenBubblePlacement {
  x: number;
  y: number;
  below: boolean;
  boxTop: number;
  boxBottom: number;
}

export interface InfoBubbleRenderGate {
  begin(): void;
  canActivate(): boolean;
  cancel(): void;
  end(): void;
  shouldRender(dirty: boolean): boolean;
}

export interface InfoBubbleViewModel extends AgentBubbleText {
  agentId: string | null;
  placement: InfoBubblePlacement;
}

const HIT_PRIORITIES: Record<InfoBubbleTarget["kind"], number> = {
  agent: 7,
  tombstone: 6,
  house: 5,
  landmark: 4,
  stockpile: 3,
  resource: 2,
  terrain: 1,
};

function firstThoughtLine(thought: string | null): string {
  if (thought === null) return "No thought recorded.";
  return thought.split(/\r?\n/, 1)[0] ?? "No thought recorded.";
}

export function buildAgentBubbleText(agent: AgentState): AgentBubbleText {
  return {
    title: agent.name,
    badge: buildProviderBadge(agent).label,
    lines: [
      `${agent.activity.kind} · H ${Math.round(agent.hunger)} · F ${Math.round(agent.fatigue)} · HP ${Math.round(agent.health)}`,
      firstThoughtLine(agent.lastThought),
    ],
  };
}

export function buildResourceBubbleText(
  tile: Tile,
  resourceKind: ResourceKind,
  tick: number,
): string {
  const title = resourceKind === "wood" ? "Tree" : "Berries";
  const resource = tile.resource?.kind === resourceKind ? tile.resource : null;
  if (resource !== null && resource.amount > 0) {
    return `${title} — ${resourceKind} ${resource.amount} remaining`;
  }
  const dormancy = isWinter(tick) ? " (dormant in winter)" : "";
  return `${title} — depleted; regrows daily${dormancy}`;
}

export function buildHouseBubbleText(house: House): string {
  if (house.complete) return `House — capacity ${HOUSE_CAPACITY}`;
  const percentage = Math.round((Math.max(0, house.progress) / HOUSE_BUILD_TICKS) * 100);
  return `House — under construction ${Math.min(percentage, 100)}%`;
}

export function buildStockpileBubbleText(world: WorldState): string {
  const forecast = buildSurvivalHudViewModel(world);
  return `Stockpile — wood ${world.stockpile.wood} · food ${world.stockpile.food} · ${forecast.foodDays} food-days`;
}

export function buildTombstoneBubbleText(event: DeathEvent): string {
  return `Here lies ${event.name} — died day ${dayOfTick(event.deathTick)} of ${event.cause}`;
}

export function buildLandmarkBubbleText(
  landmark: HistoricalLandmark,
  history: WorldHistory,
): string {
  const event = history.events.find(({ id }) => id === landmark.foundedByEventId);
  if (event === undefined) return `${landmark.name} — origin unknown`;
  const relation =
    landmark.kind === "borderFort"
      ? "raised after"
      : landmark.kind === "ruin"
        ? "left by"
        : "sealed after";
  return `${landmark.name} — ${relation} ${event.title}, year ${event.year}`;
}

export function buildTerrainBubbleText(tile: Tile, position: Position): string {
  const terrain = `${tile.terrain[0]?.toUpperCase() ?? ""}${tile.terrain.slice(1)}`;
  return `${terrain} — (${position.x}, ${position.y})`;
}

export function resolveHitPriority(targets: InfoBubbleTarget[]): InfoBubbleTarget | null {
  let best: InfoBubbleTarget | null = null;
  for (const target of targets) {
    if (best === null || HIT_PRIORITIES[target.kind] > HIT_PRIORITIES[best.kind]) best = target;
  }
  return best;
}

export function isTapGesture(start: TapPoint, end: TapPoint): boolean {
  const elapsed = end.at - start.at;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  return elapsed >= 0 && elapsed < MAX_TAP_DURATION_MS && distance <= MAX_TAP_DISTANCE;
}

export function createInfoBubbleGesture(): InfoBubbleGesture {
  let startPointer: InfoBubblePointer | null = null;
  let activationAllowed = false;
  return {
    canActivate(): boolean {
      return activationAllowed;
    },
    cancel(): void {
      startPointer = null;
      activationAllowed = false;
    },
    end(pointer: InfoBubblePointer, releasedInside: boolean): boolean {
      activationAllowed =
        releasedInside &&
        startPointer?.pointerId === pointer.pointerId &&
        isTapGesture(startPointer, pointer);
      startPointer = null;
      return activationAllowed;
    },
    move(pointer: InfoBubblePointer): "inactive" | "invalid" | "pending" {
      if (startPointer?.pointerId !== pointer.pointerId) return "inactive";
      const distanceOnlyEnd = { ...pointer, at: startPointer.at };
      if (isTapGesture(startPointer, distanceOnlyEnd)) return "pending";
      startPointer = null;
      activationAllowed = false;
      return "invalid";
    },
    start(pointer: InfoBubblePointer): void {
      startPointer = pointer;
      activationAllowed = false;
    },
  };
}

export function preserveInfoBubbleInvalidation(
  dirty: boolean,
  activeTarget: InfoBubbleTarget | null,
): boolean {
  return dirty || activeTarget !== null;
}

function positionsEqual(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y;
}

function tilePositionAt(world: WorldState, point: Position): Position | null {
  const position = { x: Math.floor(point.x / TILE_SIZE), y: Math.floor(point.y / TILE_SIZE) };
  if (position.x < 0 || position.y < 0 || position.x >= world.width || position.y >= world.height) {
    return null;
  }
  return position;
}

function containsAgent(point: Position, center: Position): boolean {
  const halfSize = TILE_SIZE / 2;
  return Math.abs(point.x - center.x) <= halfSize && Math.abs(point.y - center.y) <= halfSize;
}

function agentHits(world: WorldState, point: Position): InfoBubbleTarget[] {
  return layoutAgentsFrontToBack(world.agents)
    .filter(({ agent, offset }) =>
      containsAgent(point, {
        x: agent.pos.x * TILE_SIZE + TILE_SIZE / 2 + offset.x,
        y: agent.pos.y * TILE_SIZE + TILE_SIZE / 2 + offset.y,
      }),
    )
    .map(({ agent }) => ({ kind: "agent", agentId: agent.id }));
}

function resourceKindAt(
  tile: Tile,
  tileIndex: number,
  knownResourceKinds: ReadonlyMap<number, ResourceKind>,
): ResourceKind | null {
  if (tile.resource !== null) return tile.resource.kind;
  if (tile.resourceOrigin !== undefined) return tile.resourceOrigin;
  if (tile.terrain === "forest") return "wood";
  return knownResourceKinds.get(tileIndex) ?? null;
}

function appendTombstoneHits(
  hits: InfoBubbleTarget[],
  deathEvents: DeathEvent[],
  tilePosition: Position,
): void {
  for (const event of deathEvents.toReversed()) {
    if (event.pos !== null && positionsEqual(event.pos, tilePosition)) {
      hits.push({ kind: "tombstone", eventId: event.id });
    }
  }
}

function appendHouseHits(
  hits: InfoBubbleTarget[],
  houses: WorldState["buildings"],
  tilePosition: Position,
): void {
  for (const house of houses.toReversed()) {
    if (positionsEqual(house.pos, tilePosition)) hits.push({ kind: "house", pos: house.pos });
  }
}

function appendLandmarkHits(
  hits: InfoBubbleTarget[],
  landmarks: WorldHistory["landmarks"],
  tilePosition: Position,
): void {
  for (const landmark of landmarks.toReversed()) {
    if (positionsEqual(landmark.pos, tilePosition)) {
      hits.push({ kind: "landmark", landmarkId: landmark.id });
    }
  }
}

export function resolveInfoBubbleTarget(
  world: WorldState,
  deathEvents: DeathEvent[],
  knownResourceKinds: ReadonlyMap<number, ResourceKind>,
  point: Position,
): InfoBubbleTarget | null {
  const tilePosition = tilePositionAt(world, point);
  if (tilePosition === null) return null;
  const tileIndex = tilePosition.y * world.width + tilePosition.x;
  const tile = world.tiles[tileIndex];
  if (tile === undefined) return null;

  const hits: InfoBubbleTarget[] = agentHits(world, point);
  appendTombstoneHits(hits, deathEvents, tilePosition);
  appendHouseHits(hits, world.buildings, tilePosition);
  appendLandmarkHits(hits, world.history.landmarks, tilePosition);
  if (positionsEqual(world.stockpile.pos, tilePosition)) hits.push({ kind: "stockpile" });
  const resourceKind = resourceKindAt(tile, tileIndex, knownResourceKinds);
  if (resourceKind !== null) hits.push({ kind: "resource", tileIndex, resourceKind });
  hits.push({ kind: "terrain", tileIndex });
  return resolveHitPriority(hits);
}

export function resolveHoveredAgentId(
  world: WorldState,
  deathEvents: DeathEvent[],
  knownResourceKinds: ReadonlyMap<number, ResourceKind>,
  point: Position,
): string | null {
  const target = resolveInfoBubbleTarget(world, deathEvents, knownResourceKinds, point);
  return target?.kind === "agent" ? target.agentId : null;
}

export function resolveHoveredAgentAtScreen(
  world: WorldState,
  deathEvents: DeathEvent[],
  knownResourceKinds: ReadonlyMap<number, ResourceKind>,
  screenPoint: Position,
  toWorldPoint: (point: Position) => Position,
): string | null {
  return resolveHoveredAgentId(world, deathEvents, knownResourceKinds, toWorldPoint(screenPoint));
}

export function mapInfoBubblePlacementToScreen(
  placement: InfoBubblePlacement,
  toScreenPoint: (point: Position) => Position,
): InfoBubblePlacement {
  const top = toScreenPoint({ x: placement.x, y: placement.top });
  const bottom = toScreenPoint({ x: placement.x, y: placement.bottom });
  return { x: top.x, top: top.y, bottom: bottom.y };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function resolveScreenBubblePlacement(
  anchor: InfoBubblePlacement,
  bubble: ScreenBounds,
  viewport: ScreenBounds,
): ScreenBubblePlacement {
  const aboveSpace = anchor.top - BUBBLE_EDGE_GAP;
  const belowSpace = viewport.height - anchor.bottom - BUBBLE_EDGE_GAP;
  const neededSpace = bubble.height + BUBBLE_TAIL_SIZE;
  const below = aboveSpace < neededSpace && belowSpace >= aboveSpace;
  const rawTop = below
    ? anchor.bottom + BUBBLE_TAIL_SIZE
    : anchor.top - BUBBLE_TAIL_SIZE - bubble.height;
  const maximumTop = Math.max(BUBBLE_EDGE_GAP, viewport.height - bubble.height - BUBBLE_EDGE_GAP);
  const boxTop = clamp(rawTop, BUBBLE_EDGE_GAP, maximumTop);
  const minimumX = bubble.width / 2 + BUBBLE_EDGE_GAP;
  const maximumX = Math.max(minimumX, viewport.width - bubble.width / 2 - BUBBLE_EDGE_GAP);
  return {
    x: clamp(anchor.x, minimumX, maximumX),
    y: below ? boxTop - BUBBLE_TAIL_SIZE : boxTop + bubble.height + BUBBLE_TAIL_SIZE,
    below,
    boxTop,
    boxBottom: boxTop + bubble.height,
  };
}

function tilePlacement(position: Position): InfoBubblePlacement {
  return {
    x: position.x * TILE_SIZE + TILE_SIZE / 2,
    top: position.y * TILE_SIZE,
    bottom: (position.y + 1) * TILE_SIZE,
  };
}

function textBubble(text: string, placement: InfoBubblePlacement): InfoBubbleViewModel {
  return { title: text, badge: "", lines: [], agentId: null, placement };
}

function agentBubble(
  target: Extract<InfoBubbleTarget, { kind: "agent" }>,
  world: WorldState,
): InfoBubbleViewModel | null {
  const placed = layoutAgentsOnTiles(world.agents).find(({ agent }) => agent.id === target.agentId);
  if (placed === undefined) return null;
  const center = {
    x: placed.agent.pos.x * TILE_SIZE + TILE_SIZE / 2 + placed.offset.x,
    y: placed.agent.pos.y * TILE_SIZE + TILE_SIZE / 2 + placed.offset.y,
  };
  return {
    ...buildAgentBubbleText(placed.agent),
    agentId: placed.agent.id,
    placement: { x: center.x, top: center.y - TILE_SIZE / 2, bottom: center.y + TILE_SIZE / 2 },
  };
}

function tileFromTarget(
  target: Extract<InfoBubbleTarget, { kind: "resource" | "terrain" }>,
  world: WorldState,
): { tile: Tile; position: Position } | null {
  const tile = world.tiles[target.tileIndex];
  if (tile === undefined) return null;
  return {
    tile,
    position: { x: target.tileIndex % world.width, y: Math.floor(target.tileIndex / world.width) },
  };
}

function stockpileBubble(world: WorldState): InfoBubbleViewModel {
  return textBubble(buildStockpileBubbleText(world), tilePlacement(world.stockpile.pos));
}

function houseBubble(
  target: Extract<InfoBubbleTarget, { kind: "house" }>,
  world: WorldState,
): InfoBubbleViewModel | null {
  const house = world.buildings.find(({ pos }) => positionsEqual(pos, target.pos));
  return house === undefined
    ? null
    : textBubble(buildHouseBubbleText(house), tilePlacement(house.pos));
}

function tombstoneBubble(
  target: Extract<InfoBubbleTarget, { kind: "tombstone" }>,
  deathEvents: DeathEvent[],
): InfoBubbleViewModel | null {
  const event = deathEvents.find(({ id }) => id === target.eventId);
  return event?.pos === null || event === undefined
    ? null
    : textBubble(buildTombstoneBubbleText(event), tilePlacement(event.pos));
}

function landmarkBubble(
  target: Extract<InfoBubbleTarget, { kind: "landmark" }>,
  world: WorldState,
): InfoBubbleViewModel | null {
  const landmark = world.history.landmarks.find(({ id }) => id === target.landmarkId);
  return landmark === undefined
    ? null
    : textBubble(buildLandmarkBubbleText(landmark, world.history), tilePlacement(landmark.pos));
}

function tileBubble(
  target: Extract<InfoBubbleTarget, { kind: "resource" | "terrain" }>,
  world: WorldState,
): InfoBubbleViewModel | null {
  const selected = tileFromTarget(target, world);
  if (selected === null) return null;
  const text =
    target.kind === "resource"
      ? buildResourceBubbleText(selected.tile, target.resourceKind, world.tick)
      : buildTerrainBubbleText(selected.tile, selected.position);
  return textBubble(text, tilePlacement(selected.position));
}

export function buildInfoBubbleViewModel(
  target: InfoBubbleTarget,
  world: WorldState,
  deathEvents: DeathEvent[],
): InfoBubbleViewModel | null {
  if (target.kind === "agent") return agentBubble(target, world);
  if (target.kind === "stockpile") return stockpileBubble(world);
  if (target.kind === "house") return houseBubble(target, world);
  if (target.kind === "tombstone") return tombstoneBubble(target, deathEvents);
  if (target.kind === "landmark") return landmarkBubble(target, world);
  return tileBubble(target, world);
}

export function bubbleText(viewModel: InfoBubbleViewModel): string {
  const badge = viewModel.badge === "" ? "" : `  [${viewModel.badge}]`;
  return [`${viewModel.title}${badge}`, ...viewModel.lines].join("\n");
}

interface PropagatingEvent {
  stopPropagation(): void;
}

export function createInfoBubbleRenderGate(): InfoBubbleRenderGate {
  let interactionActive = false;
  let activationCancelled = false;
  return {
    begin(): void {
      if (!activationCancelled) interactionActive = true;
    },
    canActivate(): boolean {
      return !activationCancelled;
    },
    cancel(): void {
      activationCancelled = true;
      interactionActive = false;
    },
    end(): void {
      interactionActive = false;
    },
    shouldRender(dirty: boolean): boolean {
      return dirty && !interactionActive;
    },
  };
}

export function beginInfoBubbleInteraction(
  event: PropagatingEvent,
  clearGestureHistory: () => void,
  onInteractionStart: () => void = () => undefined,
): void {
  event.stopPropagation();
  onInteractionStart();
  clearGestureHistory();
}

export function endInfoBubbleInteraction(
  event: PropagatingEvent,
  onInteractionEnd: () => void,
): void {
  event.stopPropagation();
  onInteractionEnd();
}

export function activateInfoBubble(
  event: PropagatingEvent,
  agentId: string | null,
  clearGestureHistory: () => void,
  onAgentOpen: (agentId: string) => void,
  canActivate: () => boolean = () => true,
): void {
  beginInfoBubbleInteraction(event, clearGestureHistory);
  if (agentId !== null && canActivate()) onAgentOpen(agentId);
}

function bubbleBackground(width: number, height: number, below: boolean): Graphics {
  const boxY = below ? BUBBLE_TAIL_SIZE : -height - BUBBLE_TAIL_SIZE;
  const tail = below
    ? [-BUBBLE_TAIL_SIZE, BUBBLE_TAIL_SIZE, 0, 0, BUBBLE_TAIL_SIZE, BUBBLE_TAIL_SIZE]
    : [-BUBBLE_TAIL_SIZE, -BUBBLE_TAIL_SIZE, 0, 0, BUBBLE_TAIL_SIZE, -BUBBLE_TAIL_SIZE];
  return new Graphics()
    .roundRect(-width / 2, boxY, width, height, BUBBLE_RADIUS)
    .fill(BUBBLE_FILL_COLOR)
    .stroke({ color: BUBBLE_STROKE_COLOR, width: 1 })
    .poly(tail)
    .fill(BUBBLE_FILL_COLOR)
    .stroke({ color: BUBBLE_STROKE_COLOR, width: 1 });
}

export function renderInfoBubble(
  layer: Container,
  viewModel: InfoBubbleViewModel | null,
  viewport: ScreenBounds,
  onAgentOpen: (agentId: string) => void,
  clearGestureHistory: () => void,
  onInteractionStart: (event: FederatedPointerEvent) => void,
  onInteractionEnd: (event: FederatedPointerEvent, releasedInside: boolean) => void,
  canActivate: () => boolean,
): void {
  for (const child of layer.removeChildren()) child.destroy({ children: true });
  if (viewModel === null) return;

  const label = new Text({
    text: bubbleText(viewModel),
    style: {
      fontFamily: "monospace",
      fontSize: BUBBLE_FONT_SIZE,
      lineHeight: BUBBLE_LINE_HEIGHT,
      fill: BUBBLE_TEXT_COLOR,
      wordWrap: true,
      wordWrapWidth: BUBBLE_MAX_TEXT_WIDTH,
    },
  });
  label.anchor.set(0.5, 0);
  const width = label.width + BUBBLE_PADDING * 2;
  const height = label.height + BUBBLE_PADDING * 2;
  const placement = resolveScreenBubblePlacement(viewModel.placement, { width, height }, viewport);
  const { below } = placement;
  const boxY = below ? BUBBLE_TAIL_SIZE : -height - BUBBLE_TAIL_SIZE;
  label.position.y = boxY + BUBBLE_PADDING;

  const bubble = new Container();
  bubble.label = INFO_BUBBLE_LABEL;
  bubble.eventMode = "static";
  bubble.interactiveChildren = false;
  bubble.cursor = viewModel.agentId === null ? "default" : "pointer";
  bubble.hitArea = new Rectangle(-width / 2, boxY, width, height);
  bubble.position.set(placement.x, placement.y);
  bubble.on("pointerdown", (event: FederatedPointerEvent) => {
    beginInfoBubbleInteraction(event, clearGestureHistory, () => onInteractionStart(event));
  });
  for (const eventName of ["pointerup", "pointerupoutside", "pointercancel"] as const) {
    bubble.on(eventName, (event: FederatedPointerEvent) => {
      endInfoBubbleInteraction(event, () => onInteractionEnd(event, eventName === "pointerup"));
    });
  }
  bubble.on("pointertap", (event: FederatedPointerEvent) => {
    activateInfoBubble(event, viewModel.agentId, clearGestureHistory, onAgentOpen, canActivate);
  });
  bubble.addChild(bubbleBackground(width, height, below), label);
  layer.addChild(bubble);
}
