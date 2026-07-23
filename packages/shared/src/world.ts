import type { WorldHistory } from "./history.js";
import type { AgentDesires, Collective, Institution } from "./society.js";

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

// biome-ignore format: Preserve the contract's verbatim one-line declaration.
export interface Position { x: number; y: number }

export type AgentActivity =
  | { kind: "idle" }
  | { kind: "moving"; path: Position[]; ticksIntoStep: number }
  | { kind: "gathering"; target: Position; ticksRemaining: number }
  | { kind: "eating"; ticksRemaining: number }
  | { kind: "foraging"; target: Position; ticksRemaining: number }
  | { kind: "building"; target: Position }
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
}

export type AgentTask =
  | { kind: "moveTo"; dest: Position }
  | { kind: "gather"; resource: ResourceKind; target: Position }
  | { kind: "eat" }
  | { kind: "forage"; target: Position }
  | { kind: "build"; pos: Position }
  | { kind: "rest" }
  | { kind: "deposit" };

export interface House {
  kind: "house";
  pos: Position;
  progress: number;
  complete: boolean;
}

export interface WorldState {
  tick: number;
  width: number;
  height: number;
  tiles: Tile[]; // row-major, index = y * width + x
  agents: AgentState[];
  stockpile: { pos: Position; wood: number; food: number };
  buildings: House[];
  deaths: { name: string; tick: number; cause: "starvation" | "cold" }[];
  collectives: Collective[];
  institutions: Institution[];
  history: WorldHistory;
}
