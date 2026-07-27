import {
  type AgentActivity,
  type AgentState,
  type AgentTask,
  type Building,
  CARRY_CAPACITY,
  EAT_TICKS,
  FATIGUE_MAX,
  FATIGUE_REST_RECOVERY_PER_DAY,
  type Facility,
  FOOD_PER_MEAL,
  FORAGE_TICKS,
  GATHER_TICKS,
  HOUSE_BUILD_TICKS,
  HOUSE_WOOD_COST,
  type House,
  HUNGER_MAX,
  HUNGER_PER_MEAL,
  isHouse,
  type MovementPurpose,
  type Position,
  TICKS_PER_DAY,
  type Tile,
  type WorldState,
} from "@agent-town/shared";

import { findNearestReachable, findPath, isWalkable } from "./astar.js";
import {
  applyFacilityBuild,
  applyFacilityMaintenance,
  deliverFacilityTransfer,
  findFacility,
  withdrawFacilityTransfer,
} from "./construction.js";
import { applyMealFromStore, chooseFoodStore, foodStorePos } from "./facilityOperation.js";
import { moveTicksForTrail, type Traversal, trailLevelAt } from "./traffic.js";

type MovingActivity = Extract<AgentActivity, { kind: "moving" }>;

export type TraversalRecorder = (traversal: Traversal) => void;

/** Bundles what every movement step needs, so recording can never diverge per task. */
interface StepContext {
  speed: number;
  record: TraversalRecorder;
}

const FACILITY_TASK_KINDS = ["transferToFacility", "buildFacility", "maintainFacility"] as const;

type FacilityTask = Extract<AgentTask, { kind: (typeof FACILITY_TASK_KINDS)[number] }>;

function isFacilityTask(task: AgentTask | undefined): task is FacilityTask {
  return task !== undefined && FACILITY_TASK_KINDS.some((kind) => kind === task.kind);
}

/** A move on its own says nothing; the task it serves is what wears the ground. */
function intentTask(tasks: AgentTask[]): AgentTask | undefined {
  return tasks[0]?.kind === "moveTo" ? tasks[1] : tasks[0];
}

function movementPurpose(tasks: AgentTask[]): MovementPurpose {
  const task = intentTask(tasks);
  if (task?.kind === "build" || task?.kind === "buildFacility") return "construction";
  if (isFacilityTask(task)) return "facilityService";
  if (task?.kind === "gather") return "gathering";
  if (task?.kind === "eat" || task?.kind === "forage" || task?.kind === "rest") {
    return "survival";
  }
  return "wandering";
}

function movementFacilityId(tasks: AgentTask[]): string | null {
  const task = intentTask(tasks);
  return isFacilityTask(task) ? task.facilityId : null;
}

/** The one place a resident's position changes, so every completed step leaves wear. */
function commitStep(
  agent: AgentState,
  next: Position,
  step: StepContext,
  facilityId = movementFacilityId(agent.tasks),
): void {
  agent.pos = next;
  step.record({
    pos: next,
    purpose: movementPurpose(agent.tasks),
    facilityId,
  });
}

interface GatherTarget {
  tile: Tile;
  resource: NonNullable<Tile["resource"]>;
}

function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function isAdjacentOrOn(left: Position, right: Position): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) <= 1;
}

function tileAt(world: WorldState, pos: Position): Tile | undefined {
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) return undefined;
  return world.tiles[pos.y * world.width + pos.x];
}

function finishHeadTask(agent: AgentState): void {
  agent.tasks.shift();
  agent.activity = { kind: "idle" };
}

function prepareMovement(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "moveTo" }>,
): MovingActivity | null {
  if (agent.activity.kind === "moving") return agent.activity;
  const path = findPath(world, agent.pos, task.dest);
  if (path === null || path.length === 0) {
    finishHeadTask(agent);
    return null;
  }

  const activity: MovingActivity = { kind: "moving", path, ticksIntoStep: 0 };
  agent.activity = activity;
  return activity;
}

function stepMoveTo(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "moveTo" }>,
  step: StepContext,
): void {
  const activity = prepareMovement(world, agent, task);
  if (activity === null) return;

  const next = activity.path[0];
  if (next === undefined || !isWalkable(world, next)) {
    finishHeadTask(agent);
    return;
  }

  const requiredTicks = moveTicksForTrail(trailLevelAt(world, next));
  activity.ticksIntoStep += step.speed;
  if (activity.ticksIntoStep < requiredTicks) return;

  activity.ticksIntoStep = Math.max(0, activity.ticksIntoStep - requiredTicks);
  activity.path.shift();
  commitStep(agent, next, step);
  if (activity.path.length === 0) {
    finishHeadTask(agent);
    return;
  }
}

