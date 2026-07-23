import {
  type HistoryEvent,
  type Polity,
  type Position,
  WORLD_CITY_NAME_SUFFIXES,
  WORLD_MAP_CAPITAL_MIN_DISTANCE,
  WORLD_MAP_CENTER_BIAS_WEIGHT,
  WORLD_MAP_CITY_COUNT_MAX,
  WORLD_MAP_CITY_COUNT_MIN,
  WORLD_MAP_CITY_MIN_DISTANCE,
  WORLD_MAP_CLAIMED_LAND_RATIO,
  WORLD_MAP_ELEVATION_NOISE_WEIGHT,
  WORLD_MAP_FOREST_MOISTURE_THRESHOLD,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_HILLS_THRESHOLD,
  WORLD_MAP_LAND_THRESHOLD,
  WORLD_MAP_MOUNTAINS_THRESHOLD,
  WORLD_MAP_NOISE_PASSES,
  WORLD_MAP_RNG_SALT,
  WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS,
  WORLD_MAP_WAR_BORDER_CELLS_PER_EVENT,
  WORLD_MAP_WIDTH,
  type WorldBorderChange,
  type WorldCity,
  type WorldHistory,
  type WorldMap,
  type WorldMapCell,
  type WorldMapTerrain,
  type WorldTradeRoute,
} from "@agent-town/shared";

import { createRng } from "./rng.js";

export type WorldMapHistory = Pick<WorldHistory, "polities" | "events" | "settlementOrigin">;

interface PolityQuota {
  polityId: string;
  population: number;
  targetCells: number;
}

interface CapitalSeed {
  polityId: string;
  pos: Position;
  foundedByEventId: string;
}

interface QuotaDraft {
  polityId: string;
  population: number;
  targetCells: number;
  fractionalPart: number;
}

type Rng = () => number;

const WORLD_MAP_CELL_COUNT = WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT;
const FOUR_NEIGHBOR_INDEX = Array.from({ length: WORLD_MAP_CELL_COUNT }, (_value, index) =>
  createFourNeighborIndices(index),
);
const EIGHT_NEIGHBOR_INDEX = Array.from({ length: WORLD_MAP_CELL_COUNT }, (_value, index) =>
  createEightNeighborIndices(index),
);

function indexOf(pos: Position): number {
  return pos.y * WORLD_MAP_WIDTH + pos.x;
}

function positionOf(index: number): Position {
  return { x: index % WORLD_MAP_WIDTH, y: Math.floor(index / WORLD_MAP_WIDTH) };
}

function inBounds(pos: Position): boolean {
  return pos.x >= 0 && pos.x < WORLD_MAP_WIDTH && pos.y >= 0 && pos.y < WORLD_MAP_HEIGHT;
}

function createFourNeighborIndices(index: number): number[] {
  const pos = positionOf(index);
  return [
    { x: pos.x, y: pos.y - 1 },
    { x: pos.x + 1, y: pos.y },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x - 1, y: pos.y },
  ]
    .filter(inBounds)
    .map(indexOf)
    .toSorted((left, right) => left - right);
}

function fourNeighborIndices(index: number): readonly number[] {
  return FOUR_NEIGHBOR_INDEX[index] ?? [];
}

function createEightNeighborIndices(index: number): number[] {
  const pos = positionOf(index);
  const neighbors: number[] = [];
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const neighbor = { x: pos.x + offsetX, y: pos.y + offsetY };
      if (inBounds(neighbor)) neighbors.push(indexOf(neighbor));
    }
  }
  return neighbors;
}

function eightNeighborIndices(index: number): readonly number[] {
  return EIGHT_NEIGHBOR_INDEX[index] ?? [];
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) throw new Error("world map scalar values must be finite");
  return Math.max(0, Math.min(1, value));
}

function randomIndex(rng: Rng, length: number): number {
  if (length <= 0) throw new Error("world map random selection requires a candidate");
  return Math.floor(rng() * length);
}

function shuffled<T>(rng: Rng, values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIndex(rng, index + 1);
    const value = result[index];
    const replacement = result[other];
    if (value === undefined || replacement === undefined) {
      throw new Error("world map shuffle index is out of bounds");
    }
    result[index] = replacement;
    result[other] = value;
  }
  return result;
}

function createScalarField(rng: Rng): number[] {
  return Array.from({ length: WORLD_MAP_CELL_COUNT }, rng);
}

function smoothCell(field: readonly number[], index: number): number {
  const neighbors = eightNeighborIndices(index);
  let sum = field[index] ?? 0;
  for (const neighbor of neighbors) sum += field[neighbor] ?? 0;
  return sum / (neighbors.length + 1);
}

function smoothField(field: readonly number[]): number[] {
  let result = [...field];
  for (let pass = 0; pass < WORLD_MAP_NOISE_PASSES; pass += 1) {
    result = result.map((_value, index) => smoothCell(result, index));
  }
  return result;
}

function centerBias(pos: Position): number {
  const centerX = (WORLD_MAP_WIDTH - 1) / 2;
  const centerY = (WORLD_MAP_HEIGHT - 1) / 2;
  const normalizedX = (pos.x - centerX) / centerX;
  const normalizedY = (pos.y - centerY) / centerY;
  return clampUnit(1 - Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY));
}

function terrainFor(elevation: number, moisture: number): WorldMapTerrain {
  if (elevation < WORLD_MAP_LAND_THRESHOLD) return "sea";
  if (elevation >= WORLD_MAP_MOUNTAINS_THRESHOLD) return "mountains";
  if (elevation >= WORLD_MAP_HILLS_THRESHOLD) return "hills";
  if (moisture >= WORLD_MAP_FOREST_MOISTURE_THRESHOLD) return "forest";
  return "plains";
}

function createTerrain(rng: Rng): WorldMapCell[] {
  const elevation = smoothField(createScalarField(rng));
  const moisture = smoothField(createScalarField(rng));
  return elevation.map((noise, index) => {
    const combined = clampUnit(
      noise * WORLD_MAP_ELEVATION_NOISE_WEIGHT +
        centerBias(positionOf(index)) * WORLD_MAP_CENTER_BIAS_WEIGHT,
    );
    return { terrain: terrainFor(combined, moisture[index] ?? 0), polityId: null };
  });
}

