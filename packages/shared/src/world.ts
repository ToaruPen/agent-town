import type { WorldHistory } from "./history.js";
import type { AgentDesires, Collective, Institution } from "./society.js";
import type { Facility, FacilityKind, SpatialDemand, TrailCell } from "./spatial.js";

export type Terrain = "plains" | "forest" | "water" | "rock";
export type ResourceKind = "wood" | "food";
export type PlanSource = "fake" | "llm";
export type LlmProvider = "claude" | "codex";

export interface Tile {
  terrain: Terrain;
  /** Remaining harvestable amount; only > 0 on forest (wood) or plains berry tiles (food). */
  resource: { kind: ResourceKind; amount: number } | null;
  /** Original renewable resource kind; remains present after the resource is depleted. */
  readonly resourceOrigin?: ResourceKind;
}

export interface Position {
  x: number;
  y: number;
}

export type AgentActivity =
  | { kind: "idle" }
  | { kind: "moving"; path: Position[]; ticksIntoStep: number }
  | { kind: "gathering"; target: Position; ticksRemaining: number }
  | { kind: "eating"; ticksRemaining: number }
  | { kind: "foraging"; target: Position; ticksRemaining: number }
  | { kind: "building"; target: Position }
  | { kind: "maintaining"; facilityId: string }
  | { kind: "resting"; target: Position }
  | { kind: "depositing" };

export interface AgentState {
  id: string;
  name: string;
  pos: Position;
  carrying: { kind: ResourceKind; amount: number } | null;
  activity: AgentActivity;
  /** Current task queue, head = active. */
  tasks: AgentTask[];
  planSource: PlanSource;
  llmProvider: LlmProvider | null;
  thinking: boolean;
  lastThought: string | null;
  desires: AgentDesires;
  lastHungerInterruptTick: number | null;
  hunger: number;
  fatigue: number;
  health: number;
  rationStrain: number;
  lastRationTick: number | null;
}

export type AgentTask =
  | { kind: "moveTo"; dest: Position }
  | { kind: "gather"; resource: ResourceKind; target: Position }
  | { kind: "eat" }
  | { kind: "forage"; target: Position }
  | { kind: "build"; pos: Position }
  | { kind: "till"; pos: Position }
  | { kind: "sow"; pos: Position }
  | { kind: "harvest"; pos: Position }
  | { kind: "transferToFacility"; facilityId: string; resource: ResourceKind }
  | { kind: "buildFacility"; facilityId: string }
  | { kind: "maintainFacility"; facilityId: string }
  | { kind: "rest" }
  | { kind: "deposit" };

export interface House {
  kind: "house";
  pos: Position;
  progress: number;
  complete: boolean;
}

export type CropStage = "fallow" | "sown" | "growing" | "ripe";

export interface Field {
  kind: "field";
  pos: Position;
  progress: number;
  complete: boolean;
  stage: CropStage;
}

export type Building = House | Facility | Field;

export function isHouse(building: Building): building is House {
  return building.kind === "house";
}

export function isField(building: Building): building is Field {
  return building.kind === "field";
}

const FACILITY_KINDS = {
  communalGranary: true,
  grainMarket: true,
  rationDepot: true,
} as const satisfies Readonly<Record<FacilityKind, true>>;

export function isFacility(building: Building): building is Facility {
  return Object.hasOwn(FACILITY_KINDS, building.kind);
}

export interface WorldState {
  tick: number;
  width: number;
  height: number;
  tiles: Tile[]; // row-major, index = y * width + x
  agents: AgentState[];
  stockpile: { pos: Position; wood: number; food: number };
  buildings: Building[];
  deaths: { name: string; tick: number; cause: "starvation" | "cold" }[];
  collectives: Collective[];
  institutions: Institution[];
  spatialDemands: SpatialDemand[];
  /** Row-major, index = y * width + x; always width * height entries. */
  trailCells: TrailCell[];
  history: WorldHistory;
}
