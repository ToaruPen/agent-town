import type { Provenance } from "./society.js";
import type { Position } from "./world.js";

export type FacilityKind = "communalGranary" | "grainMarket" | "rationDepot";

export type SpatialDemandSource =
  | { kind: "household"; id: string }
  | { kind: "livelihood"; id: string }
  | { kind: "institution"; id: string }
  | { kind: "faith"; id: string }
  | { kind: "externalPressure"; id: string };

export type SpatialDemandStatus =
  | "seekingSite"
  | "awaitingMaterials"
  | "building"
  | "fulfilled"
  | "blocked";

export type SiteFactor =
  | "foodAccess"
  | "residentAccess"
  | "stockpileAccess"
  | "existingTraffic"
  | "settlementEdgeAccess"
  | "openSpace"
  | "accessEquality";

export interface SiteContribution {
  factor: SiteFactor;
  value: number;
  weightedScore: number;
}

export interface SiteRationale {
  score: number;
  contributions: SiteContribution[];
}

export interface SpatialDemand {
  id: string;
  facilityKind: FacilityKind;
  source: SpatialDemandSource;
  supporterIds: string[];
  requiredWood: number;
  requiredLabor: number;
  status: SpatialDemandStatus;
  blockedReason: "noValidSite" | null;
  site: Position | null;
  siteRationale: SiteRationale | null;
  provenance: Provenance;
}

export type FacilityBlockedReason = "unreachable" | "full" | "noTradeRoute" | "maintenanceOverdue";

export interface FacilityDailyStats {
  visits: number;
  foodPreserved: number;
  foodImported: number;
  foodExported: number;
  woodSpent: number;
  woodReceived: number;
  rationMeals: number;
  maintenanceWork: number;
}

export interface Facility {
  kind: FacilityKind;
  id: string;
  demandId: string;
  institutionId: string;
  pos: Position;
  progress: number;
  complete: boolean;
  woodDelivered: number;
  inventory: { wood: number; food: number };
  operation: "inactive" | "active" | "blocked";
  blockedReason: FacilityBlockedReason | null;
  maintenanceDue: number;
  statsToday: FacilityDailyStats;
  lastUsedAtTick: number | null;
  lastTradeTick: number | null;
  siteRationale: SiteRationale;
  provenance: Provenance;
}

export type MovementPurpose =
  | "survival"
  | "gathering"
  | "construction"
  | "facilityService"
  | "wandering";

export type TrailLevel = "none" | "trace" | "trail" | "establishedTrail";

export interface TrailCell {
  wear: number;
  level: TrailLevel;
  passagesToday: number;
  purposeWear: Record<MovementPurpose, number>;
  dominantPurpose: MovementPurpose | null;
  facilityWear: Record<string, number>;
  causedByFacilityIds: string[];
  lastUsedAtTick: number | null;
}