function landComponent(
  cells: readonly WorldMapCell[],
  start: number,
  visited: Set<number>,
): number[] {
  const component: number[] = [];
  const pending = [start];
  let pendingIndex = 0;
  visited.add(start);
  while (pendingIndex < pending.length) {
    const index = pending[pendingIndex];
    pendingIndex += 1;
    if (index === undefined) break;
    component.push(index);
    for (const neighbor of fourNeighborIndices(index)) {
      if (visited.has(neighbor) || cells[neighbor]?.terrain === "sea") continue;
      visited.add(neighbor);
      pending.push(neighbor);
    }
  }
  return component.toSorted((left, right) => left - right);
}

function largestLandComponent(cells: readonly WorldMapCell[]): number[] {
  const visited = new Set<number>();
  let largest: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (visited.has(index) || cells[index]?.terrain === "sea") continue;
    const component = landComponent(cells, index, visited);
    if (component.length > largest.length) largest = component;
  }
  if (largest.length === 0) throw new Error("world map generation requires a landmass");
  return largest;
}

function keepLargestLandmass(cells: WorldMapCell[]): number[] {
  const largest = largestLandComponent(cells);
  const retained = new Set(largest);
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell !== undefined && cell.terrain !== "sea" && !retained.has(index)) {
      cell.terrain = "sea";
      cell.polityId = null;
    }
  }
  return largest;
}

function populationFor(history: WorldMapHistory, polityId: string): number {
  let population = 0;
  for (const event of history.events) {
    for (const effect of event.effects) {
      if (effect.kind === "population" && effect.targetId === polityId) {
        population += effect.delta;
      }
    }
  }
  return population;
}

function populationIndex(history: WorldMapHistory): Map<string, number> {
  return new Map(history.polities.map(({ id }) => [id, populationFor(history, id)] as const));
}

function distributeQuotaRemainder(drafts: QuotaDraft[], remainder: number): void {
  const priority = drafts.toSorted(
    (left, right) =>
      right.fractionalPart - left.fractionalPart ||
      right.population - left.population ||
      left.polityId.localeCompare(right.polityId),
  );
  for (let index = 0; index < remainder; index += 1) {
    const draft = priority[index];
    if (draft === undefined) throw new Error("world map quota remainder cannot be allocated");
    draft.targetCells += 1;
  }
}

function createQuotas(history: WorldMapHistory, landCellCount: number): PolityQuota[] {
  if (history.polities.length === 0) throw new Error("world map generation requires polities");
  const claimableCells = Math.floor(landCellCount * WORLD_MAP_CLAIMED_LAND_RATIO);
  const populations = populationIndex(history);
  const effectivePopulation = history.polities.reduce(
    (total, polity) => total + Math.max(1, populations.get(polity.id) ?? 0),
    0,
  );
  const drafts = history.polities.map(({ id }) => {
    const population = populations.get(id) ?? 0;
    const rawQuota = (claimableCells * Math.max(1, population)) / effectivePopulation;
    const targetCells = Math.floor(rawQuota);
    return {
      polityId: id,
      population,
      targetCells,
      fractionalPart: rawQuota - targetCells,
    };
  });
  const allocated = drafts.reduce((total, { targetCells }) => total + targetCells, 0);
  distributeQuotaRemainder(drafts, claimableCells - allocated);
  return drafts
    .map(({ polityId, population, targetCells }) => ({
      polityId,
      population,
      targetCells,
    }))
    .toSorted((left, right) => left.polityId.localeCompare(right.polityId));
}

function terrainPriority(terrain: WorldMapTerrain): number {
  if (terrain === "plains") return 0;
  if (terrain === "forest") return 1;
  if (terrain === "hills") return 2;
  if (terrain === "mountains") return 3;
  return 4;
}

function orderedCapitalCandidates(rng: Rng, cells: readonly WorldMapCell[]): number[] {
  const groups = new Map<number, number[]>();
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell === undefined || cell.terrain === "sea") continue;
    const priority = terrainPriority(cell.terrain);
    const group = groups.get(priority) ?? [];
    group.push(index);
    groups.set(priority, group);
  }
  return [0, 1, 2, 3].flatMap((priority) =>
    shuffled(
      rng,
      (groups.get(priority) ?? []).toSorted((left, right) => left - right),
    ),
  );
}

function manhattanDistance(left: Position, right: Position): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function farEnoughFromCapitals(index: number, capitals: readonly CapitalSeed[], distance: number) {
  const pos = positionOf(index);
  return capitals.every((capital) => manhattanDistance(pos, capital.pos) >= distance);
}

function foundingEventFor(history: WorldMapHistory, polityId: string): HistoryEvent {
  const event = history.events.find(
    ({ kind, polityIds }) =>
      kind === "founding" && polityIds.length === 1 && polityIds[0] === polityId,
  );
  if (event === undefined)
    throw new Error(`world map polity ${polityId} requires a founding event`);
  return event;
}

function capitalsAtDistance(
  history: WorldMapHistory,
  candidates: readonly number[],
  distance: number,
): CapitalSeed[] | null {
  const capitals: CapitalSeed[] = [];
  const polities = history.polities.toSorted((left, right) => left.id.localeCompare(right.id));
  for (const polity of polities) {
    const index = candidates.find((candidate) =>
      farEnoughFromCapitals(candidate, capitals, distance),
    );
    if (index === undefined) return null;
    capitals.push({
      polityId: polity.id,
      pos: positionOf(index),
      foundedByEventId: foundingEventFor(history, polity.id).id,
    });
  }
  return capitals;
}

function placeCapitals(rng: Rng, history: WorldMapHistory, cells: WorldMapCell[]): CapitalSeed[] {
  const candidates = orderedCapitalCandidates(rng, cells);
  for (let distance = WORLD_MAP_CAPITAL_MIN_DISTANCE; distance >= 0; distance -= 1) {
    const capitals = capitalsAtDistance(history, candidates, distance);
    if (capitals === null) continue;
    for (const capital of capitals) {
      const cell = cells[indexOf(capital.pos)];
      if (cell === undefined || cell.terrain === "sea") {
        throw new Error("world map capital must be placed on land");
      }
      cell.polityId = capital.polityId;
    }
    return capitals;
  }
  throw new Error("world map cannot place every capital");
}

function countTerritories(cells: readonly WorldMapCell[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    if (cell.polityId !== null) {
      counts.set(cell.polityId, (counts.get(cell.polityId) ?? 0) + 1);
    }
  }
  return counts;
}

