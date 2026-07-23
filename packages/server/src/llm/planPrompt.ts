import {
  type AgentState,
  DAYS_PER_SEASON,
  dayOfTick,
  foodDaysRemaining,
  HOUSE_CAPACITY,
  HOUSE_WOOD_COST,
  MAX_PLAN_TASKS,
  type ResourceKind,
  SEASONS,
  STOCKPILE_TARGET_FOOD,
  STOCKPILE_TARGET_WOOD,
  seasonOfTick,
  TICKS_PER_DAY,
  WOOD_BURN_PER_AGENT_PER_DAY,
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

function daysUntilWinter(tick: number): number {
  if (seasonOfTick(tick) === "winter") return 0;
  const ticksPerYear = DAYS_PER_SEASON * SEASONS.length * TICKS_PER_DAY;
  const winterStartTick = DAYS_PER_SEASON * (SEASONS.length - 1) * TICKS_PER_DAY;
  const tickInYear = tick % ticksPerYear;
  return Math.ceil((winterStartTick - tickInYear) / TICKS_PER_DAY);
}

function completedHousingCapacity(world: WorldState): number {
  return world.buildings.filter(({ complete }) => complete).length * HOUSE_CAPACITY;
}

function futureWinterBurnDays(tick: number): number {
  if (seasonOfTick(tick) !== "winter") return DAYS_PER_SEASON;
  const dayIndexInSeason = (dayOfTick(tick) - 1) % DAYS_PER_SEASON;
  return DAYS_PER_SEASON - dayIndexInSeason - 1;
}

function burnDayLabel(days: number): string {
  return `${days} future burn ${days === 1 ? "day" : "days"}`;
}

export function buildPlanPrompt(world: WorldState, agent: AgentState): string {
  const persona = `${agent.name}, a diligent forester who worries about winter; you must survive the winter`;
  const winterBurnDays = futureWinterBurnDays(world.tick);
  const winterWoodNeed = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY * winterBurnDays;
  const taskSchema =
    '[{"kind":"moveTo","dest":{"x":0,"y":0}} | ' +
    '{"kind":"gather","resource":"wood"|"food","target":{"x":0,"y":0}} | ' +
    '{"kind":"eat"} | ' +
    '{"kind":"forage","target":{"x":0,"y":0}} | ' +
    '{"kind":"build","pos":{"x":0,"y":0}} | ' +
    '{"kind":"rest"} | ' +
    '{"kind":"deposit"}]';

  return [
    `Agent: ${persona}`,
    `calendar: day ${dayOfTick(world.tick)}, season ${seasonOfTick(world.tick)}, ${daysUntilWinter(world.tick)} days until winter`,
    `position: (${agent.pos.x},${agent.pos.y})`,
    `carrying: ${formatCarrying(agent)}`,
    `needs: hunger=${agent.hunger}, fatigue=${agent.fatigue}, health=${agent.health}`,
    `population: ${world.agents.length} / completed-house capacity ${completedHousingCapacity(world)}`,
    `stockpile position: (${world.stockpile.pos.x},${world.stockpile.pos.y})`,
    `wood: ${world.stockpile.wood} / target ${STOCKPILE_TARGET_WOOD}`,
    `food: ${world.stockpile.food} / target ${STOCKPILE_TARGET_FOOD}`,
    `wood: ${world.stockpile.wood} stored / ${winterWoodNeed} needed for remaining winter (${burnDayLabel(winterBurnDays)})`,
    `food: ${world.stockpile.food} stored, ${foodDaysRemaining(world).toFixed(2)} days remaining`,
    formatResourceTiles(world, agent, "wood"),
    formatResourceTiles(world, agent, "food"),
    "Action guidance:",
    `- eat: when hunger is low and the stockpile has enough food; it navigates to the stockpile and consumes a meal.`,
    `- forage: when hungry and stored food cannot provide a meal; target a live food tile and eat there.`,
    `- build: choose the house site only; this action navigates adjacent and builds. It costs ${HOUSE_WOOD_COST} wood for a new house; never add moveTo onto a build site.`,
    `- rest: when fatigue is low; it navigates to a completed house or the stockpile.`,
    "- moveTo steps before positional actions are optional; the town inserts needed movement automatically.",
    `- deposit: use an explicit moveTo to the stockpile first, then deposit while beside it.`,
    "Reply with ONLY a JSON object and no prose or code fences:",
    "Write the reasoning field in natural Japanese because it is shown to the player.",
    `{"reasoning": "<one short sentence in natural Japanese>", "plan": ${taskSchema}}`,
    `The plan must contain 1..${MAX_PLAN_TASKS} tasks; this limit applies to the tasks you author, before the town inserts movement.`,
  ].join("\n");
}
