import {
  type AgentState,
  accessibleFoodTotal,
  dailyFoodNeed,
  FACILITY_FOOD_CAPACITY,
  FACILITY_MAINTENANCE_PER_DAY,
  FACILITY_RESERVE_FOOD_DAYS,
  type Facility,
  type FacilityBlockedReason,
  FOOD_PER_MEAL,
  foodDaysRemaining,
  GRANARY_FOOD_SPOILAGE_RATE,
  HUNGER_MAX,
  HUNGER_PER_MEAL,
  isFacility,
  MARKET_EXPORT_ABOVE_FOOD_DAYS,
  MARKET_EXPORT_FOOD,
  MARKET_EXPORT_WOOD,
  MARKET_IMPORT_BELOW_FOOD_DAYS,
  MARKET_IMPORT_FOOD,
  MARKET_IMPORT_WOOD,
  MARKET_TRADE_INTERVAL_TICKS,
  type Position,
  RATION_BELOW_FOOD_DAYS,
  RATION_FOOD_PER_MEAL,
  RATION_HUNGER_PER_MEAL,
  RATION_STRAIN_PER_MEAL,
  RATION_STRAIN_RECOVERY_PER_DAY,
  STOCKPILE_FOOD_SPOILAGE_RATE,
  type WorldState,
} from "@agent-town/shared";

import { filterReachable } from "./astar.js";

export type FoodStore =
  | { kind: "stockpile"; pos: Position }
  | { kind: "facility"; facility: Facility };

/** Reasons a facility is shut to residents; `full` only refuses deposits. */
const INACCESSIBLE_REASONS = ["unreachable", "noTradeRoute", "maintenanceOverdue"] as const;

function facilities(world: WorldState): Facility[] {
  return world.buildings.filter(isFacility);
}

export function foodStorePos(store: FoodStore): Position {
  return store.kind === "stockpile" ? store.pos : store.facility.pos;
}

export function marketHasTradeAccess(world: WorldState): boolean {
  const homelandId = world.history.settlementOrigin?.homelandPolityId;
  if (homelandId === undefined) return false;

  const { cities, tradeRoutes } = world.history.worldMap;
  const homelandCityIds = new Set(
    cities.filter(({ polityId }) => polityId === homelandId).map(({ id }) => id),
  );
  return tradeRoutes.some(({ cityIds }) => cityIds.some((id) => homelandCityIds.has(id)));
}

function hasResidentAccess(world: WorldState, facility: Facility): boolean {
  const residentPositions = world.agents.map(({ pos }) => pos);
  return filterReachable(world, facility.pos, residentPositions).length > 0;
}

function isMaintained(facility: Facility): boolean {
  return facility.maintenanceDue <= FACILITY_MAINTENANCE_PER_DAY[facility.kind];
}

function isFull(facility: Facility): boolean {
  return facility.inventory.food >= FACILITY_FOOD_CAPACITY[facility.kind];
}

/** First reason that applies wins, so a shut door always names its strongest cause. */
function blockedReasonFor(world: WorldState, facility: Facility): FacilityBlockedReason | null {
  if (!hasResidentAccess(world, facility)) return "unreachable";
  if (facility.kind === "grainMarket" && !marketHasTradeAccess(world)) return "noTradeRoute";
  if (!isMaintained(facility)) return "maintenanceOverdue";
  return isFull(facility) ? "full" : null;
}

function isInaccessible(reason: FacilityBlockedReason | null): boolean {
  return INACCESSIBLE_REASONS.some((entry) => entry === reason);
}

export function refreshFacilityAvailability(world: WorldState): void {
  for (const facility of facilities(world)) {
    if (!facility.complete) continue;
    const reason = blockedReasonFor(world, facility);
    facility.blockedReason = reason;
    facility.operation = isInaccessible(reason) ? "blocked" : "active";
  }
}

function isServing(facility: Facility): boolean {
  return facility.complete && facility.operation === "active";
}

/**
 * Food days the settlement has before touching a reserve, so a full granary is
 * never the reason its own doors stay shut.
 */
function unreservedFoodDays(world: WorldState): number {
  const reserved = facilities(world)
    .filter((facility) => isServing(facility) && facility.kind === "communalGranary")
    .reduce((total, { inventory }) => total + inventory.food, 0);
  return (accessibleFoodTotal(world) - reserved) / dailyFoodNeed(world);
}