interface TerritoryFrontier {
  candidates: number[];
  membership: Set<number>;
}

type TerritoryFrontiers = Map<string, TerritoryFrontier>;

function frontierCandidatePosition(candidates: readonly number[], candidate: number): number {
  let lower = 0;
  let upper = candidates.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if ((candidates[middle] ?? candidate) < candidate) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function addFrontierCandidate(frontier: TerritoryFrontier, candidate: number): void {
  if (frontier.membership.has(candidate)) return;
  const position = frontierCandidatePosition(frontier.candidates, candidate);
  frontier.candidates.splice(position, 0, candidate);
  frontier.membership.add(candidate);
}

function deleteFrontierCandidate(frontier: TerritoryFrontier, candidate: number): void {
  if (!frontier.membership.delete(candidate)) return;
  const position = frontierCandidatePosition(frontier.candidates, candidate);
  if (frontier.candidates[position] !== candidate) {
    throw new Error("world map territory frontier index is inconsistent");
  }
  frontier.candidates.splice(position, 1);
}

function indexInitialFrontierCandidate(
  cells: readonly WorldMapCell[],
  frontiers: TerritoryFrontiers,
  index: number,
): void {
  const cell = cells[index];
  if (cell === undefined || cell.terrain === "sea" || cell.polityId !== null) return;
  for (const neighbor of fourNeighborIndices(index)) {
    const polityId = cells[neighbor]?.polityId;
    if (polityId === null || polityId === undefined) continue;
    const frontier = frontiers.get(polityId);
    if (frontier !== undefined) addFrontierCandidate(frontier, index);
  }
}

function createTerritoryFrontiers(
  cells: readonly WorldMapCell[],
  quotas: readonly PolityQuota[],
): TerritoryFrontiers {
  const frontiers: TerritoryFrontiers = new Map(
    quotas.map(
      ({ polityId }) => [polityId, { candidates: [], membership: new Set<number>() }] as const,
    ),
  );
  for (let index = 0; index < cells.length; index += 1) {
    indexInitialFrontierCandidate(cells, frontiers, index);
  }
  return frontiers;
}

function orderedFrontierCandidates(
  frontiers: ReadonlyMap<string, TerritoryFrontier>,
  polityId: string,
): readonly number[] {
  return frontiers.get(polityId)?.candidates ?? [];
}

function removeFromFrontiers(frontiers: TerritoryFrontiers, index: number): void {
  for (const frontier of frontiers.values()) deleteFrontierCandidate(frontier, index);
}

function addUnclaimedNeighbors(
  cells: readonly WorldMapCell[],
  frontiers: TerritoryFrontiers,
  polityId: string,
  index: number,
): void {
  const frontier = frontiers.get(polityId);
  if (frontier === undefined) throw new Error(`world map polity ${polityId} has no frontier`);
  for (const neighbor of fourNeighborIndices(index)) {
    const cell = cells[neighbor];
    if (cell !== undefined && cell.terrain !== "sea" && cell.polityId === null) {
      addFrontierCandidate(frontier, neighbor);
    }
  }
}

function claimTerritoryCell(
  cells: WorldMapCell[],
  frontiers: TerritoryFrontiers,
  polityId: string,
  index: number,
): void {
  const cell = cells[index];
  if (cell === undefined || cell.terrain === "sea" || cell.polityId !== null) {
    throw new Error("world map selected territory cell is unavailable");
  }
  cell.polityId = polityId;
  removeFromFrontiers(frontiers, index);
  addUnclaimedNeighbors(cells, frontiers, polityId, index);
}

function refreshAdjacentFrontier(
  cells: readonly WorldMapCell[],
  frontiers: TerritoryFrontiers,
  polityId: string,
  changedIndex: number,
): void {
  const frontier = frontiers.get(polityId);
  if (frontier === undefined) throw new Error(`world map polity ${polityId} has no frontier`);
  for (const neighbor of fourNeighborIndices(changedIndex)) {
    const cell = cells[neighbor];
    if (cell === undefined || cell.terrain === "sea" || cell.polityId !== null) continue;
    const touchesPolity = fourNeighborIndices(neighbor).some(
      (candidate) => cells[candidate]?.polityId === polityId,
    );
    if (touchesPolity) addFrontierCandidate(frontier, neighbor);
    else deleteFrontierCandidate(frontier, neighbor);
  }
}

function weightedCandidate(
  rng: Rng,
  cells: readonly WorldMapCell[],
  candidates: readonly number[],
): number {
  let totalWeight = 0;
  for (const index of candidates) {
    totalWeight += WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS[cells[index]?.terrain ?? "sea"];
  }
  let draw = rng() * totalWeight;
  for (const index of candidates) {
    draw -= WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS[cells[index]?.terrain ?? "sea"];
    if (draw < 0) return index;
  }
  const fallback = candidates.at(-1);
  if (fallback === undefined) throw new Error("world map territory requires a frontier");
  return fallback;
}

function ownedIndices(cells: readonly WorldMapCell[], polityId: string): number[] {
  const owned: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]?.polityId === polityId) owned.push(index);
  }
  return owned;
}

function connectedIndices(
  cells: readonly WorldMapCell[],
  polityId: string,
  start: number,
): Set<number> {
  const connected = new Set([start]);
  const pending = [start];
  let pendingIndex = 0;
  while (pendingIndex < pending.length) {
    const index = pending[pendingIndex];
    pendingIndex += 1;
    if (index === undefined) break;
    for (const neighbor of fourNeighborIndices(index)) {
      if (connected.has(neighbor) || cells[neighbor]?.polityId !== polityId) continue;
      connected.add(neighbor);
      pending.push(neighbor);
    }
  }
  return connected;
}

function connectsAll(
  cells: readonly WorldMapCell[],
  polityId: string,
  start: number,
  targets: readonly number[],
): boolean {
  const remaining = new Set(targets);
  const visited = new Set([start]);
  const pending = [start];
  let pendingIndex = 0;
  remaining.delete(start);
  while (pendingIndex < pending.length && remaining.size > 0) {
    const index = pending[pendingIndex];
    pendingIndex += 1;
    if (index === undefined) break;
    for (const neighbor of fourNeighborIndices(index)) {
      if (visited.has(neighbor) || cells[neighbor]?.polityId !== polityId) continue;
      visited.add(neighbor);
      remaining.delete(neighbor);
      pending.push(neighbor);
    }
  }
  return remaining.size === 0;
}

