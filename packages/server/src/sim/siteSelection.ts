import {
  FACILITY_SITE_DISTANCE_CAP,
  FACILITY_SITE_WEIGHTS,
  type FacilityKind,
  type Position,
  SITE_FACTORS,
  type SiteFactor,
  type SiteRationale,
  TRAIL_LEVEL_WEAR,
  type WorldState,
} from "@agent-town/shared";

import { filterReachable, isWalkable } from "./astar.js";

const CARDINALS: readonly Position[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function manhattanDistance(from: Position, to: Position): number {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
}

function proximity(distance: number): number {
  return 1 - Math.min(distance, FACILITY_SITE_DISTANCE_CAP) / FACILITY_SITE_DISTANCE_CAP;
}

function siteIndex(world: WorldState, pos: Position): number {
  return pos.y * world.width + pos.x;
}

function nearestFoodDistance(world: WorldState, pos: Position): number {
  let nearest = FACILITY_SITE_DISTANCE_CAP;
  for (const [index, tile] of world.tiles.entries()) {
    if (tile.resource?.kind !== "food") continue;
    const food = { x: index % world.width, y: Math.floor(index / world.width) };
    nearest = Math.min(nearest, manhattanDistance(pos, food));
  }
  return nearest;
}

function residentDistances(world: WorldState, pos: Position): number[] {
  return world.agents.map((agent) => manhattanDistance(pos, agent.pos));
}

function meanResidentDistance(world: WorldState, pos: Position): number {
  const distances = residentDistances(world, pos);
  if (distances.length === 0) return FACILITY_SITE_DISTANCE_CAP;
  return distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
}

function residentDistanceSpread(world: WorldState, pos: Position): number {
  const distances = residentDistances(world, pos);
  if (distances.length < 2) return 0;
  return Math.max(...distances) - Math.min(...distances);
}

function distanceToMapEdge(world: WorldState, pos: Position): number {
  return Math.min(pos.x, pos.y, world.width - 1 - pos.x, world.height - 1 - pos.y);
}

/** Counts passable neighbours, so a site's openness never drifts as residents walk past. */
function cardinalOpenSpace(world: WorldState, pos: Position): number {
  return CARDINALS.filter((step) => isWalkable(world, { x: pos.x + step.x, y: pos.y + step.y }))
    .length;
}

function scoreSite(world: WorldState, kind: FacilityKind, pos: Position): SiteRationale {
  const values: Readonly<Record<SiteFactor, number>> = {
    foodAccess: proximity(nearestFoodDistance(world, pos)),
    residentAccess: proximity(meanResidentDistance(world, pos)),
    stockpileAccess: proximity(manhattanDistance(pos, world.stockpile.pos)),
    existingTraffic: Math.min(
      1,
      (world.trailCells[siteIndex(world, pos)]?.wear ?? 0) / TRAIL_LEVEL_WEAR.establishedTrail,
    ),
    settlementEdgeAccess: proximity(distanceToMapEdge(world, pos)),
    openSpace: cardinalOpenSpace(world, pos) / 4,
    accessEquality: proximity(residentDistanceSpread(world, pos)),
  };
  const weights = FACILITY_SITE_WEIGHTS[kind];
  const contributions = SITE_FACTORS.filter((factor) => weights[factor] > 0)
    .map((factor) => ({
      factor,
      value: values[factor],
      weightedScore: values[factor] * weights[factor],
    }))
    .toSorted(
      (left, right) =>
        right.weightedScore - left.weightedScore || left.factor.localeCompare(right.factor),
    );

  return {
    score: contributions.reduce((sum, contribution) => sum + contribution.weightedScore, 0),
    contributions,
  };
}

function isFreeCell(world: WorldState, pos: Position): boolean {
  if (!isWalkable(world, pos)) return false;
  if (world.tiles[siteIndex(world, pos)]?.resource != null) return false;
  if (positionsEqual(pos, world.stockpile.pos)) return false;
  if (world.agents.some((agent) => positionsEqual(agent.pos, pos))) return false;
  return !world.buildings.some((building) => positionsEqual(building.pos, pos));
}

/** Row-major so an exact tie always resolves against the same candidate order. */
function candidateSites(world: WorldState): Position[] {
  const free: Position[] = [];
  for (let index = 0; index < world.tiles.length; index += 1) {
    const pos = { x: index % world.width, y: Math.floor(index / world.width) };
    if (isFreeCell(world, pos)) free.push(pos);
  }
  return filterReachable(world, world.stockpile.pos, free);
}

export function selectFacilitySite(
  world: WorldState,
  kind: FacilityKind,
  rng: () => number,
): { pos: Position; rationale: SiteRationale } | null {
  const scored = candidateSites(world).map((pos) => ({
    pos,
    rationale: scoreSite(world, kind, pos),
  }));
  if (scored.length === 0) return null;

  const best = Math.max(...scored.map(({ rationale }) => rationale.score));
  const tied = scored.filter(({ rationale }) => rationale.score === best);
  const chosen = tied[Math.min(tied.length - 1, Math.floor(rng() * tied.length))];
  return chosen ?? null;
}
