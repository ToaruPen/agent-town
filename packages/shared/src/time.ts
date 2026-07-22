import {
  DAYS_PER_SEASON,
  FOOD_PER_MEAL,
  HUNGER_DECAY_PER_DAY,
  HUNGER_PER_MEAL,
  SEASONS,
  TICKS_PER_DAY,
} from "./constants.js";
import type { WorldState } from "./world.js";

export function dayOfTick(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY) + 1;
}

export function seasonOfTick(tick: number): (typeof SEASONS)[number] {
  const seasonIndex = Math.floor((dayOfTick(tick) - 1) / DAYS_PER_SEASON) % SEASONS.length;
  const season = SEASONS[seasonIndex];
  if (season === undefined) throw new Error(`invalid season index: ${seasonIndex}`);
  return season;
}

export function isWinter(tick: number): boolean {
  return seasonOfTick(tick) === "winter";
}

export function foodDaysRemaining(worldState: WorldState): number {
  const population = Math.max(worldState.agents.length, 1);
  const dailyNeed = population * FOOD_PER_MEAL * (HUNGER_DECAY_PER_DAY / HUNGER_PER_MEAL);
  return worldState.stockpile.food / dailyNeed;
}
