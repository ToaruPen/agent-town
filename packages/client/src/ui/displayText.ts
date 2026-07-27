import type { AgentActivity, AgentTask, ResourceKind, Terrain } from "@agent-town/shared";

const ACTIVITY_LABELS: Record<AgentActivity["kind"], string> = {
  building: "建設中",
  depositing: "搬入中",
  eating: "食事中",
  foraging: "採食中",
  gathering: "採集中",
  idle: "待機中",
  maintaining: "施設維持中",
  moving: "移動中",
  resting: "休息中",
};

const TASK_LABELS: Record<AgentTask["kind"], string> = {
  build: "建設",
  buildFacility: "施設建設",
  deposit: "搬入",
  eat: "食事",
  forage: "採食",
  gather: "採集",
  maintainFacility: "施設維持",
  moveTo: "移動",
  rest: "休息",
  till: "開墾",
  transferToFacility: "施設へ搬入",
};

const RESOURCE_LABELS: Record<ResourceKind, string> = {
  food: "食料",
  wood: "木材",
};

const TERRAIN_LABELS: Record<Terrain, string> = {
  forest: "森",
  plains: "平原",
  rock: "岩場",
  water: "水辺",
};

export function activityLabel(kind: AgentActivity["kind"]): string {
  return ACTIVITY_LABELS[kind];
}

export function taskLabel(kind: AgentTask["kind"]): string {
  return TASK_LABELS[kind];
}

export function resourceLabel(kind: ResourceKind): string {
  return RESOURCE_LABELS[kind];
}

export function terrainLabel(terrain: Terrain): string {
  return TERRAIN_LABELS[terrain];
}