function remainsConnectedAfterRemoval(
  cells: WorldMapCell[],
  polityId: string,
  removedIndex: number,
): boolean {
  const cell = cells[removedIndex];
  if (cell?.polityId !== polityId) return false;
  cell.polityId = null;
  const neighbors = fourNeighborIndices(removedIndex).filter(
    (neighbor) => cells[neighbor]?.polityId === polityId,
  );
  const start = neighbors[0];
  const connected =
    start !== undefined &&
    (neighbors.length === 1 || connectsAll(cells, polityId, start, neighbors.slice(1)));
  cell.polityId = polityId;
  return connected;
}

function quotaByPolity(quotas: readonly PolityQuota[]): Map<string, PolityQuota> {
  return new Map(quotas.map((quota) => [quota.polityId, quota] as const));
}

function territoryTurnOrder(
  quotas: readonly PolityQuota[],
  counts: ReadonlyMap<string, number>,
): PolityQuota[] {
  return quotas
    .filter((quota) => (counts.get(quota.polityId) ?? 0) < quota.targetCells)
    .toSorted(
      (left, right) =>
        (counts.get(left.polityId) ?? 0) / left.targetCells -
          (counts.get(right.polityId) ?? 0) / right.targetCells ||
        left.polityId.localeCompare(right.polityId),
    );
}

function boundaryDonorCandidates(
  cells: readonly WorldMapCell[],
  targetPolityId: string,
  counts: ReadonlyMap<string, number>,
  quotas: ReadonlyMap<string, PolityQuota>,
  capitalIndices: ReadonlySet<number>,
): number[] {
  const candidates: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell === undefined || cell.polityId === null || capitalIndices.has(index)) continue;
    const donorQuota = quotas.get(cell.polityId);
    if ((counts.get(cell.polityId) ?? 0) <= (donorQuota?.targetCells ?? 0)) continue;
    const touchesTarget = fourNeighborIndices(index).some(
      (neighbor) => cells[neighbor]?.polityId === targetPolityId,
    );
    if (touchesTarget) candidates.push(index);
  }
  return candidates.toSorted(
    (left, right) =>
      WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS[cells[left]?.terrain ?? "sea"] -
        WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS[cells[right]?.terrain ?? "sea"] || left - right,
  );
}

function repairEnclosedTerritory(
  rng: Rng,
  cells: WorldMapCell[],
  polityId: string,
  counts: Map<string, number>,
  quotas: ReadonlyMap<string, PolityQuota>,
  capitalIndices: ReadonlySet<number>,
  frontiers: TerritoryFrontiers,
): boolean {
  let candidates = boundaryDonorCandidates(cells, polityId, counts, quotas, capitalIndices);
  if (candidates.length === 0) {
    prepareOverQuotaDonor(rng, cells, polityId, counts, quotas, capitalIndices, frontiers);
    candidates = boundaryDonorCandidates(cells, polityId, counts, quotas, capitalIndices);
  }
  for (const index of candidates) {
    if (transferBoundaryCell(cells, index, polityId, counts, frontiers)) return true;
  }
  return false;
}

function transferBoundaryCell(
  cells: WorldMapCell[],
  index: number,
  targetId: string,
  counts: Map<string, number>,
  frontiers: TerritoryFrontiers,
): boolean {
  const donorId = cells[index]?.polityId;
  if (donorId === null || donorId === undefined) return false;
  if (!remainsConnectedAfterRemoval(cells, donorId, index)) return false;
  const cell = cells[index];
  if (cell === undefined) return false;
  cell.polityId = targetId;
  removeFromFrontiers(frontiers, index);
  refreshAdjacentFrontier(cells, frontiers, donorId, index);
  addUnclaimedNeighbors(cells, frontiers, targetId, index);
  counts.set(donorId, (counts.get(donorId) ?? 0) - 1);
  counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  return true;
}

function adjacentDonorIds(cells: readonly WorldMapCell[], polityId: string): string[] {
  const donors = new Set<string>();
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]?.polityId !== polityId) continue;
    for (const neighbor of fourNeighborIndices(index)) {
      const neighborPolityId = cells[neighbor]?.polityId;
      if (
        neighborPolityId !== null &&
        neighborPolityId !== undefined &&
        neighborPolityId !== polityId
      ) {
        donors.add(neighborPolityId);
      }
    }
  }
  return [...donors].toSorted();
}

function donorHasTransferCell(
  cells: WorldMapCell[],
  donorId: string,
  targetId: string,
  capitalIndices: ReadonlySet<number>,
): boolean {
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]?.polityId !== donorId || capitalIndices.has(index)) continue;
    const touchesTarget = fourNeighborIndices(index).some(
      (neighbor) => cells[neighbor]?.polityId === targetId,
    );
    if (touchesTarget && remainsConnectedAfterRemoval(cells, donorId, index)) return true;
  }
  return false;
}

function prepareOverQuotaDonor(
  rng: Rng,
  cells: WorldMapCell[],
  targetId: string,
  counts: Map<string, number>,
  quotas: ReadonlyMap<string, PolityQuota>,
  capitalIndices: ReadonlySet<number>,
  frontiers: TerritoryFrontiers,
): boolean {
  for (const donorId of adjacentDonorIds(cells, targetId)) {
    const quota = quotas.get(donorId);
    if (quota === undefined) continue;
    if (!donorHasTransferCell(cells, donorId, targetId, capitalIndices)) continue;
    if (growDonorPastQuota(rng, cells, donorId, counts, quota.targetCells, frontiers)) return true;
  }
  return false;
}

function growDonorPastQuota(
  rng: Rng,
  cells: WorldMapCell[],
  donorId: string,
  counts: Map<string, number>,
  targetCells: number,
  frontiers: TerritoryFrontiers,
): boolean {
  while ((counts.get(donorId) ?? 0) <= targetCells) {
    const candidates = orderedFrontierCandidates(frontiers, donorId);
    if (candidates.length === 0) return false;
    const selected = weightedCandidate(rng, cells, candidates);
    claimTerritoryCell(cells, frontiers, donorId, selected);
    counts.set(donorId, (counts.get(donorId) ?? 0) + 1);
  }
  return true;
}