function validGatherTile(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "gather" }>,
): GatherTarget | null {
  if (!isAdjacentOrOn(agent.pos, task.target)) return null;
  const tile = tileAt(world, task.target);
  if (tile?.resource?.kind !== task.resource || tile.resource.amount <= 0) return null;
  return { tile, resource: tile.resource };
}

function stepGather(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "gather" }>,
  speed: number,
): void {
  const target = validGatherTile(world, agent, task);
  if (target === null) {
    finishHeadTask(agent);
    return;
  }

  if (agent.activity.kind !== "gathering" || !positionsEqual(agent.activity.target, task.target)) {
    agent.activity = { kind: "gathering", target: task.target, ticksRemaining: GATHER_TICKS };
  }

  agent.activity.ticksRemaining -= speed;
  if (agent.activity.ticksRemaining > 0) return;

  const amount = Math.min(CARRY_CAPACITY, target.resource.amount);
  agent.carrying = { kind: task.resource, amount };
  target.resource.amount -= amount;
  if (target.resource.amount === 0) target.tile.resource = null;
  finishHeadTask(agent);
}

function stepDeposit(world: WorldState, agent: AgentState): void {
  if (!isAdjacentOrOn(agent.pos, world.stockpile.pos)) {
    finishHeadTask(agent);
    return;
  }

  agent.activity = { kind: "depositing" };
  const carrying = agent.carrying;
  if (carrying?.kind === "wood") world.stockpile.wood += carrying.amount;
  if (carrying?.kind === "food") world.stockpile.food += carrying.amount;
  agent.carrying = null;
  finishHeadTask(agent);
}

function stepToward(
  world: WorldState,
  agent: AgentState,
  dest: Position,
  hasArrived: (pos: Position) => boolean,
  step: StepContext,
  facilityId: string | null = movementFacilityId(agent.tasks),
): void {
  resetStaleMovement(agent, dest);
  if (agent.activity.kind !== "moving") {
    const path = findPath(world, agent.pos, dest);
    if (path === null || path.length === 0) {
      finishHeadTask(agent);
      return;
    }
    agent.activity = { kind: "moving", path, ticksIntoStep: 0 };
  }

  const next = agent.activity.path[0];
  if (next === undefined || !isWalkable(world, next)) {
    finishHeadTask(agent);
    return;
  }

  const requiredTicks = moveTicksForTrail(trailLevelAt(world, next));
  agent.activity.ticksIntoStep += step.speed;
  if (agent.activity.ticksIntoStep < requiredTicks) return;

  agent.activity.ticksIntoStep = Math.max(0, agent.activity.ticksIntoStep - requiredTicks);
  agent.activity.path.shift();
  commitStep(agent, next, step, facilityId);
  if (hasArrived(agent.pos)) {
    agent.activity = { kind: "idle" };
    return;
  }
}

function resetStaleMovement(agent: AgentState, destination: Position): void {
  if (agent.activity.kind !== "moving") return;
  const pathEnd = agent.activity.path.at(-1) ?? agent.pos;
  if (!positionsEqual(pathEnd, destination)) agent.activity = { kind: "idle" };
}

function stepEat(world: WorldState, agent: AgentState, step: StepContext): void {
  const store = chooseFoodStore(world, agent);
  if (store === null) {
    finishHeadTask(agent);
    return;
  }

  const counter = foodStorePos(store);
  if (!isAdjacentOrOn(agent.pos, counter)) {
    const facilityId = store.kind === "facility" ? store.facility.id : null;
    stepToward(world, agent, counter, (pos) => isAdjacentOrOn(pos, counter), step, facilityId);
    return;
  }

  if (agent.activity.kind !== "eating") {
    agent.activity = { kind: "eating", ticksRemaining: EAT_TICKS };
  }

  agent.activity.ticksRemaining -= 1;
  if (agent.activity.ticksRemaining > 0) return;

  applyMealFromStore(world, agent, store);
  finishHeadTask(agent);
}

