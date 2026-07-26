import {
  FACILITY_BUILD_TICKS,
  FACILITY_WOOD_COST,
  type Facility,
  type FacilityKind,
  type Position,
  type TrailCell,
} from "@agent-town/shared";

export function makeTrailCellsFixture(width: number, height: number): TrailCell[] {
  return Array.from({ length: width * height }, () => ({
    wear: 0,
    level: "none" as const,
    passagesToday: 0,
    purposeWear: {
      survival: 0,
      gathering: 0,
      construction: 0,
      facilityService: 0,
      wandering: 0,
    },
    dominantPurpose: null,
    facilityWear: {},
    causedByFacilityIds: [],
    lastUsedAtTick: null,
  }));
}

/** A finished institution site, so a render test only has to state how it differs. */
export function makeFacilityFixture(kind: FacilityKind, pos: Position): Facility {
  return {
    kind,
    id: `facility-institution-${kind}`,
    demandId: `demand-institution-${kind}`,
    institutionId: `institution-${kind}`,
    pos,
    progress: FACILITY_BUILD_TICKS[kind],
    complete: true,
    woodDelivered: FACILITY_WOOD_COST[kind],
    inventory: { wood: 0, food: 0 },
    operation: "active",
    blockedReason: null,
    maintenanceDue: 0,
    statsToday: {
      visits: 0,
      foodPreserved: 0,
      foodImported: 0,
      foodExported: 0,
      woodSpent: 0,
      woodReceived: 0,
      rationMeals: 0,
      maintenanceWork: 0,
    },
    lastUsedAtTick: null,
    lastTradeTick: null,
    siteRationale: { score: 1, contributions: [] },
    provenance: {
      causedByEventIds: [],
      proposedByAgentIds: ["agent-1"],
      supportedByAgentIds: ["agent-1"],
      opposedByAgentIds: [],
      decidedAtTick: 10,
    },
  };
}