function isShortOfFood(world: WorldState): boolean {
  return foodDaysRemaining(world) < RATION_BELOW_FOOD_DAYS;
}

/** Rationing answers scarcity; the same depot serves a whole meal in a good year. */
function isRationing(world: WorldState, store: FoodStore): boolean {
  return store.kind === "facility" && store.facility.kind === "rationDepot" && isShortOfFood(world);
}

/** The depot feeds the neediest first: hungriest, then frailest, then longest since a ration. */
function compareRationNeed(left: AgentState, right: AgentState): number {
  return (
    left.hunger - right.hunger ||
    left.health - right.health ||
    (left.lastRationTick ?? -1) - (right.lastRationTick ?? -1) ||
    left.id.localeCompare(right.id)
  );
}

function servesRation(world: WorldState, depot: Facility, agent: AgentState): boolean {
  const meals = Math.floor(depot.inventory.food / RATION_FOOD_PER_MEAL);
  if (meals <= 0) return false;
  return world.agents
    .toSorted(compareRationNeed)
    .slice(0, meals)
    .some(({ id }) => id === agent.id);
}

/** Everyday stores come first and the reserve comes last, whatever the walk costs. */
function storeRank(world: WorldState, store: FoodStore): number {
  if (store.kind === "stockpile") return 1;
  if (store.facility.kind === "grainMarket") return 2;
  if (store.facility.kind === "communalGranary") return 4;
  return isShortOfFood(world) ? 0 : 3;
}

function isOfferable(world: WorldState, agent: AgentState, facility: Facility): boolean {
  if (!isServing(facility)) return false;
  if (facility.kind === "communalGranary") {
    return unreservedFoodDays(world) < FACILITY_RESERVE_FOOD_DAYS;
  }
  if (facility.kind !== "rationDepot" || !isShortOfFood(world)) return true;
  return servesRation(world, facility, agent);
}

export function mealFoodForStore(world: WorldState, store: FoodStore): number {
  return isRationing(world, store) ? RATION_FOOD_PER_MEAL : FOOD_PER_MEAL;
}

function storeFood(world: WorldState, store: FoodStore): number {
  return store.kind === "stockpile" ? world.stockpile.food : store.facility.inventory.food;
}

function candidateStores(world: WorldState, agent: AgentState): FoodStore[] {
  const stores: FoodStore[] = [{ kind: "stockpile", pos: world.stockpile.pos }];
  for (const facility of facilities(world)) {
    if (isOfferable(world, agent, facility)) stores.push({ kind: "facility", facility });
  }
  return stores.filter((store) => storeFood(world, store) >= mealFoodForStore(world, store));
}

function positionKey({ x, y }: Position): string {
  return `${x},${y}`;
}

/** One flood answers every counter at once, so a hungry resident costs a single search. */
function reachableStores(world: WorldState, agent: AgentState, stores: FoodStore[]): FoodStore[] {
  const counters = stores.map(foodStorePos);
  const reached = new Set(filterReachable(world, agent.pos, counters).map(positionKey));
  return stores.filter((store) => reached.has(positionKey(foodStorePos(store))));
}

export function selectFoodStore(world: WorldState, agent: AgentState): FoodStore | null {
  const reachable = reachableStores(world, agent, candidateStores(world, agent));
  const ranked = reachable.toSorted(
    (left, right) => storeRank(world, left) - storeRank(world, right),
  );
  return ranked[0] ?? null;
}

export function chooseFoodStore(world: WorldState, agent: AgentState): FoodStore | null {
  refreshFacilityAvailability(world);
  return selectFoodStore(world, agent);
}

function recordFacilityMeal(
  world: WorldState,
  agent: AgentState,
  facility: Facility,
  rationing: boolean,
): void {
  facility.statsToday.visits += 1;
  facility.lastUsedAtTick = world.tick;
  if (!rationing) return;
  facility.statsToday.rationMeals += 1;
  agent.rationStrain = Math.min(1, agent.rationStrain + RATION_STRAIN_PER_MEAL);
  agent.lastRationTick = world.tick;
}

