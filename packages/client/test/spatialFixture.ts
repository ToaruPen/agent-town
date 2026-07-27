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

/**
 * Reads back a trail cell that a test just wrote into a fixture array, for
 * building an overridden copy via `{ ...requireTrailCell(cells, i), ... }`.
 * Throws instead of returning `undefined` so callers can spread it safely.
 */
export function requireTrailCell(cells: readonly TrailCell[], index: number): TrailCell {
  const cell = cells[index];
  if (cell === undefined) throw new Error(`missing trail cell fixture at index ${index}`);
  return cell;
}

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
