import {
  DAYS_PER_SEASON,
  FOOD_PER_MEAL,
  HUNGER_DECAY_PER_DAY,
  HUNGER_PER_MEAL,
  SEASONS,
  TICKS_PER_DAY,
} from "./constants.js";
import type { Facility } from "./spatial.js";
import { isFacility, type WorldState } from "./world.js";

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

function facilityFoodTotal(world: WorldState, include: (facility: Facility) => boolean): number {
  return world.buildings
    .filter(isFacility)
    .filter(include)
    .reduce((total, facility) => total + facility.inventory.food, world.stockpile.food);
}

/** Every grain the settlement holds, so a transfer can never mint or lose food. */
export function storedFoodTotal(world: WorldState): number {
  return facilityFoodTotal(world, () => true);
}

/** Food a resident could eat today; a building plot or a shut facility keeps its own. */
export function accessibleFoodTotal(world: WorldState): number {
  return facilityFoodTotal(world, ({ complete, operation }) => complete && operation === "active");
}

/** What the settlement eats in a day, which is what turns a store into days. */
export function dailyFoodNeed(world: WorldState): number {
  const population = Math.max(world.agents.length, 1);
  return population * FOOD_PER_MEAL * (HUNGER_DECAY_PER_DAY / HUNGER_PER_MEAL);
}

export function foodDaysRemaining(worldState: WorldState): number {
  return accessibleFoodTotal(worldState) / dailyFoodNeed(worldState);
}