function stepForage(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "forage" }>,
  step: StepContext,
): void {
  const tile = tileAt(world, task.target);
  if (tile?.resource?.kind !== "food" || tile.resource.amount <= 0) {
    finishHeadTask(agent);
    return;
  }

  if (!positionsEqual(agent.pos, task.target)) {
    stepToward(world, agent, task.target, (pos) => positionsEqual(pos, task.target), step);
    return;
  }

  if (agent.activity.kind !== "foraging" || !positionsEqual(agent.activity.target, task.target)) {
    agent.activity = { kind: "foraging", target: task.target, ticksRemaining: FORAGE_TICKS };
  }

  agent.activity.ticksRemaining -= 1;
  if (agent.activity.ticksRemaining > 0) return;

  tile.resource.amount = Math.max(0, tile.resource.amount - FOOD_PER_MEAL);
  if (tile.resource.amount === 0) tile.resource = null;
  agent.hunger = Math.min(HUNGER_MAX, agent.hunger + HUNGER_PER_MEAL);
  finishHeadTask(agent);
}

function buildingAt(world: WorldState, pos: Position): Building | undefined {
  return world.buildings.find((building) => positionsEqual(building.pos, pos));
}

function houseAt(world: WorldState, pos: Position): House | undefined {
  return world.buildings.filter(isHouse).find((house) => positionsEqual(house.pos, pos));
}

function buildApproachPositions(
  world: WorldState,
  target: Position,
  allowTarget: boolean,
): Position[] {
  const positions = [
    { x: target.x, y: target.y - 1 },
    { x: target.x + 1, y: target.y },
    { x: target.x, y: target.y + 1 },
    { x: target.x - 1, y: target.y },
  ];
  if (allowTarget) positions.unshift(target);
  return positions.filter((pos) => isWalkable(world, pos));
}

function isValidNewHouseSite(world: WorldState, target: Position): boolean {
  const tile = tileAt(world, target);
  if (!isWalkable(world, target) || tile?.resource !== null) return false;
  if (positionsEqual(target, world.stockpile.pos) || buildingAt(world, target) !== undefined) {
    return false;
  }
  return !world.agents.some((agent) => positionsEqual(agent.pos, target));
}

function beginOrResumeHouse(world: WorldState, agent: AgentState, pos: Position): House | null {
  const existing = houseAt(world, pos);
  if (existing !== undefined) return existing;
  if (world.stockpile.wood < HOUSE_WOOD_COST) {
    finishHeadTask(agent);
    return null;
  }
  world.stockpile.wood -= HOUSE_WOOD_COST;
  const house = { kind: "house", pos, progress: 0, complete: false } as const;
  world.buildings.push(house);
  return house;
}

function canContinueBuildTask(
  world: WorldState,
  pos: Position,
  existing: House | undefined,
): boolean {
  if (!isWalkable(world, pos)) return false;
  if (existing !== undefined) return true;
  return isValidNewHouseSite(world, pos) && world.stockpile.wood >= HOUSE_WOOD_COST;
}

function stepBuild(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "build" }>,
  step: StepContext,
): void {
  const existing = houseAt(world, task.pos);
  if (existing?.complete === true) {
    finishHeadTask(agent);
    return;
  }
  if (!canContinueBuildTask(world, task.pos, existing)) {
    finishHeadTask(agent);
    return;
  }
  if (!isAdjacentOrOn(agent.pos, task.pos)) {
    const approach = findNearestReachable(
      world,
      agent.pos,
      buildApproachPositions(world, task.pos, existing !== undefined),
    );
    if (approach === null) {
      finishHeadTask(agent);
      return;
    }
    stepToward(world, agent, approach, (pos) => positionsEqual(pos, approach), step);
    return;
  }

  const house = beginOrResumeHouse(world, agent, task.pos);
  if (house === null) return;
  agent.activity = { kind: "building", target: task.pos };
  house.progress = Math.min(HOUSE_BUILD_TICKS, house.progress + 1);
  house.complete = house.progress === HOUSE_BUILD_TICKS;
  if (house.complete) finishHeadTask(agent);
}

function restTarget(world: WorldState, agent: AgentState): Position | null {
  const completeHouses = world.buildings
    .filter(isHouse)
    .filter(({ complete }) => complete)
    .map(({ pos }) => pos);
  return (
    findNearestReachable(world, agent.pos, completeHouses) ??
    findNearestReachable(world, agent.pos, [world.stockpile.pos])
  );
}

function stepRest(world: WorldState, agent: AgentState, step: StepContext): void {
  const target = restTarget(world, agent);
  if (target === null) {
    finishHeadTask(agent);
    return;
  }
  if (!positionsEqual(agent.pos, target)) {
    stepToward(world, agent, target, (pos) => positionsEqual(pos, target), step);
    return;
  }

  agent.activity = { kind: "resting", target };
  agent.fatigue = Math.min(
    FATIGUE_MAX,
    agent.fatigue + FATIGUE_REST_RECOVERY_PER_DAY / TICKS_PER_DAY,
  );
  if (agent.fatigue === FATIGUE_MAX) finishHeadTask(agent);
}

