import type { Position, WorldState } from "../../../shared/src/world.js";

interface SearchNode {
  pos: Position;
  distance: number;
  estimatedTotal: number;
}

interface SearchState {
  open: SearchNode[];
  cameFrom: Map<string, Position>;
  distances: Map<string, number>;
  visited: Set<string>;
}

const DIRECTIONS: readonly Position[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function positionKey(pos: Position): string {
  return `${pos.x},${pos.y}`;
}

function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function manhattanDistance(from: Position, to: Position): number {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
}

export function isWalkable(world: WorldState, pos: Position): boolean {
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) {
    return false;
  }

  const terrain = world.tiles[pos.y * world.width + pos.x]?.terrain;
  return terrain === "plains" || terrain === "forest";
}

function reconstructPath(
  cameFrom: ReadonlyMap<string, Position>,
  from: Position,
  to: Position,
): Position[] | null {
  const path: Position[] = [];
  let current = to;

  while (!positionsEqual(current, from)) {
    path.push(current);
    const previous = cameFrom.get(positionKey(current));
    if (previous === undefined) return null;
    current = previous;
  }

  return path.reverse();
}

function compareNodes(left: SearchNode, right: SearchNode): number {
  return (
    left.estimatedTotal - right.estimatedTotal ||
    left.distance - right.distance ||
    left.pos.y - right.pos.y ||
    left.pos.x - right.pos.x
  );
}

function neighbors(pos: Position): Position[] {
  return DIRECTIONS.map((direction) => ({ x: pos.x + direction.x, y: pos.y + direction.y }));
}

function createSearchState(from: Position, to: Position): SearchState {
  return {
    open: [{ pos: from, distance: 0, estimatedTotal: manhattanDistance(from, to) }],
    cameFrom: new Map(),
    distances: new Map([[positionKey(from), 0]]),
    visited: new Set(),
  };
}

function updateNeighbor(
  world: WorldState,
  to: Position,
  state: SearchState,
  current: SearchNode,
  next: Position,
): void {
  if (!isWalkable(world, next)) return;

  const nextKey = positionKey(next);
  if (state.visited.has(nextKey)) return;

  const distance = current.distance + 1;
  if (distance >= (state.distances.get(nextKey) ?? Number.POSITIVE_INFINITY)) return;

  state.cameFrom.set(nextKey, current.pos);
  state.distances.set(nextKey, distance);
  state.open.push({
    pos: next,
    distance,
    estimatedTotal: distance + manhattanDistance(next, to),
  });
}

function expandNode(
  world: WorldState,
  to: Position,
  state: SearchState,
  current: SearchNode,
): void {
  for (const next of neighbors(current.pos)) {
    updateNeighbor(world, to, state, current, next);
  }
}

export function findPath(world: WorldState, from: Position, to: Position): Position[] | null {
  if (!isWalkable(world, from)) return null;
  if (!isWalkable(world, to)) return null;
  if (positionsEqual(from, to)) return [];

  const state = createSearchState(from, to);

  while (state.open.length > 0) {
    state.open.sort(compareNodes);
    const current = state.open.shift();
    if (current === undefined) return null;

    const currentKey = positionKey(current.pos);
    if (state.visited.has(currentKey)) continue;
    if (positionsEqual(current.pos, to)) return reconstructPath(state.cameFrom, from, to);

    state.visited.add(currentKey);
    expandNode(world, to, state, current);
  }

  return null;
}

function enqueueUnvisited(
  world: WorldState,
  next: Position,
  distance: number,
  distances: Map<string, number>,
  queue: Position[],
): void {
  const key = positionKey(next);
  if (!isWalkable(world, next) || distances.has(key)) return;
  distances.set(key, distance);
  queue.push(next);
}

function floodDistances(world: WorldState, from: Position): Map<string, number> | null {
  if (!isWalkable(world, from)) return null;

  const distances = new Map<string, number>([[positionKey(from), 0]]);
  const queue: Position[] = [from];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current === undefined) continue;
    const currentDistance = distances.get(positionKey(current)) ?? 0;

    for (const next of neighbors(current)) {
      enqueueUnvisited(world, next, currentDistance + 1, distances, queue);
    }
  }
  return distances;
}

interface CandidateMatch {
  pos: Position;
  distance: number;
  index: number;
}

function isBetterCandidate(
  distance: number,
  index: number,
  nearest: CandidateMatch | null,
): boolean {
  if (nearest === null) return true;
  if (distance !== nearest.distance) return distance < nearest.distance;
  return index < nearest.index;
}

function selectNearestCandidate(
  world: WorldState,
  candidates: readonly Position[],
  distances: ReadonlyMap<string, number>,
): Position | null {
  let nearest: CandidateMatch | null = null;
  for (const candidate of candidates) {
    const distance = distances.get(positionKey(candidate));
    if (distance === undefined) continue;
    const index = candidate.y * world.width + candidate.x;
    if (isBetterCandidate(distance, index, nearest)) {
      nearest = { pos: candidate, distance, index };
    }
  }
  return nearest?.pos ?? null;
}

export function findNearestReachable(
  world: WorldState,
  from: Position,
  candidates: readonly Position[],
): Position | null {
  const distances = floodDistances(world, from);
  return distances === null ? null : selectNearestCandidate(world, candidates, distances);
}
