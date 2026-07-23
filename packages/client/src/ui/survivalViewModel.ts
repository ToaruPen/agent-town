import {
  type AgentState,
  DAYS_PER_SEASON,
  dayOfTick,
  FATIGUE_MAX,
  foodDaysRemaining,
  HEALTH_MAX,
  HUNGER_MAX,
  type Position,
  seasonOfTick,
  TICKS_PER_DAY,
  WOOD_BURN_PER_AGENT_PER_DAY,
  type WorldState,
} from "@agent-town/shared";

export type WoodForecast = "winter-ok" | "short";

export interface SurvivalHudViewModel {
  day: number;
  season: ReturnType<typeof seasonOfTick>;
  seasonLabel: string;
  population: number;
  foodStored: number;
  foodDays: string;
  woodStored: number;
  woodForecast: WoodForecast;
  woodForecastLabel: string;
}

export interface NeedViewModel {
  kind: "hunger" | "fatigue" | "health";
  label: string;
  value: number;
  max: number;
  valueLabel: string;
}

export interface DeathEvent {
  id: string;
  name: string;
  pos: Position | null;
  cause: WorldState["deaths"][number]["cause"];
  deathTick: number;
  expiresAtTick: number;
  text: string;
}

export interface DeathEventSchedule {
  observedDeaths: number;
  events: DeathEvent[];
}

function formatFiniteDecimal(value: number): string {
  return Number.isFinite(value) ? Math.max(value, 0).toFixed(1) : "—";
}

function futureWinterBurnDays(tick: number): number {
  if (seasonOfTick(tick) !== "winter") return DAYS_PER_SEASON;
  const dayIndexInSeason = (dayOfTick(tick) - 1) % DAYS_PER_SEASON;
  return DAYS_PER_SEASON - dayIndexInSeason - 1;
}

function winterWoodNeed(world: WorldState): number {
  return world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY * futureWinterBurnDays(world.tick);
}

const SEASON_LABELS: Record<ReturnType<typeof seasonOfTick>, string> = {
  autumn: "秋",
  spring: "春",
  summer: "夏",
  winter: "冬",
};

export function buildSurvivalHudViewModel(world: WorldState): SurvivalHudViewModel {
  const season = seasonOfTick(world.tick);
  const woodForecast = world.stockpile.wood >= winterWoodNeed(world) ? "winter-ok" : "short";
  return {
    day: dayOfTick(world.tick),
    season,
    seasonLabel: SEASON_LABELS[season],
    population: world.agents.length,
    foodStored: world.stockpile.food,
    foodDays: formatFiniteDecimal(foodDaysRemaining(world)),
    woodStored: world.stockpile.wood,
    woodForecast,
    woodForecastLabel: woodForecast === "winter-ok" ? "越冬分あり" : "不足",
  };
}

function clampGauge(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), max);
}

function need(
  kind: NeedViewModel["kind"],
  label: string,
  rawValue: number,
  max: number,
): NeedViewModel {
  const value = clampGauge(rawValue, max);
  return { kind, label, value, max, valueLabel: Math.round(value).toString() };
}

export function buildNeedsViewModel(agent: AgentState): NeedViewModel[] {
  return [
    need("hunger", "空腹", agent.hunger, HUNGER_MAX),
    need("fatigue", "疲労", agent.fatigue, FATIGUE_MAX),
    need("health", "健康", agent.health, HEALTH_MAX),
  ];
}

export function deathCauseLabel(cause: WorldState["deaths"][number]["cause"]): string {
  return cause === "starvation" ? "餓死" : "凍死";
}

function deathText(death: WorldState["deaths"][number]): string {
  return `${death.name}が${deathCauseLabel(death.cause)} — ${dayOfTick(death.tick)}日目`;
}

function eventFromDeath(
  death: WorldState["deaths"][number],
  index: number,
  previous: WorldState,
): DeathEvent {
  const agent = previous.agents.find(({ name }) => name === death.name);
  return {
    id: `${index}:${death.tick}:${death.name}`,
    name: death.name,
    pos: agent?.pos ?? null,
    cause: death.cause,
    deathTick: death.tick,
    expiresAtTick: death.tick + TICKS_PER_DAY,
    text: deathText(death),
  };
}

export function createDeathEventSchedule(state: WorldState): DeathEventSchedule {
  return { observedDeaths: state.deaths.length, events: [] };
}

export function updateDeathEventSchedule(
  schedule: DeathEventSchedule,
  previous: WorldState,
  next: WorldState,
): DeathEventSchedule {
  const newEvents = next.deaths
    .slice(schedule.observedDeaths)
    .map((death, offset) => eventFromDeath(death, schedule.observedDeaths + offset, previous));
  const events = [...schedule.events, ...newEvents].filter(
    ({ expiresAtTick }) => expiresAtTick > next.tick,
  );
  return { observedDeaths: next.deaths.length, events };
}

export function latestDeathEvent(schedule: DeathEventSchedule): DeathEvent | null {
  return schedule.events.at(-1) ?? null;
}