/** Walks the last stretch to a facility; true once the resident can work on it. */
function reachedFacility(
  world: WorldState,
  agent: AgentState,
  facility: Facility,
  step: StepContext,
): boolean {
  if (isAdjacentOrOn(agent.pos, facility.pos)) return true;
  const approach = findNearestReachable(
    world,
    agent.pos,
    buildApproachPositions(world, facility.pos, false),
  );
  if (approach === null) {
    finishHeadTask(agent);
    return false;
  }
  stepToward(world, agent, approach, (pos) => positionsEqual(pos, approach), step);
  return false;
}

function collectTransferLoad(
  world: WorldState,
  agent: AgentState,
  facility: Facility,
  task: Extract<AgentTask, { kind: "transferToFacility" }>,
  step: StepContext,
): void {
  if (!isAdjacentOrOn(agent.pos, world.stockpile.pos)) {
    stepToward(
      world,
      agent,
      world.stockpile.pos,
      (pos) => isAdjacentOrOn(pos, world.stockpile.pos),
      step,
    );
    return;
  }

  const amount = withdrawFacilityTransfer(world, facility, task.resource);
  if (amount === 0) {
    finishHeadTask(agent);
    return;
  }
  agent.carrying = { kind: task.resource, amount };
}

function stepTransferToFacility(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "transferToFacility" }>,
  step: StepContext,
): void {
  const facility = findFacility(world, task.facilityId);
  if (facility === null) {
    finishHeadTask(agent);
    return;
  }

  const carrying = agent.carrying;
  if (carrying === null) {
    collectTransferLoad(world, agent, facility, task, step);
    return;
  }
  if (carrying.kind !== task.resource) {
    finishHeadTask(agent);
    return;
  }
  if (!reachedFacility(world, agent, facility, step)) return;

  const remainder = deliverFacilityTransfer(world, facility, task.resource, carrying.amount);
  agent.carrying = remainder > 0 ? { kind: task.resource, amount: remainder } : null;
  finishHeadTask(agent);
}

function stepBuildFacility(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "buildFacility" }>,
  step: StepContext,
): void {
  const facility = findFacility(world, task.facilityId);
  if (facility === null || facility.complete) {
    finishHeadTask(agent);
    return;
  }
  if (!reachedFacility(world, agent, facility, step)) return;

  if (!applyFacilityBuild(world, facility, 1)) {
    finishHeadTask(agent);
    return;
  }
  agent.activity = { kind: "building", target: facility.pos };
  if (facility.complete) finishHeadTask(agent);
}

function stepMaintainFacility(
  world: WorldState,
  agent: AgentState,
  task: Extract<AgentTask, { kind: "maintainFacility" }>,
  step: StepContext,
): void {
  const facility = findFacility(world, task.facilityId);
  if (facility === null || !facility.complete) {
    finishHeadTask(agent);
    return;
  }
  if (!reachedFacility(world, agent, facility, step)) return;

  if (applyFacilityMaintenance(facility, 1) === 0) {
    finishHeadTask(agent);
    return;
  }
  agent.activity = { kind: "maintaining", facilityId: facility.id };
}

export function stepAgent(
  world: WorldState,
  agent: AgentState,
  speed = 1,
  record: TraversalRecorder = () => undefined,
): void {
  const task = agent.tasks[0];
  if (task === undefined) {
    agent.activity = { kind: "idle" };
    return;
  }

  const step: StepContext = { speed, record };
  switch (task.kind) {
    case "moveTo":
      stepMoveTo(world, agent, task, step);
      break;
    case "gather":
      stepGather(world, agent, task, speed);
      break;
    case "eat":
      stepEat(world, agent, step);
      break;
    case "forage":
      stepForage(world, agent, task, step);
      break;
    case "build":
      stepBuild(world, agent, task, step);
      break;
    case "rest":
      stepRest(world, agent, step);
      break;
    case "deposit":
      stepDeposit(world, agent);
      break;
    case "transferToFacility":
      stepTransferToFacility(world, agent, task, step);
      break;
    case "buildFacility":
      stepBuildFacility(world, agent, task, step);
      break;
    case "maintainFacility":
      stepMaintainFacility(world, agent, task, step);
      break;
  }
}
