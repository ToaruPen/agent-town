import type { AgentState } from "@agent-town/shared";
import { Container, Rectangle } from "pixi.js";
import { describe, expect, it } from "vitest";

import {
  agentPresentationBounds,
  interpolateAgentLayer,
  renderAgentLayer,
} from "../src/render/agentLayer.js";
import { TILE_SIZE } from "../src/render/mapLayer.js";
import {
  easeFactor,
  RESIDENT_MOTION_HALF_LIFE_MS,
  SNAP_DISTANCE_TILES,
} from "../src/render/motion.js";
import { agentDepth } from "../src/render/sprites.js";
import { INFO_BUBBLE_LABEL, positionInfoBubble } from "../src/ui/infoBubble.js";

const NO_INTERACTIONS = {
  selectedAgentId: null,
  hoveredAgentId: null,
};

function makeAgent(id: string, x: number, y: number): AgentState {
  return {
    id,
    name: id,
    pos: { x, y },
    carrying: null,
    activity: { kind: "idle" },
    tasks: [],
    planSource: "fake",
    llmProvider: null,
    thinking: false,
    lastThought: null,
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
    rationStrain: 0,
    lastRationTick: null,
  };
}

function render(layer: Container, agents: AgentState[]): void {
  renderAgentLayer(layer, agents, new Map(), NO_INTERACTIONS);
}

describe("easeFactor", () => {
  it("closes more distance for a longer frame without exceeding the target", () => {
    const shortFrame = easeFactor(8, RESIDENT_MOTION_HALF_LIFE_MS);
    const longFrame = easeFactor(32, RESIDENT_MOTION_HALF_LIFE_MS);

    expect(shortFrame).toBeGreaterThan(0);
    expect(longFrame).toBeGreaterThan(shortFrame);
    expect(longFrame).toBeLessThanOrEqual(1);
    expect(easeFactor(Number.POSITIVE_INFINITY, RESIDENT_MOTION_HALF_LIFE_MS)).toBe(1);
  });

  it("lands at the same position after one full frame or two half frames", () => {
    const fullFrameFactor = easeFactor(32, RESIDENT_MOTION_HALF_LIFE_MS);
    const halfFrameFactor = easeFactor(16, RESIDENT_MOTION_HALF_LIFE_MS);
    const fullFramePosition = fullFrameFactor;
    const twoHalfFramesPosition = halfFrameFactor + (1 - halfFrameFactor) * halfFrameFactor;

    expect(twoHalfFramesPosition).toBeCloseTo(fullFramePosition, 12);
  });
});

describe("resident interpolation", () => {
  it("reuses the container keyed by resident id across server updates", () => {
    const layer = new Container();
    render(layer, [makeAgent("resident-1", 1, 1)]);
    const original = layer.children[0];

    render(layer, [makeAgent("resident-1", 2, 1)]);

    expect(layer.children).toHaveLength(1);
    expect(layer.children[0]).toBe(original);
  });

  it("keeps depth on the authoritative tile row while presentation position eases", () => {
    const layer = new Container();
    render(layer, [makeAgent("resident-1", 1, 1)]);
    const resident = layer.children[0];

    render(layer, [makeAgent("resident-1", 1, 2)]);
    interpolateAgentLayer(layer, 1);

    expect(resident?.position.y).toBeGreaterThan(1 * TILE_SIZE + TILE_SIZE / 2);
    expect(resident?.position.y).toBeLessThan(2 * TILE_SIZE + TILE_SIZE / 2);
    expect(resident?.zIndex).toBe(agentDepth(2, 0));
  });

  it("pins an open info bubble to the eased resident container", () => {
    const agentLayer = new Container();
    const bubbleLayer = new Container();
    const viewport = { width: 320, height: 240 };
    render(agentLayer, [makeAgent("resident-1", 6, 4)]);
    const resident = agentLayer.children[0];
    if (resident === undefined) throw new Error("missing resident container");
    const bubble = new Container();
    bubble.label = INFO_BUBBLE_LABEL;
    bubble.hitArea = new Rectangle(-40, -32, 80, 28);
    bubble.position.set(resident.position.x, resident.position.y - TILE_SIZE / 2);
    bubbleLayer.addChild(bubble);

    render(agentLayer, [makeAgent("resident-1", 7, 5)]);
    interpolateAgentLayer(agentLayer, 16);
    const anchor = agentPresentationBounds(agentLayer, "resident-1");
    if (anchor === null) throw new Error("missing resident presentation bounds");
    positionInfoBubble(bubbleLayer, anchor, viewport);

    expect(resident.position.x).toBeGreaterThan(6 * TILE_SIZE + TILE_SIZE / 2);
    expect(resident.position.x).toBeLessThan(7 * TILE_SIZE + TILE_SIZE / 2);
    expect(resident.position.y).toBeGreaterThan(4 * TILE_SIZE + TILE_SIZE / 2);
    expect(resident.position.y).toBeLessThan(5 * TILE_SIZE + TILE_SIZE / 2);
    expect(bubbleLayer.children[0]).toBe(bubble);
    expect(bubble?.position.x).toBe(resident.position.x);
    expect(bubble?.position.y).toBe(resident.position.y - TILE_SIZE / 2);
  });

  it("snaps a move beyond the walking threshold", () => {
    const layer = new Container();
    render(layer, [makeAgent("resident-1", 1, 1)]);
    const resident = layer.children[0];
    const destinationX = 1 + SNAP_DISTANCE_TILES + 1;

    render(layer, [makeAgent("resident-1", destinationX, 1)]);
    interpolateAgentLayer(layer, 1);

    expect(resident?.position.x).toBe(destinationX * TILE_SIZE + TILE_SIZE / 2);
  });

  it("changes presentation without writing to the authoritative agent state", () => {
    const layer = new Container();
    const first = makeAgent("resident-1", 1, 1);
    const next = makeAgent("resident-1", 2, 1);
    const before = structuredClone(next);
    render(layer, [first]);

    render(layer, [next]);
    interpolateAgentLayer(layer, 16);

    expect(next).toEqual(before);
  });

  it("destroys only the container whose resident is gone", () => {
    const layer = new Container();
    render(layer, [makeAgent("resident-1", 1, 1), makeAgent("resident-2", 2, 1)]);
    const removed = layer.children[0];
    const survivor = layer.children[1];

    render(layer, [makeAgent("resident-2", 2, 1)]);

    expect(removed?.destroyed).toBe(true);
    expect(layer.children).toEqual([survivor]);
    expect(survivor?.destroyed).toBe(false);
  });
});
