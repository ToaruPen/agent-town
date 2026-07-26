import { describe, expect, it } from "vitest";

import {
  FACILITY_BUILD_TICKS,
  FACILITY_KIND_BY_INSTITUTION,
  FACILITY_NAMES,
  FACILITY_SITE_WEIGHTS,
  FACILITY_WOOD_COST,
  type Facility,
  type SpatialDemand,
  TRAIL_LEVEL_WEAR,
  TRAIL_PURPOSE_WEAR,
  type TrailCell,
} from "../src/index.js";

describe("spatial contracts", () => {
  it("maps every institution to one configured facility", () => {
    expect(FACILITY_KIND_BY_INSTITUTION).toEqual({
      communalGranaryStore: "communalGranary",
      grainMarket: "grainMarket",
      rationControl: "rationDepot",
    });
    expect(Object.keys(FACILITY_NAMES)).toEqual(["communalGranary", "grainMarket", "rationDepot"]);
    expect(Object.keys(FACILITY_WOOD_COST)).toEqual(Object.keys(FACILITY_BUILD_TICKS));
    expect(Object.keys(FACILITY_SITE_WEIGHTS)).toEqual(Object.keys(FACILITY_NAMES));
  });

  it("keeps trail thresholds ordered and wandering wear weakest", () => {
    expect([
      TRAIL_LEVEL_WEAR.none,
      TRAIL_LEVEL_WEAR.trace,
      TRAIL_LEVEL_WEAR.trail,
      TRAIL_LEVEL_WEAR.establishedTrail,
    ]).toEqual([0, 2, 8, 24]);
    expect(TRAIL_PURPOSE_WEAR.wandering).toBeLessThan(TRAIL_PURPOSE_WEAR.gathering);
  });

  it("accepts complete demand, facility, and trail values", () => {
    const demand = {
      id: "demand-institution-1",
      facilityKind: "communalGranary",
      source: { kind: "institution", id: "institution-1" },
      supporterIds: ["agent-1"],
      requiredWood: 15,
      requiredLabor: 240,
      status: "seekingSite",
      blockedReason: null,
      site: null,
      siteRationale: null,
      provenance: {
        causedByEventIds: [],
        proposedByAgentIds: ["agent-1"],
        supportedByAgentIds: ["agent-1"],
        opposedByAgentIds: [],
        decidedAtTick: 10,
      },
    } satisfies SpatialDemand;
    const facility = {
      kind: "communalGranary",
      id: "facility-institution-1",
      demandId: demand.id,
      institutionId: "institution-1",
      pos: { x: 1, y: 1 },
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
      provenance: demand.provenance,
    } satisfies Facility;
    const trail = {
      wear: 0,
      level: "none",
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
    } satisfies TrailCell;

    expect([demand.id, facility.id, trail.level]).toEqual([
      "demand-institution-1",
      "facility-institution-1",
      "none",
    ]);
  });
});