function growTerritoryTurn(
  rng: Rng,
  cells: WorldMapCell[],
  quota: PolityQuota,
  counts: Map<string, number>,
  quotas: ReadonlyMap<string, PolityQuota>,
  capitalIndices: ReadonlySet<number>,
  frontiers: TerritoryFrontiers,
): void {
  const candidates = orderedFrontierCandidates(frontiers, quota.polityId);
  if (candidates.length === 0) {
    if (
      repairEnclosedTerritory(rng, cells, quota.polityId, counts, quotas, capitalIndices, frontiers)
    ) {
      return;
    }
    throw new Error(`world map cannot fill territory quota for ${quota.polityId}`);
  }
  const selected = weightedCandidate(rng, cells, candidates);
  claimTerritoryCell(cells, frontiers, quota.polityId, selected);
  counts.set(quota.polityId, (counts.get(quota.polityId) ?? 0) + 1);
}

function growTerritories(
  rng: Rng,
  cells: WorldMapCell[],
  quotas: readonly PolityQuota[],
  capitals: readonly CapitalSeed[],
): void {
  const counts = countTerritories(cells);
  const quotasById = quotaByPolity(quotas);
  const capitalIndices = new Set(capitals.map(({ pos }) => indexOf(pos)));
  const frontiers = createTerritoryFrontiers(cells, quotas);
  while (true) {
    const order = territoryTurnOrder(quotas, counts);
    const quota = order[0];
    if (quota === undefined) return;
    growTerritoryTurn(rng, cells, quota, counts, quotasById, capitalIndices, frontiers);
  }
}

function populationDeltasForWar(
  event: HistoryEvent,
  participants: readonly [string, string],
): [number, number] | null {
  const left = populationDeltaForEvent(event, participants[0]);
  const right = populationDeltaForEvent(event, participants[1]);
  return left === null || right === null ? null : [left, right];
}

function populationDeltaForEvent(event: HistoryEvent, polityId: string): number | null {
  let delta = 0;
  let found = false;
  for (const effect of event.effects) {
    if (effect.kind !== "population" || effect.targetId !== polityId) continue;
    delta += effect.delta;
    found = true;
  }
  return found ? delta : null;
}

function warParticipants(
  event: HistoryEvent,
  polityIds: ReadonlySet<string>,
): [string, string] | null {
  const [left, right] = event.polityIds;
  if (
    event.kind !== "war" ||
    event.polityIds.length !== 2 ||
    left === undefined ||
    right === undefined ||
    left === right ||
    !polityIds.has(left) ||
    !polityIds.has(right)
  ) {
    return null;
  }
  return [left, right];
}

function warSides(
  rng: Rng,
  participants: readonly [string, string],
  deltas: readonly [number, number],
): { winnerId: string; loserId: string } {
  let winnerIndex: number;
  if (deltas[0] === deltas[1]) {
    winnerIndex = randomIndex(rng, participants.length);
  } else {
    winnerIndex = deltas[0] > deltas[1] ? 0 : 1;
  }
  const loserIndex = winnerIndex === 0 ? 1 : 0;
  const winnerId = winnerIndex === 0 ? participants[0] : participants[1];
  const loserId = loserIndex === 0 ? participants[0] : participants[1];
  return {
    winnerId,
    loserId,
  };
}

function preservesPopulationOrder(
  polities: readonly Polity[],
  populations: ReadonlyMap<string, number>,
  counts: ReadonlyMap<string, number>,
): boolean {
  return polities.every((left) =>
    polities.every((right) => preservesPopulationPair(left, right, populations, counts)),
  );
}

function preservesPopulationPair(
  left: Polity,
  right: Polity,
  populations: ReadonlyMap<string, number>,
  counts: ReadonlyMap<string, number>,
): boolean {
  const leftPopulation = populations.get(left.id) ?? 0;
  const rightPopulation = populations.get(right.id) ?? 0;
  return (
    leftPopulation <= rightPopulation || (counts.get(left.id) ?? 0) >= (counts.get(right.id) ?? 0)
  );
}

function transferredCounts(
  counts: ReadonlyMap<string, number>,
  formerPolityId: string,
  currentPolityId: string,
): Map<string, number> {
  const transferred = new Map(counts);
  transferred.set(formerPolityId, (transferred.get(formerPolityId) ?? 0) - 1);
  transferred.set(currentPolityId, (transferred.get(currentPolityId) ?? 0) + 1);
  return transferred;
}

function loserBorderCandidates(
  cells: readonly WorldMapCell[],
  loserId: string,
  winnerId: string,
  excluded: ReadonlySet<number>,
): number[] {
  const candidates: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]?.polityId !== loserId || excluded.has(index)) continue;
    const touchesWinner = fourNeighborIndices(index).some(
      (neighbor) => cells[neighbor]?.polityId === winnerId,
    );
    if (touchesWinner) candidates.push(index);
  }
  return candidates;
}

function applyOneWar(
  event: HistoryEvent,
  sides: { winnerId: string; loserId: string },
  cells: WorldMapCell[],
  capitals: ReadonlySet<number>,
  populations: ReadonlyMap<string, number>,
  polities: readonly Polity[],
  protectedCells: Set<number>,
): WorldBorderChange[] {
  const changes: WorldBorderChange[] = [];
  const considered = new Set<number>(protectedCells);
  let counts = countTerritories(cells);
  while (changes.length < WORLD_MAP_WAR_BORDER_CELLS_PER_EVENT) {
    const candidates = loserBorderCandidates(cells, sides.loserId, sides.winnerId, considered);
    const index = candidates[0];
    if (index === undefined) break;
    considered.add(index);
    if (capitals.has(index) || !remainsConnectedAfterRemoval(cells, sides.loserId, index)) {
      continue;
    }
    const nextCounts = transferredCounts(counts, sides.loserId, sides.winnerId);
    if (!preservesPopulationOrder(polities, populations, nextCounts)) continue;
    const cell = cells[index];
    if (cell === undefined) throw new Error("world map war border cell is missing");
    cell.polityId = sides.winnerId;
    counts = nextCounts;
    protectedCells.add(index);
    changes.push({
      id: `border-${event.id}-${changes.length + 1}`,
      pos: positionOf(index),
      formerPolityId: sides.loserId,
      currentPolityId: sides.winnerId,
      establishedByEventId: event.id,
    });
  }
  return changes;
}

