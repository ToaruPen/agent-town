import {
  type AgentState,
  MAX_PLAN_TASKS,
  type ResourceKind,
  STOCKPILE_TARGET_FOOD,
  STOCKPILE_TARGET_WOOD,
  type WorldState,
} from "@agent-town/shared";

const NEAREST_RESOURCE_TILE_COUNT = 5;

interface ResourceTileSummary {
  index: number;
  distance: number;
  x: number;
  y: number;
  amount: number;
}

function nearestResourceTiles(
  world: WorldState,
  agent: AgentState,
  kind: ResourceKind,
): ResourceTileSummary[] {
  const matches: ResourceTileSummary[] = [];

  for (const [index, tile] of world.tiles.entries()) {
    if (tile.resource?.kind !== kind || tile.resource.amount <= 0) continue;
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    matches.push({
      index,
      distance: Math.abs(agent.pos.x - x) + Math.abs(agent.pos.y - y),
      x,
      y,
      amount: tile.resource.amount,
    });
  }

  return matches
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .slice(0, NEAREST_RESOURCE_TILE_COUNT);
}

function formatResourceTiles(world: WorldState, agent: AgentState, kind: ResourceKind): string {
  const lines = nearestResourceTiles(world, agent, kind).map(
    ({ x, y, amount }) => `- (${x},${y}) amount=${amount}`,
  );
  return [`nearest ${kind} tiles:`, ...lines].join("\n");
}

function formatCarrying(agent: AgentState): string {
  return agent.carrying === null ? "nothing" : `${agent.carrying.kind} ${agent.carrying.amount}`;
}

export function buildPlanPrompt(world: WorldState, agent: AgentState): string {
  const persona = `${agent.name}, a diligent forester who worries about winter`;
  const taskSchema =
    '[{"kind":"moveTo","dest":{"x":0,"y":0}} | ' +
    '{"kind":"gather","resource":"wood"|"food","target":{"x":0,"y":0}} | ' +
    '{"kind":"deposit"}]';

  return [
    `Agent: ${persona}`,
    `position: (${agent.pos.x},${agent.pos.y})`,
    `carrying: ${formatCarrying(agent)}`,
    `stockpile position: (${world.stockpile.pos.x},${world.stockpile.pos.y})`,
    `wood: ${world.stockpile.wood} / target ${STOCKPILE_TARGET_WOOD}`,
    `food: ${world.stockpile.food} / target ${STOCKPILE_TARGET_FOOD}`,
    formatResourceTiles(world, agent, "wood"),
    formatResourceTiles(world, agent, "food"),
    "Reply with ONLY a JSON object and no prose or code fences:",
    `{"reasoning": "<one short sentence>", "plan": ${taskSchema}}`,
    `The plan must contain 1..${MAX_PLAN_TASKS} tasks.`,
  ].join("\n");
}
