import {
  MOVE_TICKS_PER_TILE,
  MOVEMENT_PURPOSES,
  type MovementPurpose,
  type Position,
  TRAIL_DAILY_DECAY,
  TRAIL_LEVEL_WEAR,
  TRAIL_MAX_CAUSE_FACILITIES,
  TRAIL_MOVE_TICK_MULTIPLIER,
  TRAIL_PURPOSE_WEAR,
  type TrailCell,
  type TrailLevel,
  type WorldState,
} from "@agent-town/shared";

const BASE_PATH_COST = 100;

export interface Traversal {
  pos: Position;
  purpose: MovementPurpose;
  facilityId: string | null;
}

export function emptyTrailCell(): TrailCell {
  return {
    wear: 0,
    level: "none",
    passagesToday: 0,
    purposeWear: {
      survival: 0,
      gathering: 0,
      construction: 0,
      facilityService: 0,
      wandering: 0,
    },
    dominantPurpose: null,
    facilityWear: {},
    causedByFacilityIds: [],
    lastUsedAtTick: null,
  };
}

export function createTrailCells(width: number, height: number): TrailCell[] {
  return Array.from({ length: width * height }, emptyTrailCell);
}

function trailLevel(wear: number): TrailLevel {
  if (wear >= TRAIL_LEVEL_WEAR.establishedTrail) return "establishedTrail";
  if (wear >= TRAIL_LEVEL_WEAR.trail) return "trail";
  if (wear >= TRAIL_LEVEL_WEAR.trace) return "trace";
  return "none";
}

/** The strongest purpose wins; an exact tie falls back to the fixed purpose order. */
function dominantPurpose(cell: TrailCell): MovementPurpose | null {
  let best: MovementPurpose | null = null;
  for (const purpose of MOVEMENT_PURPOSES) {
    const wear = cell.purposeWear[purpose];
    if (wear <= 0) continue;
    if (best === null || wear > cell.purposeWear[best]) best = purpose;
  }
  return best;
}

/** Heaviest contributor first, ties by ID, so the named causes never flicker. */
function rankedCauses(cell: TrailCell): string[] {
  return Object.entries(cell.facilityWear)
    .toSorted(([leftId, left], [rightId, right]) => right - left || leftId.localeCompare(rightId))
    .slice(0, TRAIL_MAX_CAUSE_FACILITIES)
    .map(([id]) => id);
}

/** Kept local so the cost helpers below stay free of an astar import cycle. */
function isOpenGround(world: WorldState, pos: Position): boolean {
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) return false;
  const terrain = world.tiles[pos.y * world.width + pos.x]?.terrain;
  return terrain === "plains" || terrain === "forest";
}

function isWearable(world: WorldState, pos: Position): boolean {
  if (!isOpenGround(world, pos)) return false;
  return !world.buildings.some(({ pos: at }) => at.x === pos.x && at.y === pos.y);
}

export function recordTraversal(world: WorldState, traversal: Traversal): number | null {
  const { pos, purpose, facilityId } = traversal;
  if (!isWearable(world, pos)) return null;

  const index = pos.y * world.width + pos.x;
  const cell = world.trailCells[index];
  if (cell === undefined) return null;

  const wear = TRAIL_PURPOSE_WEAR[purpose];
  cell.wear += wear;
  cell.passagesToday += 1;
  cell.purposeWear[purpose] += wear;
  if (facilityId !== null) {
    cell.facilityWear[facilityId] = (cell.facilityWear[facilityId] ?? 0) + wear;
  }
  cell.level = trailLevel(cell.wear);
  cell.dominantPurpose = dominantPurpose(cell);
  cell.causedByFacilityIds = rankedCauses(cell);
  cell.lastUsedAtTick = world.tick;
  return index;
}

function faded(value: number): number {
  const next = value * TRAIL_DAILY_DECAY;
  return next < Number.EPSILON ? 0 : next;
}

function fadePurposes(cell: TrailCell): void {
  for (const purpose of MOVEMENT_PURPOSES) {
    cell.purposeWear[purpose] = faded(cell.purposeWear[purpose]);
  }
}

function fadeFacilities(cell: TrailCell): void {
  for (const [id, value] of Object.entries(cell.facilityWear)) {
    const next = faded(value);
    if (next === 0) delete cell.facilityWear[id];
    else cell.facilityWear[id] = next;
  }
}

function fadeCell(cell: TrailCell): boolean {
  const before = `${cell.wear}|${cell.level}|${cell.passagesToday}|${cell.dominantPurpose}|${cell.causedByFacilityIds.join(",")}`;
  cell.wear = faded(cell.wear);
  cell.passagesToday = 0;
  fadePurposes(cell);
  fadeFacilities(cell);
  cell.level = trailLevel(cell.wear);
  cell.dominantPurpose = dominantPurpose(cell);
  cell.causedByFacilityIds = rankedCauses(cell);
  return (
    before !==
    `${cell.wear}|${cell.level}|${cell.passagesToday}|${cell.dominantPurpose}|${cell.causedByFacilityIds.join(",")}`
  );
}

/** Fades every trail one day's worth and reports the cells a viewer would see change. */
export function decayTrails(world: WorldState): number[] {
  const changed: number[] = [];
  for (const [index, cell] of world.trailCells.entries()) {
    if (fadeCell(cell)) changed.push(index);
  }
  return changed;
}

export function trailLevelAt(world: WorldState, pos: Position): TrailLevel {
  return world.trailCells[pos.y * world.width + pos.x]?.level ?? "none";
}

export function moveTicksForTrail(level: TrailLevel): number {
  return MOVE_TICKS_PER_TILE * TRAIL_MOVE_TICK_MULTIPLIER[level];
}

export function pathCostForTrail(level: TrailLevel): number {
  return Math.round(BASE_PATH_COST * TRAIL_MOVE_TICK_MULTIPLIER[level]);
}
