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
  population: number;
  foodStored: number;
  foodDays: string;
  woodStored: number;
  woodForecast: WoodForecast;
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

export function buildSurvivalHudViewModel(world: WorldState): SurvivalHudViewModel {
  return {
    day: dayOfTick(world.tick),
    season: seasonOfTick(world.tick),
    population: world.agents.length,
    foodStored: world.stockpile.food,
    foodDays: formatFiniteDecimal(foodDaysRemaining(world)),
    woodStored: world.stockpile.wood,
    woodForecast: world.stockpile.wood >= winterWoodNeed(world) ? "winter-ok" : "short",
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
    need("hunger", "Hunger", agent.hunger, HUNGER_MAX),
    need("fatigue", "Fatigue", agent.fatigue, FATIGUE_MAX),
    need("health", "Health", agent.health, HEALTH_MAX),
  ];
}

function deathText(death: WorldState["deaths"][number]): string {
  const event = death.cause === "starvation" ? "starved" : "died from cold";
  return `${death.name} ${event}, day ${dayOfTick(death.tick)}`;
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
