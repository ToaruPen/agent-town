import type { Position } from "./world.js";
import type { WorldMap } from "./worldMap.js";

export type CulturalValue =
  | "commerce"
  | "faith"
  | "knowledge"
  | "kinship"
  | "mutualAid"
  | "order"
  | "stewardship"
  | "valor";

export interface CulturalValueWeight {
  value: CulturalValue;
  weight: number;
  changedByEventIds: string[];
}

export interface Polity {
  id: string;
  name: string;
  adjective: string;
  color: number;
  values: CulturalValueWeight[];
  foundingMyth: string;
  formativeTraumaEventIds: string[];
  taboo: string;
  ambition: string;
  governance: string;
}

export type HistoryEventKind = "anomaly" | "founding" | "migration" | "scarcity" | "trade" | "war";

export type LandmarkKind = "borderFort" | "ruin" | "standingStone";

export type HistoryEffect =
  | { kind: "culture"; targetId: string; value: CulturalValue; delta: number }
  | { kind: "landmark"; targetId: string; landmarkKind: LandmarkKind }
  | { kind: "population"; targetId: string; delta: number }
  | { kind: "relation"; targetId: string; otherPolityId: string; delta: number };

export interface HistoryEvent {
  id: string;
  year: number;
  kind: HistoryEventKind;
  title: string;
  summary: string;
  polityIds: string[];
  causeIds: string[];
  effects: HistoryEffect[];
}

export interface HistoricalLandmark {
  id: string;
  kind: LandmarkKind;
  name: string;
  pos: Position;
  polityId: string;
  foundedByEventId: string;
}

export interface SettlementOrigin {
  homelandPolityId: string;
  departureEventId: string;
  reason: string;
  inheritedValues: CulturalValue[];
}

export interface WorldHistory {
  startYear: number;
  currentYear: number;
  polities: Polity[];
  events: HistoryEvent[];
  landmarks: HistoricalLandmark[];
  settlementOrigin: SettlementOrigin | null;
  worldMap: WorldMap;
}
