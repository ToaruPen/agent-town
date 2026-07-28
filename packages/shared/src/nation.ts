import type { SEASONS } from "./constants.js";
import type { WorldHistory } from "./history.js";

export type NationId = string; // equals Polity.id
export type DirectiveId = string;
export type Season = (typeof SEASONS)[number];
type NationController = "player" | "agent";
export type SpeedMultiplier = 0 | 1 | 2 | 4 | 8; // 0 = paused

export interface NationStocks {
  food: number;
  materials: number;
  wealth: number;
}

export type DirectiveKind =
  | "clearFarmland"
  | "developTimber"
  | "openMine"
  | "growCity"
  | "encourageStores"
  | "holdFestival";

export type DirectiveBlockedReason =
  | "insufficientFood"
  | "insufficientMaterials"
  | "insufficientWealth"
  | "missingTerrain"
  | "cityAtMaxDevelopment"
  | "taboo"
  | "alreadyActive";

export interface DirectiveOption {
  kind: DirectiveKind;
  targetCityId: string | null;
  cost: NationStocks;
  seasons: number;
  /** Fit with the nation's cultural values, -1..1. Feeds stability and chancellor scoring. */
  affinity: number;
  blockedReason: DirectiveBlockedReason | null;
}

export interface ActiveDirective {
  id: DirectiveId;
  kind: DirectiveKind;
  targetCityId: string | null;
  issuedAtTick: number;
  seasonsRemaining: number;
  totalSeasons: number; // so progress is self-describing without the candidate list
}

export interface NationCityState {
  cityId: string; // WorldCity.id
  population: number;
  developmentLevel: number;
}

export type SeasonMetric = "food" | "materials" | "wealth" | "population" | "stability" | "culture";

export type SeasonLedgerReason =
  | "baseProduction"
  | "tradeIncome"
  | "directiveEffect"
  | "directiveCost"
  | "directiveUpkeep"
  | "populationConsumption"
  | "famine"
  | "growth"
  | "stabilityDrift"
  | "cultureAffinity";

export interface SeasonLedgerEntry {
  metric: SeasonMetric;
  delta: number;
  reason: SeasonLedgerReason;
  directiveId: DirectiveId | null;
}

export interface SeasonReport {
  year: number;
  season: Season;
  entries: SeasonLedgerEntry[];
  completedDirectiveIds: DirectiveId[];
}

export interface ProsperityScore {
  /** Each component is a 0..1 log ratio against the living field maximum. */
  population: number;
  production: number;
  wealth: number;
  stability: number;
  culture: number;
  /** Weighted total, 0..1000; 1000 means matching every positive field-component maximum. */
  total: number;
}

export interface NationState {
  id: NationId;
  controller: NationController;
  autoPilot: boolean;
  stocks: NationStocks;
  cities: NationCityState[];
  territoryCellCount: number;
  /** Strictly positive while this polity is present in a live-nation collection. */
  population: number;
  /** 0..100. */
  stability: number;
  culture: number;
  foodProduction: number;
  materialProduction: number;
  activeDirectives: ActiveDirective[];
  prosperity: ProsperityScore;
  lastReport: SeasonReport | null;
}

export interface NationWorldState {
  tick: number;
  year: number;
  season: Season;
  speed: SpeedMultiplier;
  history: WorldHistory; // unchanged contract, carries worldMap
  /** Living nations only. A zero-population polity remains in history but is absent here. */
  nations: NationState[];
  playerNationId: NationId | null;
}

export interface WorldCellChange {
  index: number;
  polityId: string | null;
}