function applyWars(
  rng: Rng,
  history: WorldMapHistory,
  cells: WorldMapCell[],
  capitals: readonly CapitalSeed[],
  populations: ReadonlyMap<string, number>,
): WorldBorderChange[] {
  const polityIds = new Set(history.polities.map(({ id }) => id));
  const capitalIndices = new Set(capitals.map(({ pos }) => indexOf(pos)));
  const protectedCells = new Set<number>();
  const changes: WorldBorderChange[] = [];
  const wars = history.events
    .filter(({ kind }) => kind === "war")
    .toSorted((left, right) => left.year - right.year || left.id.localeCompare(right.id));
  for (const event of wars) {
    const participants = warParticipants(event, polityIds);
    if (participants === null) continue;
    const deltas = populationDeltasForWar(event, participants);
    if (deltas === null) continue;
    const sides = warSides(rng, participants, deltas);
    changes.push(
      ...applyOneWar(
        event,
        sides,
        cells,
        capitalIndices,
        populations,
        history.polities,
        protectedCells,
      ),
    );
  }
  return changes;
}

function unclaimedHomelandFrontier(cells: readonly WorldMapCell[], homelandId: string): number[] {
  const candidates: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell === undefined) continue;
    if (cell.terrain === "sea" || cell.polityId !== null) continue;
    const touchesHomeland = fourNeighborIndices(index).some(
      (neighbor) => cells[neighbor]?.polityId === homelandId,
    );
    if (touchesHomeland) candidates.push(index);
  }
  return candidates;
}

function homelandBoundaryCandidates(
  cells: readonly WorldMapCell[],
  homelandId: string,
  capitals: ReadonlySet<number>,
  protectedCells: ReadonlySet<number>,
): number[] {
  const candidates: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]?.polityId !== homelandId || capitals.has(index) || protectedCells.has(index)) {
      continue;
    }
    const boundary = fourNeighborIndices(index).some(
      (neighbor) => cells[neighbor]?.polityId !== homelandId,
    );
    if (boundary) candidates.push(index);
  }
  return candidates.toSorted(
    (left, right) =>
      WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS[cells[left]?.terrain ?? "sea"] -
        WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS[cells[right]?.terrain ?? "sea"] || left - right,
  );
}

function releaseFrontierCell(
  history: WorldMapHistory,
  cells: WorldMapCell[],
  capitals: readonly CapitalSeed[],
  borderChanges: readonly WorldBorderChange[],
  populations: ReadonlyMap<string, number>,
  homelandId: string,
): number {
  const capitalIndices = new Set(capitals.map(({ pos }) => indexOf(pos)));
  const protectedCells = new Set(borderChanges.map(({ pos }) => indexOf(pos)));
  const candidates = homelandBoundaryCandidates(cells, homelandId, capitalIndices, protectedCells);
  const counts = countTerritories(cells);
  for (const index of candidates) {
    if (!remainsConnectedAfterRemoval(cells, homelandId, index)) continue;
    const nextCounts = new Map(counts);
    nextCounts.set(homelandId, (nextCounts.get(homelandId) ?? 0) - 1);
    if (!preservesPopulationOrder(history.polities, populations, nextCounts)) continue;
    const cell = cells[index];
    if (cell === undefined) continue;
    cell.polityId = null;
    const retainsNeighbor = fourNeighborIndices(index).some(
      (neighbor) => cells[neighbor]?.polityId === homelandId,
    );
    if (retainsNeighbor) return index;
    cell.polityId = homelandId;
  }
  throw new Error("world map cannot reserve a homeland frontier");
}

function reserveSettlementFrontier(
  rng: Rng,
  history: WorldMapHistory,
  cells: WorldMapCell[],
  capitals: readonly CapitalSeed[],
  borderChanges: readonly WorldBorderChange[],
  populations: ReadonlyMap<string, number>,
): Position {
  const origin = history.settlementOrigin;
  if (origin === null) throw new Error("world map generation requires a settlement origin");
  if (!history.polities.some(({ id }) => id === origin.homelandPolityId)) {
    throw new Error("world map settlement homeland does not resolve");
  }
  const candidates = unclaimedHomelandFrontier(cells, origin.homelandPolityId).toSorted(
    (left, right) => left - right,
  );
  if (candidates.length > 0)
    return positionOf(candidates[randomIndex(rng, candidates.length)] ?? -1);
  return positionOf(
    releaseFrontierCell(
      history,
      cells,
      capitals,
      borderChanges,
      populations,
      origin.homelandPolityId,
    ),
  );
}

function cityCountFor(
  population: number,
  minimumPopulation: number,
  maximumPopulation: number,
): number {
  if (minimumPopulation === maximumPopulation) return WORLD_MAP_CITY_COUNT_MIN;
  const range = WORLD_MAP_CITY_COUNT_MAX - WORLD_MAP_CITY_COUNT_MIN;
  const normalized = (population - minimumPopulation) / (maximumPopulation - minimumPopulation);
  return Math.max(
    WORLD_MAP_CITY_COUNT_MIN,
    Math.min(WORLD_MAP_CITY_COUNT_MAX, Math.round(WORLD_MAP_CITY_COUNT_MIN + normalized * range)),
  );
}

function compareRecentEvents(left: HistoryEvent, right: HistoryEvent): number {
  if (left.year !== right.year) return right.year - left.year;
  return right.id.localeCompare(left.id);
}

function hasPopulationEffect(event: HistoryEvent, polityId: string): boolean {
  return event.effects.some(
    (effect) => effect.kind === "population" && effect.targetId === polityId,
  );
}

function hasPositivePopulationEffect(event: HistoryEvent, polityId: string): boolean {
  return event.effects.some(
    (effect) => effect.kind === "population" && effect.targetId === polityId && effect.delta > 0,
  );
}

function secondaryCitySources(
  history: WorldMapHistory,
  polityId: string,
  founding: HistoryEvent,
): HistoryEvent[] {
  const candidates = history.events.filter(({ id }) => id !== founding.id);
  const positive = candidates
    .filter((event) => hasPositivePopulationEffect(event, polityId))
    .toSorted(compareRecentEvents);
  const selected = new Set(positive.map(({ id }) => id));
  const remaining = candidates
    .filter((event) => hasPopulationEffect(event, polityId) && !selected.has(event.id))
    .toSorted(compareRecentEvents);
  return [...positive, ...remaining, founding];
}

