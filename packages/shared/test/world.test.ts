import { describe, expect, it } from "vitest";
import type { FacilityKind } from "../src/spatial.js";
import { type Building, type Field, isFacility, isField, isHouse } from "../src/world.js";

describe("building predicates", () => {
  it("does not treat an unknown building kind as a facility", () => {
    const stranger = { kind: "field" } as unknown as Building;

    expect(isFacility(stranger)).toBe(false);
  });

  it("still recognises every real facility kind", () => {
    const kinds: FacilityKind[] = ["communalGranary", "grainMarket", "rationDepot"];

    for (const kind of kinds) {
      expect(isFacility({ kind } as unknown as Building)).toBe(true);
    }
  });

  it("tells a field from a house and from a facility", () => {
    const field: Field = {
      kind: "field",
      pos: { x: 1, y: 1 },
      progress: 0,
      complete: false,
      stage: "fallow",
    };

    expect(isField(field)).toBe(true);
    expect(isHouse(field)).toBe(false);
    expect(isFacility(field)).toBe(false);
  });
});
