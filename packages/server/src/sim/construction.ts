import {
  type AgentState,
  type AgentTask,
  CARRY_CAPACITY,
  dailyFoodNeed,
  FACILITY_BUILD_TICKS,
  FACILITY_FOOD_CAPACITY,
  FACILITY_STOCK_RESERVE_DAYS,
  type Facility,
  isFacility,
  MARKET_IMPORT_WOOD,
  type ResourceKind,
  type SpatialDemand,
  type WorldState,
} from "@agent-town/shared";

import { refreshFacilityAvailability } from "./facilityOperation.js";

export function findFacility(world: WorldState, facilityId: string): Facility | null {
  return world.buildings.filter(isFacility).find(({ id }) => id === facilityId) ?? null;
}

function demandForFacility(world: WorldState, facility: Facility): SpatialDemand {
  const demand = world.spatialDemands.find(({ id }) => id === facility.demandId);
  if (demand === undefined) {
    throw new Error(`facility ${facility.id} has no demand ${facility.demandId}`);
  }
  return demand;
}

export function facilityWoodRemaining(world: WorldState, facility: Facility): number {
  if (facility.complete) return 0;
  return Math.max(0, demandForFacility(world, facility).requiredWood - facility.woodDelivered);
}

/** How much of a resource this facility can still take, in its current phase. */
function acceptableAmount(world: WorldState, facility: Facility, resource: ResourceKind): number {
  if (!facility.complete) return resource === "wood" ? facilityWoodRemaining(world, facility) : 0;
  if (resource === "wood") return Number.POSITIVE_INFINITY;
  return Math.max(0, FACILITY_FOOD_CAPACITY[facility.kind] - facility.inventory.food);
}

export function withdrawFacilityTransfer(
  world: WorldState,
  facility: Facility,
  resource: ResourceKind,
): number {
  const stocked = resource === "wood" ? world.stockpile.wood : world.stockpile.food;
  const amount = Math.min(CARRY_CAPACITY, stocked, acceptableAmount(world, facility, resource));
  if (amount <= 0) return 0;

  if (resource === "wood") world.stockpile.wood -= amount;
  else world.stockpile.food -= amount;
  return amount;
}

/** Returns the amount the facility could not take, which stays with the resident. */
export function deliverFacilityTransfer(
  world: WorldState,
  facility: Facility,
  resource: ResourceKind,
  amount: number,
): number {
  const accepted = Math.min(amount, acceptableAmount(world, facility, resource));
  if (accepted <= 0) return amount;

  if (!facility.complete) facility.woodDelivered += accepted;
  else if (resource === "wood") facility.inventory.wood += accepted;
  else facility.inventory.food += accepted;

  if (resource === "wood") facility.statsToday.woodReceived += accepted;
  return amount - accepted;
}

/** Returns whether the work advanced construction; completion shows on the facility. */
export function applyFacilityBuild(world: WorldState, facility: Facility, work: number): boolean {
  if (facility.complete || work <= 0) return false;
  const demand = demandForFacility(world, facility);
  if (facilityWoodRemaining(world, facility) > 0) return false;

  demand.status = "building";
  const labor = FACILITY_BUILD_TICKS[facility.kind];
  facility.progress = Math.min(labor, facility.progress + work);
  if (facility.progress < labor) return true;

  facility.complete = true;
  facility.operation = "active";
  facility.blockedReason = null;
  demand.status = "fulfilled";
  return true;
}

/** Returns the work the facility actually needed, so idle upkeep is never recorded. */
export function applyFacilityMaintenance(facility: Facility, work: number): number {
  const applied = Math.min(Math.max(0, work), facility.maintenanceDue);
  if (applied <= 0) return 0;

  facility.maintenanceDue -= applied;
  facility.statsToday.maintenanceWork += applied;
  return applied;
}

function transferTask(facility: Facility, resource: ResourceKind): AgentTask {
  return { kind: "transferToFacility", facilityId: facility.id, resource };
}

function constructionTask(world: WorldState, facility: Facility): AgentTask | null {
  if (facility.complete) return null;
  if (facilityWoodRemaining(world, facility) === 0) {
    return { kind: "buildFacility", facilityId: facility.id };
  }
  return world.stockpile.wood > 0 ? transferTask(facility, "wood") : null;
}

/**
 * Residents keep a day's meals at hand and store what is beyond it, so a settlement
 * fills the store it built against scarcity while it is still scarce.
 */
function hasStorableFood(world: WorldState): boolean {
  return world.stockpile.food > FACILITY_STOCK_RESERVE_DAYS * dailyFoodNeed(world);
}

function needsTradingWood(facility: Facility): boolean {
  return (
    facility.kind === "grainMarket" &&
    facility.operation === "active" &&
    facility.inventory.wood < MARKET_IMPORT_WOOD
  );
}

function serviceTask(world: WorldState, facility: Facility): AgentTask | null {
  if (!facility.complete) return null;
  if (facility.maintenanceDue > 0) return { kind: "maintainFacility", facilityId: facility.id };
  if (facility.operation !== "active") return null;
  if (needsTradingWood(facility) && world.stockpile.wood > 0) {
    return transferTask(facility, "wood");
  }
  const hasRoom = facility.inventory.food < FACILITY_FOOD_CAPACITY[facility.kind];
  return hasStorableFood(world) && hasRoom ? transferTask(facility, "food") : null;
}

/**
 * Every site is raised before any is stocked, so a settlement finishes what it
 * started instead of scattering its labour across half-built plots.
 */
export function planFacilityTasks(world: WorldState, agent: AgentState): AgentTask[] | null {
  void agent;
  refreshFacilityAvailability(world);
  const sites = world.buildings.filter(isFacility);
  for (const facility of sites) {
    const task = constructionTask(world, facility);
    if (task !== null) return [task];
  }
  for (const facility of sites) {
    const task = serviceTask(world, facility);
    if (task !== null) return [task];
  }
  return null;
}