export function applyMealFromStore(
  world: WorldState,
  agent: AgentState,
  store: FoodStore,
): boolean {
  const rationing = isRationing(world, store);
  const food = mealFoodForStore(world, store);
  if (storeFood(world, store) < food) return false;

  if (store.kind === "stockpile") world.stockpile.food -= food;
  else {
    store.facility.inventory.food -= food;
    recordFacilityMeal(world, agent, store.facility, rationing);
  }

  const hunger = rationing ? RATION_HUNGER_PER_MEAL : HUNGER_PER_MEAL;
  agent.hunger = Math.min(HUNGER_MAX, agent.hunger + hunger);
  return true;
}

function spoil(amount: number, rate: number): number {
  return Math.min(amount, Math.max(0, amount * rate));
}

function spoilageRate(facility: Facility): number {
  const sheltered = facility.kind === "communalGranary" && isMaintained(facility);
  return sheltered ? GRANARY_FOOD_SPOILAGE_RATE : STOCKPILE_FOOD_SPOILAGE_RATE;
}

function spoilFacilityFood(facility: Facility): void {
  const openAir = spoil(facility.inventory.food, STOCKPILE_FOOD_SPOILAGE_RATE);
  const lost = spoil(facility.inventory.food, spoilageRate(facility));
  facility.inventory.food -= lost;
  facility.statsToday.foodPreserved += openAir - lost;
}

function resetDailyStats(facility: Facility): void {
  facility.statsToday = {
    visits: 0,
    foodPreserved: 0,
    foodImported: 0,
    foodExported: 0,
    woodSpent: 0,
    woodReceived: 0,
    rationMeals: 0,
    maintenanceWork: 0,
  };
}

export function runFacilityDay(world: WorldState): void {
  for (const facility of facilities(world)) resetDailyStats(facility);
  world.stockpile.food -= spoil(world.stockpile.food, STOCKPILE_FOOD_SPOILAGE_RATE);

  for (const facility of facilities(world)) {
    if (!facility.complete) continue;
    spoilFacilityFood(facility);
    facility.maintenanceDue += FACILITY_MAINTENANCE_PER_DAY[facility.kind];
  }

  for (const agent of world.agents) {
    agent.rationStrain = Math.max(0, agent.rationStrain - RATION_STRAIN_RECOVERY_PER_DAY);
  }
  refreshFacilityAvailability(world);
}

function completeTrade(world: WorldState, market: Facility): void {
  market.lastTradeTick = world.tick;
  market.lastUsedAtTick = world.tick;
}

/** All or nothing, so an import never overfills the market it is meant to stock. */
function importFood(world: WorldState, market: Facility): void {
  if (market.inventory.wood < MARKET_IMPORT_WOOD) return;
  if (market.inventory.food + MARKET_IMPORT_FOOD > FACILITY_FOOD_CAPACITY.grainMarket) return;

  market.inventory.wood -= MARKET_IMPORT_WOOD;
  market.inventory.food += MARKET_IMPORT_FOOD;
  market.statsToday.woodSpent += MARKET_IMPORT_WOOD;
  market.statsToday.foodImported += MARKET_IMPORT_FOOD;
  completeTrade(world, market);
}

function exportFood(world: WorldState, market: Facility): void {
  const food = Math.min(MARKET_EXPORT_FOOD, market.inventory.food);
  if (food <= 0) return;

  market.inventory.food -= food;
  market.inventory.wood += MARKET_EXPORT_WOOD;
  market.statsToday.foodExported += food;
  market.statsToday.woodReceived += MARKET_EXPORT_WOOD;
  completeTrade(world, market);
}

function tradeAtMarket(world: WorldState, market: Facility): void {
  if (!isServing(market) || market.lastTradeTick === world.tick) return;

  const foodDays = foodDaysRemaining(world);
  if (foodDays < MARKET_IMPORT_BELOW_FOOD_DAYS) importFood(world, market);
  else if (foodDays > MARKET_EXPORT_ABOVE_FOOD_DAYS) exportFood(world, market);
}

export function runFacilityInterval(world: WorldState): void {
  if (world.tick <= 0 || world.tick % MARKET_TRADE_INTERVAL_TICKS !== 0) return;

  refreshFacilityAvailability(world);
  for (const facility of facilities(world)) {
    if (facility.kind === "grainMarket") tradeAtMarket(world, facility);
  }
  refreshFacilityAvailability(world);
}
