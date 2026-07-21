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
