import type { Position, ResourceKind, WorldState } from "@agent-town/shared";

import { TILE_SIZE } from "../render/mapLayer.js";
import { type InfoBubbleTarget, resolveInfoBubbleTarget } from "./infoBubble.js";
import type { DeathEvent } from "./survivalViewModel.js";

type ArrowKey = "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp";
export type KeyboardActivationAction = "open-agent" | "show-bubble";

const ARROW_DELTAS: Record<ArrowKey, Position> = {
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
};

function clamp(value: number, maximum: number): number {
  return Math.min(Math.max(value, 0), maximum);
}

function isArrowKey(key: string): key is ArrowKey {
  return key in ARROW_DELTAS;
}

export function moveTileCursor(
  cursor: Position,
  key: string,
  worldWidth: number,
  worldHeight: number,
): Position {
  if (!isArrowKey(key)) return cursor;
  const delta = ARROW_DELTAS[key];
  return {
    x: clamp(cursor.x + delta.x, Math.max(0, worldWidth - 1)),
    y: clamp(cursor.y + delta.y, Math.max(0, worldHeight - 1)),
  };
}

export function resolveKeyboardTarget(
  world: WorldState,
  deathEvents: DeathEvent[],
  knownResourceKinds: ReadonlyMap<number, ResourceKind>,
  cursor: Position,
): InfoBubbleTarget | null {
  return resolveInfoBubbleTarget(world, deathEvents, knownResourceKinds, {
    x: cursor.x * TILE_SIZE + TILE_SIZE / 2,
    y: cursor.y * TILE_SIZE + TILE_SIZE / 2,
  });
}

export function keyboardActivationAction(
  activeTarget: InfoBubbleTarget | null,
  nextTarget: InfoBubbleTarget,
): KeyboardActivationAction {
  return activeTarget?.kind === "agent" &&
    nextTarget.kind === "agent" &&
    activeTarget.agentId === nextTarget.agentId
    ? "open-agent"
    : "show-bubble";
}
