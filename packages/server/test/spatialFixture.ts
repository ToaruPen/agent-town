import type { TrailCell } from "@agent-town/shared";

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
