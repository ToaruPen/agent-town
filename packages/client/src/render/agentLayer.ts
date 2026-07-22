import type { AgentState } from "@agent-town/shared";
import { Container, Graphics, Rectangle, Sprite, Text } from "pixi.js";

import type { ThoughtBubble } from "../ui/inspectPanel.js";
import { AGENT_LABEL_COLOR, CARRY_INDICATOR_COLOR } from "./colors.js";
import { TILE_SIZE } from "./mapLayer.js";
import { agentDepth, agentFacingScale, agentSpritePath, layoutAgentsOnTiles } from "./sprites.js";

const AGENT_HALF_SIZE = TILE_SIZE / 2;
const LLM_RING_GAP = 2;
const LLM_RING_WIDTH = 2;
const LLM_RING_COLOR = 0xffd700;
const LABEL_FONT_SIZE = 7;
const THINKING_INDICATOR_OFFSET = LABEL_FONT_SIZE + 2;
const CARRY_INDICATOR_SIZE = 4;
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

export interface AgentLayerInteractions {
  selectedAgentId: string | null;
  hoveredAgentId: string | null;
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

function createAgentContainer(agent: AgentState, offset: { x: number; y: number }): Container {
  const container = new Container();
  container.position.set(
    agent.pos.x * TILE_SIZE + TILE_SIZE / 2 + offset.x,
    agent.pos.y * TILE_SIZE + TILE_SIZE / 2 + offset.y,
  );
  container.label = AGENT_OBJECT_LABEL;
  container.zIndex = agentDepth(agent.pos.y, offset.y);
  container.eventMode = "static";
  container.hitArea = new Rectangle(-AGENT_HALF_SIZE, -AGENT_HALF_SIZE, TILE_SIZE, TILE_SIZE);
  container.cursor = "pointer";
  return container;
}

function drawAgent(
  layer: Container,
  agent: AgentState,
  index: number,
  offset: { x: number; y: number },
  bubble: ThoughtBubble | undefined,
  interactions: AgentLayerInteractions,
): void {
  const container = createAgentContainer(agent, offset);
  layer.addChild(container);

  if (agent.planSource === "llm") {
    const ring = new Graphics()
      .circle(0, 0, AGENT_HALF_SIZE + LLM_RING_GAP)
      .stroke({ color: LLM_RING_COLOR, width: LLM_RING_WIDTH });
    container.addChild(ring);
  }

  const sprite = Sprite.from(agentSpritePath(index));
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
    const indicator = new Graphics()
      .rect(
        AGENT_HALF_SIZE - CARRY_INDICATOR_SIZE,
        AGENT_HALF_SIZE - CARRY_INDICATOR_SIZE,
        CARRY_INDICATOR_SIZE,
        CARRY_INDICATOR_SIZE,
      )
      .fill(CARRY_INDICATOR_COLOR);
    container.addChild(indicator);
  }

  if (bubble !== undefined) {
    const speechBubble = createSpeechBubble(bubble);
    speechBubble.position.set(0, bubbleOffset(agent));
    container.addChild(speechBubble);
  }
}

export function renderAgentLayer(
  layer: Container,
  agents: AgentState[],
  bubbles: ReadonlyMap<string, ThoughtBubble>,
  interactions: AgentLayerInteractions,
): void {
  for (const child of [...layer.children]) {
    if (child.label !== AGENT_OBJECT_LABEL) continue;
    layer.removeChild(child);
    child.destroy({ children: true });
  }
  layoutAgentsOnTiles(agents).forEach(({ agent, offset }, index) => {
    drawAgent(layer, agent, index, offset, bubbles.get(agent.id), interactions);
  });
}
