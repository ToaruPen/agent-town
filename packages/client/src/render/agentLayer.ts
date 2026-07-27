import type { AgentState } from "@agent-town/shared";
import { Container, Graphics, Rectangle, Sprite, Text } from "pixi.js";

import type { ThoughtBubble } from "../ui/inspectPanel.js";
import { AGENT_LABEL_COLOR } from "./colors.js";
import { TILE_SIZE } from "./mapLayer.js";
import { easeFactor, RESIDENT_MOTION_HALF_LIFE_MS, SNAP_DISTANCE_TILES } from "./motion.js";
import { shadowGraphic } from "./shadow.js";
import {
  agentDepth,
  agentFacingScale,
  agentSpritePath,
  layoutAgentsOnTiles,
  SPRITE_ASSETS,
} from "./sprites.js";

const AGENT_HALF_SIZE = TILE_SIZE / 2;
const AGENT_SHADOW_WIDTH_RATIO = 0.55;
const LLM_RING_GAP = 2;
const LLM_RING_WIDTH = 2;
const LLM_RING_COLOR = 0xffd700;
const LABEL_FONT_SIZE = 7;
const THINKING_INDICATOR_OFFSET = LABEL_FONT_SIZE + 2;
const CARRY_SPRITE_SIZE = TILE_SIZE / 2;
const BUBBLE_FONT_SIZE = 8;
const BUBBLE_LINE_HEIGHT = 10;
const BUBBLE_MAX_TEXT_WIDTH = 104;
const BUBBLE_PADDING = 4;
const BUBBLE_RADIUS = 3;
const BUBBLE_TAIL_SIZE = 3;
const BUBBLE_FILL_COLOR = 0xfff8dc;
const BUBBLE_STROKE_COLOR = 0x34302a;
const BUBBLE_TEXT_COLOR = 0x241f1a;
const AGENT_OBJECT_LABEL = "agent-object";

interface AgentRenderState {
  container: Container;
  targetX: number;
  targetY: number;
}

export interface AgentLayerInteractions {
  selectedAgentId: string | null;
  hoveredAgentId: string | null;
}

const agentRendersByLayer = new WeakMap<Container, Map<string, AgentRenderState>>();

function agentRenders(layer: Container): Map<string, AgentRenderState> {
  const existing = agentRendersByLayer.get(layer);
  if (existing !== undefined) return existing;
  const created = new Map<string, AgentRenderState>();
  agentRendersByLayer.set(layer, created);
  return created;
}

function createSpeechBubble(bubble: ThoughtBubble): Container {
  const text = new Text({
    text: bubble.text,
    style: {
      fontFamily: "sans-serif",
      fontSize: BUBBLE_FONT_SIZE,
      lineHeight: BUBBLE_LINE_HEIGHT,
      fill: BUBBLE_TEXT_COLOR,
      align: "center",
      wordWrap: true,
      wordWrapWidth: BUBBLE_MAX_TEXT_WIDTH,
    },
  });
  text.anchor.set(0.5, 1);
  text.position.set(0, -BUBBLE_TAIL_SIZE - BUBBLE_PADDING);

  const width = text.width + BUBBLE_PADDING * 2;
  const height = text.height + BUBBLE_PADDING * 2;
  const background = new Graphics()
    .roundRect(-width / 2, -height - BUBBLE_TAIL_SIZE, width, height, BUBBLE_RADIUS)
    .fill(BUBBLE_FILL_COLOR)
    .stroke({ color: BUBBLE_STROKE_COLOR, width: 1 })
    .poly([-BUBBLE_TAIL_SIZE, -BUBBLE_TAIL_SIZE, 0, 0, BUBBLE_TAIL_SIZE, -BUBBLE_TAIL_SIZE])
    .fill(BUBBLE_FILL_COLOR);

  const container = new Container();
  container.eventMode = "none";
  container.addChild(background, text);
  return container;
}

function bubbleOffset(agent: AgentState): number {
  const indicatorHeight = agent.thinking
    ? THINKING_INDICATOR_OFFSET + LABEL_FONT_SIZE
    : LABEL_FONT_SIZE;
  return -AGENT_HALF_SIZE - indicatorHeight - 2;
}

function createAgentContainer(): Container {
  const container = new Container();
  container.label = AGENT_OBJECT_LABEL;
  container.eventMode = "static";
  container.hitArea = new Rectangle(-AGENT_HALF_SIZE, -AGENT_HALF_SIZE, TILE_SIZE, TILE_SIZE);
  container.cursor = "pointer";
  return container;
}

function clearAgentVisuals(container: Container): void {
  for (const child of container.removeChildren()) child.destroy({ children: true });
}