function orderedSecondaryCityCandidates(
  rng: Rng,
  cells: readonly WorldMapCell[],
  polityId: string,
  occupied: ReadonlySet<number>,
): number[] {
  const preferred: number[] = [];
  const remaining: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell?.polityId !== polityId || occupied.has(index)) continue;
    if (cell.terrain === "plains" || cell.terrain === "forest") preferred.push(index);
    else remaining.push(index);
  }
  return [
    ...shuffled(
      rng,
      preferred.toSorted((left, right) => left - right),
    ),
    ...shuffled(
      rng,
      remaining.toSorted((left, right) => left - right),
    ),
  ];
}

function secondaryCityIndex(candidates: readonly number[], existing: readonly WorldCity[]): number {
  for (let distance = WORLD_MAP_CITY_MIN_DISTANCE; distance >= 0; distance -= 1) {
    const index = candidates.find((candidate) =>
      existing.every((city) => manhattanDistance(positionOf(candidate), city.pos) >= distance),
    );
    if (index !== undefined) return index;
  }
  throw new Error("world map cannot place a secondary city");
}

function cityPositionForSlot(
  rng: Rng,
  cells: readonly WorldMapCell[],
  polityId: string,
  slot: number,
  capital: CapitalSeed,
  occupied: ReadonlySet<number>,
  polityCities: readonly WorldCity[],
): Position {
  if (slot === 0) return capital.pos;
  return positionOf(
    secondaryCityIndex(
      orderedSecondaryCityCandidates(rng, cells, polityId, occupied),
      polityCities,
    ),
  );
}

function sourceForCitySlot(
  slot: number,
  founding: HistoryEvent,
  sources: readonly HistoryEvent[],
): HistoryEvent {
  if (slot === 0) return founding;
  return sources[slot - 1] ?? founding;
}

function createPolityCities(
  rng: Rng,
  cells: readonly WorldMapCell[],
  polity: Polity,
  capital: CapitalSeed,
  count: number,
  founding: HistoryEvent,
  occupied: Set<number>,
  sources: readonly HistoryEvent[],
): WorldCity[] {
  const cities: WorldCity[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const pos = cityPositionForSlot(rng, cells, polity.id, slot, capital, occupied, cities);
    const suffix = WORLD_CITY_NAME_SUFFIXES[slot];
    if (suffix === undefined) throw new Error("world map city suffix is missing");
    const city: WorldCity = {
      id: `city-${polity.id}-${slot + 1}`,
      name: `${polity.adjective}${suffix}`,
      pos,
      polityId: polity.id,
      isCapital: slot === 0,
      foundedByEventId: sourceForCitySlot(slot, founding, sources).id,
    };
    cities.push(city);
    occupied.add(indexOf(pos));
  }
  return cities;
}

function createCities(
  rng: Rng,
  history: WorldMapHistory,
  cells: readonly WorldMapCell[],
  capitals: readonly CapitalSeed[],
  populations: ReadonlyMap<string, number>,
): WorldCity[] {
  const populationValues = [...populations.values()];
  const minimumPopulation = Math.min(...populationValues);
  const maximumPopulation = Math.max(...populationValues);
  const capitalsByPolity = new Map(capitals.map((capital) => [capital.polityId, capital] as const));
  const cities: WorldCity[] = [];
  const occupied = new Set<number>();
  for (const polity of history.polities) {
    const capital = capitalsByPolity.get(polity.id);
    if (capital === undefined) throw new Error(`world map polity ${polity.id} has no capital`);
    const founding = foundingEventFor(history, polity.id);
    const count = cityCountFor(
      populations.get(polity.id) ?? 0,
      minimumPopulation,
      maximumPopulation,
    );
    const sources = secondaryCitySources(history, polity.id, founding);
    cities.push(
      ...createPolityCities(rng, cells, polity, capital, count, founding, occupied, sources),
    );
  }
  return cities;
}

function closestCityPair(
  leftCities: readonly WorldCity[],
  rightCities: readonly WorldCity[],
): [WorldCity, WorldCity] {
  const pairs = leftCities.flatMap((left) => rightCities.map((right) => [left, right] as const));
  const closest = pairs.toSorted(
    ([leftA, rightA], [leftB, rightB]) =>
      manhattanDistance(leftA.pos, rightA.pos) - manhattanDistance(leftB.pos, rightB.pos) ||
      leftA.id.localeCompare(leftB.id) ||
      rightA.id.localeCompare(rightB.id),
  )[0];
  if (closest === undefined) throw new Error("world map trade route requires two cities");
  return [closest[0], closest[1]];
}

function createTradeRoutes(
  history: WorldMapHistory,
  cities: readonly WorldCity[],
): WorldTradeRoute[] {
  const polityIds = new Set(history.polities.map(({ id }) => id));
  return history.events.flatMap((event) => {
    const [leftId, rightId] = event.polityIds;
    if (
      event.kind !== "trade" ||
      event.polityIds.length !== 2 ||
      leftId === undefined ||
      rightId === undefined ||
      leftId === rightId ||
      !polityIds.has(leftId) ||
      !polityIds.has(rightId)
    ) {
      return [];
    }
    const pair = closestCityPair(
      cities.filter(({ polityId }) => polityId === leftId),
      cities.filter(({ polityId }) => polityId === rightId),
    );
    return [
      {
        id: `route-${event.id}`,
        cityIds: [pair[0].id, pair[1].id],
        establishedByEventId: event.id,
      },
    ];
  });
}

function assertGrid(map: WorldMap, polityIds: ReadonlySet<string>): void {
  if (
    map.width !== WORLD_MAP_WIDTH ||
    map.height !== WORLD_MAP_HEIGHT ||
    map.cells.length !== WORLD_MAP_CELL_COUNT
  ) {
    throw new Error("world map grid does not match the frozen contract");
  }
  for (const cell of map.cells) {
    if (cell.terrain === "sea" && cell.polityId !== null) {
      throw new Error("world map sea cannot be owned");
    }
    if (cell.polityId !== null && !polityIds.has(cell.polityId)) {
      throw new Error("world map cell polity does not resolve");
    }
  }
}

