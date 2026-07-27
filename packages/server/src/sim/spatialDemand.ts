import {
  FACILITY_BUILD_TICKS,
  FACILITY_KIND_BY_INSTITUTION,
  FACILITY_WOOD_COST,
  type Facility,
  INSTITUTION_KINDS,
  type Institution,
  type Position,
  type Provenance,
  type SiteRationale,
  SPATIAL_DEMAND_RETRY_INTERVAL_TICKS,
  type SpatialDemand,
  type WorldState,
} from "@agent-town/shared";

import { selectFacilitySite } from "./siteSelection.js";

function demandId(institutionId: string): string {
  return `demand-${institutionId}`;
}

function facilityId(institutionId: string): string {
  return `facility-${institutionId}`;
}

/** Provenance is the frozen record of why this happened, so never share its arrays. */
function copyProvenance(provenance: Provenance): Provenance {
  return {
    causedByEventIds: [...provenance.causedByEventIds],
    proposedByAgentIds: [...provenance.proposedByAgentIds],
    supportedByAgentIds: [...provenance.supportedByAgentIds],
    opposedByAgentIds: [...provenance.opposedByAgentIds],
    decidedAtTick: provenance.decidedAtTick,
  };
}

function createDemand(institution: Institution): SpatialDemand {
  const facilityKind = FACILITY_KIND_BY_INSTITUTION[institution.kind];
  return {
    id: demandId(institution.id),
    facilityKind,
    source: { kind: "institution", id: institution.id },
    supporterIds: [...institution.supporterIds],
    requiredWood: FACILITY_WOOD_COST[facilityKind],
    requiredLabor: FACILITY_BUILD_TICKS[facilityKind],
    status: "seekingSite",
    blockedReason: null,
    site: null,
    siteRationale: null,
    provenance: copyProvenance(institution.provenance),
  };
}

function createFacility(
  institution: Institution,
  demand: SpatialDemand,
  pos: Position,
  siteRationale: SiteRationale,
): Facility {
  return {
    kind: demand.facilityKind,
    id: facilityId(institution.id),
    demandId: demand.id,
    institutionId: institution.id,
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
    siteRationale,
    provenance: copyProvenance(institution.provenance),
  };
}

function isReadyToScan(world: WorldState, demand: SpatialDemand): boolean {
  if (demand.status === "seekingSite") return true;
  if (demand.status !== "blocked") return false;
  return world.tick % SPATIAL_DEMAND_RETRY_INTERVAL_TICKS === 0;
}

function advanceDemand(world: WorldState, institution: Institution, rng: () => number): void {
  const existing = world.spatialDemands.find(({ id }) => id === demandId(institution.id));
  const demand = existing ?? createDemand(institution);
  if (existing === undefined) world.spatialDemands.push(demand);
  if (!isReadyToScan(world, demand)) return;

  const selection = selectFacilitySite(world, demand.facilityKind, rng);
  if (selection === null) {
    demand.status = "blocked";
    demand.blockedReason = "noValidSite";
    return;
  }

  demand.status = "awaitingMaterials";
  demand.blockedReason = null;
  demand.site = selection.pos;
  demand.siteRationale = selection.rationale;
  world.buildings.push(createFacility(institution, demand, selection.pos, selection.rationale));
}

export function advanceSpatialDemands(world: WorldState, rng: () => number): void {
  for (const kind of INSTITUTION_KINDS) {
    for (const institution of world.institutions.filter((entry) => entry.kind === kind)) {
      advanceDemand(world, institution, rng);
    }
  }
}