function drawAgent(
  container: Container,
  agent: AgentState,
  bubble: ThoughtBubble | undefined,
  interactions: AgentLayerInteractions,
): void {
  const shadow = shadowGraphic(AGENT_SHADOW_WIDTH_RATIO);
  shadow.position.set(0, AGENT_HALF_SIZE - 2);
  container.addChild(shadow);

  if (agent.planSource === "llm") {
    const ring = new Graphics()
      .circle(0, 0, AGENT_HALF_SIZE + LLM_RING_GAP)
      .stroke({ color: LLM_RING_COLOR, width: LLM_RING_WIDTH });
    container.addChild(ring);
  }

  const sprite = Sprite.from(agentSpritePath(agent.id));
  sprite.anchor.set(0.5);
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.scale.x *= agentFacingScale(agent);
  container.addChild(sprite);

  const label = new Text({
    text: agent.name,
    style: { fontFamily: "sans-serif", fontSize: LABEL_FONT_SIZE, fill: AGENT_LABEL_COLOR },
  });
  label.anchor.set(0.5, 1);
  label.position.set(0, -AGENT_HALF_SIZE - 1);
  label.visible =
    interactions.selectedAgentId === agent.id || interactions.hoveredAgentId === agent.id;
  container.addChild(label);

  if (agent.thinking) {
    const thinking = new Text({
      text: "…",
      style: { fontFamily: "sans-serif", fontSize: LABEL_FONT_SIZE, fill: AGENT_LABEL_COLOR },
    });
    thinking.anchor.set(0.5, 1);
    thinking.position.set(0, -AGENT_HALF_SIZE - THINKING_INDICATOR_OFFSET);
    container.addChild(thinking);
  }

  if (agent.carrying !== null) {
    const carrySprite = Sprite.from(SPRITE_ASSETS.carry[agent.carrying.kind]);
    carrySprite.position.set(
      AGENT_HALF_SIZE - CARRY_SPRITE_SIZE / 2,
      AGENT_HALF_SIZE - CARRY_SPRITE_SIZE / 2,
    );
    carrySprite.width = CARRY_SPRITE_SIZE;
    carrySprite.height = CARRY_SPRITE_SIZE;
    container.addChild(carrySprite);
  }

  if (bubble !== undefined) {
    const speechBubble = createSpeechBubble(bubble);
    speechBubble.position.set(0, bubbleOffset(agent));
    container.addChild(speechBubble);
  }
}

function authoritativePosition(
  agent: AgentState,
  offset: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: agent.pos.x * TILE_SIZE + TILE_SIZE / 2 + offset.x,
    y: agent.pos.y * TILE_SIZE + TILE_SIZE / 2 + offset.y,
  };
}

function setAgentTarget(
  renderState: AgentRenderState,
  agent: AgentState,
  offset: { x: number; y: number },
): void {
  const target = authoritativePosition(agent, offset);
  const distanceTiles =
    Math.hypot(
      target.x - renderState.container.position.x,
      target.y - renderState.container.position.y,
    ) / TILE_SIZE;
  renderState.targetX = target.x;
  renderState.targetY = target.y;
  if (distanceTiles > SNAP_DISTANCE_TILES) renderState.container.position.set(target.x, target.y);
  // Presentation easing must never change authoritative row ordering.
  renderState.container.zIndex = agentDepth(agent.pos.y, offset.y);
}

function createAgentRender(
  layer: Container,
  agent: AgentState,
  offset: { x: number; y: number },
): AgentRenderState {
  const container = createAgentContainer();
  const target = authoritativePosition(agent, offset);
  container.position.set(target.x, target.y);
  layer.addChild(container);
  return { container, targetX: target.x, targetY: target.y };
}

function removeDepartedAgents(
  layer: Container,
  renders: Map<string, AgentRenderState>,
  activeIds: ReadonlySet<string>,
): void {
  for (const [agentId, renderState] of renders) {
    if (activeIds.has(agentId)) continue;
    layer.removeChild(renderState.container);
    renderState.container.destroy({ children: true });
    renders.delete(agentId);
  }
}

export function renderAgentLayer(
  layer: Container,
  agents: AgentState[],
  bubbles: ReadonlyMap<string, ThoughtBubble>,
  interactions: AgentLayerInteractions,
): void {
  const renders = agentRenders(layer);
  removeDepartedAgents(layer, renders, new Set(agents.map(({ id }) => id)));
  layoutAgentsOnTiles(agents).forEach(({ agent, offset }) => {
    const existing = renders.get(agent.id);
    const renderState = existing ?? createAgentRender(layer, agent, offset);
    if (existing === undefined) renders.set(agent.id, renderState);
    setAgentTarget(renderState, agent, offset);
    clearAgentVisuals(renderState.container);
    drawAgent(renderState.container, agent, bubbles.get(agent.id), interactions);
  });
}

export function interpolateAgentLayer(layer: Container, deltaMs: number): void {
  const factor = easeFactor(deltaMs, RESIDENT_MOTION_HALF_LIFE_MS);
  const renders = agentRendersByLayer.get(layer);
  if (renders === undefined) return;
  for (const { container, targetX, targetY } of renders.values()) {
    container.position.set(
      container.position.x + (targetX - container.position.x) * factor,
      container.position.y + (targetY - container.position.y) * factor,
    );
  }
}