function assertCity(
  city: WorldCity,
  map: WorldMap,
  eventsById: ReadonlyMap<string, HistoryEvent>,
  polityIds: ReadonlySet<string>,
): void {
  const event = eventsById.get(city.foundedByEventId);
  if (
    !polityIds.has(city.polityId) ||
    map.cells[indexOf(city.pos)]?.polityId !== city.polityId ||
    /[A-Za-z]/.test(city.name) ||
    event === undefined
  ) {
    throw new Error(`world map city ${city.id} violates its causal contract`);
  }
  if (
    city.isCapital &&
    (event.kind !== "founding" ||
      event.polityIds.length !== 1 ||
      event.polityIds[0] !== city.polityId)
  ) {
    throw new Error(`world map capital ${city.id} requires its polity founding event`);
  }
}

function assertCities(
  map: WorldMap,
  history: WorldMapHistory,
  eventsById: ReadonlyMap<string, HistoryEvent>,
  polityIds: ReadonlySet<string>,
): void {
  for (const city of map.cities) assertCity(city, map, eventsById, polityIds);
  for (const polity of history.polities) {
    const cities = map.cities.filter(({ polityId }) => polityId === polity.id);
    const capitals = cities.filter(({ isCapital }) => isCapital);
    if (
      cities.length < WORLD_MAP_CITY_COUNT_MIN ||
      cities.length > WORLD_MAP_CITY_COUNT_MAX ||
      capitals.length !== 1
    ) {
      throw new Error(`world map polity ${polity.id} has an invalid city set`);
    }
  }
}

function assertTradeRoute(
  route: WorldTradeRoute,
  eventsById: ReadonlyMap<string, HistoryEvent>,
  citiesById: ReadonlyMap<string, WorldCity>,
): void {
  const event = eventsById.get(route.establishedByEventId);
  const left = citiesById.get(route.cityIds[0]);
  const right = citiesById.get(route.cityIds[1]);
  if (
    event?.kind !== "trade" ||
    event.polityIds.length !== 2 ||
    left === undefined ||
    right === undefined ||
    left.polityId !== event.polityIds[0] ||
    right.polityId !== event.polityIds[1]
  ) {
    throw new Error(`world map route ${route.id} violates its causal contract`);
  }
}

function assertBorderChange(
  change: WorldBorderChange,
  map: WorldMap,
  eventsById: ReadonlyMap<string, HistoryEvent>,
): void {
  const event = eventsById.get(change.establishedByEventId);
  if (
    event?.kind !== "war" ||
    !event.polityIds.includes(change.formerPolityId) ||
    !event.polityIds.includes(change.currentPolityId) ||
    map.cells[indexOf(change.pos)]?.polityId !== change.currentPolityId
  ) {
    throw new Error(`world map border ${change.id} violates its causal contract`);
  }
}

function assertSettlementFrontier(map: WorldMap, homelandId: string): void {
  const index = indexOf(map.settlementFrontierPos);
  const cell = map.cells[index];
  const adjacent = fourNeighborIndices(index).some(
    (neighbor) => map.cells[neighbor]?.polityId === homelandId,
  );
  if (!inBounds(map.settlementFrontierPos) || cell?.terrain === "sea" || cell?.polityId !== null) {
    throw new Error("world map settlement frontier must be unclaimed land");
  }
  if (!adjacent) throw new Error("world map settlement frontier must touch its homeland");
}

function assertUniqueIds(map: WorldMap): void {
  const ids = [
    ...map.cities.map(({ id }) => id),
    ...map.tradeRoutes.map(({ id }) => id),
    ...map.borderChanges.map(({ id }) => id),
  ];
  if (new Set(ids).size !== ids.length) throw new Error("world map entity IDs must be unique");
}

function assertTerritories(
  map: WorldMap,
  history: WorldMapHistory,
  populations: ReadonlyMap<string, number>,
): void {
  const counts = countTerritories(map.cells);
  if (!preservesPopulationOrder(history.polities, populations, counts)) {
    throw new Error("world map territory counts invert polity population order");
  }
  for (const polity of history.polities) {
    const owned = ownedIndices(map.cells, polity.id);
    if (
      owned.length === 0 ||
      connectedIndices(map.cells, polity.id, owned[0] ?? -1).size !== owned.length
    ) {
      throw new Error(`world map polity ${polity.id} territory must be contiguous`);
    }
    foundingEventFor(history, polity.id);
  }
}

function assertWorldMap(
  map: WorldMap,
  history: WorldMapHistory,
  populations: ReadonlyMap<string, number>,
): void {
  const polityIds = new Set(history.polities.map(({ id }) => id));
  const eventsById = new Map(history.events.map((event) => [event.id, event] as const));
  const citiesById = new Map(map.cities.map((city) => [city.id, city] as const));
  assertGrid(map, polityIds);
  assertCities(map, history, eventsById, polityIds);
  for (const route of map.tradeRoutes) assertTradeRoute(route, eventsById, citiesById);
  for (const change of map.borderChanges) assertBorderChange(change, map, eventsById);
  const homelandId = history.settlementOrigin?.homelandPolityId;
  if (homelandId === undefined) throw new Error("world map requires a settlement homeland");
  assertSettlementFrontier(map, homelandId);
  assertTerritories(map, history, populations);
  assertUniqueIds(map);
}

export function generateWorldMap(seed: number, history: WorldMapHistory): WorldMap {
  const rng = createRng(seed ^ WORLD_MAP_RNG_SALT);
  const cells = createTerrain(rng);
  const land = keepLargestLandmass(cells);
  const populations = populationIndex(history);
  const quotas = createQuotas(history, land.length);
  const capitals = placeCapitals(rng, history, cells);
  growTerritories(rng, cells, quotas, capitals);
  const borderChanges = applyWars(rng, history, cells, capitals, populations);
  const settlementFrontierPos = reserveSettlementFrontier(
    rng,
    history,
    cells,
    capitals,
    borderChanges,
    populations,
  );
  const cities = createCities(rng, history, cells, capitals, populations);
  const tradeRoutes = createTradeRoutes(history, cities);
  const map: WorldMap = {
    width: WORLD_MAP_WIDTH,
    height: WORLD_MAP_HEIGHT,
    cells,
    cities,
    tradeRoutes,
    borderChanges,
    settlementFrontierPos,
  };
  assertWorldMap(map, history, populations);
  return map;
}
