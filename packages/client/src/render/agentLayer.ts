import type { AgentState } from "@agent-town/shared";
import { type Container, Graphics, Sprite, Text } from "pixi.js";

import { AGENT_LABEL_COLOR, CARRY_INDICATOR_COLOR } from "./colors.js";
import { TILE_SIZE } from "./mapLayer.js";
import { agentFacingScale, agentSpritePath } from "./sprites.js";

const AGENT_HALF_SIZE = TILE_SIZE / 2;
const LLM_RING_GAP = 2;
const LLM_RING_WIDTH = 2;
const LLM_RING_COLOR = 0xffd700;
const LABEL_FONT_SIZE = 9;
const THINKING_INDICATOR_OFFSET = LABEL_FONT_SIZE + 2;
const CARRY_INDICATOR_SIZE = 4;

function drawAgent(layer: Container, agent: AgentState, index: number): void {
  const centerX = agent.pos.x * TILE_SIZE + TILE_SIZE / 2;
  const centerY = agent.pos.y * TILE_SIZE + TILE_SIZE / 2;

  if (agent.planSource === "llm") {
    const ring = new Graphics()
      .circle(centerX, centerY, AGENT_HALF_SIZE + LLM_RING_GAP)
      .stroke({ color: LLM_RING_COLOR, width: LLM_RING_WIDTH });
    layer.addChild(ring);
  }

  const sprite = Sprite.from(agentSpritePath(index));
  sprite.anchor.set(0.5);
  sprite.position.set(centerX, centerY);
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.scale.x *= agentFacingScale(agent);
  layer.addChild(sprite);

  const label = new Text({
    text: agent.name,
    style: { fontFamily: "sans-serif", fontSize: LABEL_FONT_SIZE, fill: AGENT_LABEL_COLOR },
  });
  label.anchor.set(0.5, 1);
  label.position.set(centerX, centerY - AGENT_HALF_SIZE - 1);
  layer.addChild(label);

  if (agent.thinking) {
    const thinking = new Text({
      text: "…",
      style: { fontFamily: "sans-serif", fontSize: LABEL_FONT_SIZE, fill: AGENT_LABEL_COLOR },
    });
    thinking.anchor.set(0.5, 1);
    thinking.position.set(centerX, centerY - AGENT_HALF_SIZE - THINKING_INDICATOR_OFFSET);
    layer.addChild(thinking);
  }

  if (agent.carrying === null) return;
  const indicator = new Graphics()
    .rect(
      centerX + AGENT_HALF_SIZE - CARRY_INDICATOR_SIZE,
      centerY + AGENT_HALF_SIZE - CARRY_INDICATOR_SIZE,
      CARRY_INDICATOR_SIZE,
      CARRY_INDICATOR_SIZE,
    )
    .fill(CARRY_INDICATOR_COLOR);
  layer.addChild(indicator);
}

export function renderAgentLayer(layer: Container, agents: AgentState[]): void {
  for (const child of layer.removeChildren()) child.destroy();
  agents.forEach((agent, index) => {
    drawAgent(layer, agent, index);
  });
}
