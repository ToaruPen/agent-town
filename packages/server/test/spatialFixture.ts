import {
  FACILITY_BUILD_TICKS,
  FACILITY_WOOD_COST,
  type Facility,
  type FacilityKind,
  type Position,
  type Provenance,
  type SpatialDemand,
} from "@agent-town/shared";

const FIXTURE_PROVENANCE: Provenance = {
  causedByEventIds: [],
  proposedByAgentIds: ["agent-1"],
  supportedByAgentIds: ["agent-1"],
  opposedByAgentIds: [],
  decidedAtTick: 10,
};

export function makeDemandFixture(
  kind: FacilityKind = "communalGranary",
  site: Position = { x: 2, y: 0 },
): SpatialDemand {
  return {
    id: `demand-institution-${kind}`,
    facilityKind: kind,
    source: { kind: "institution", id: `institution-${kind}` },
    supporterIds: ["agent-1"],
    requiredWood: FACILITY_WOOD_COST[kind],
    requiredLabor: FACILITY_BUILD_TICKS[kind],
    status: "awaitingMaterials",
    blockedReason: null,
    site,
    siteRationale: { score: 1, contributions: [] },
    provenance: FIXTURE_PROVENANCE,
  };
}

export function makeFacilityFixture(
  kind: FacilityKind = "communalGranary",
  pos: Position = { x: 2, y: 0 },
): Facility {
  return {
    kind,
    id: `facility-institution-${kind}`,
    demandId: `demand-institution-${kind}`,
    institutionId: `institution-${kind}`,
    pos,
    progress: 0,
    complete: false,
    woodDelivered: 0,
    inventory: { wood: 0, food: 0 },
    operation: "inactive",
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
    provenance: FIXTURE_PROVENANCE,
  };
}
