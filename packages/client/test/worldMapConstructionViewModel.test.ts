import type { ActiveDirective } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { cityConstructionProgress } from "../src/ui/worldMapConstructionViewModel.js";

function directive(overrides: Partial<ActiveDirective> = {}): ActiveDirective {
  return {
    id: "directive-1",
    kind: "growCity",
    targetCityId: "city-1",
    issuedAtTick: 0,
    seasonsRemaining: 2,
    totalSeasons: 4,
    ...overrides,
  };
}

describe("cityConstructionProgress", () => {
  it("reports no progress for a city with no active directive at all", () => {
    expect(cityConstructionProgress([], "city-1", false)).toBeNull();
  });

  it("is 0 the moment a directive is issued and rises toward 1 as it nears completion", () => {
    const fresh = directive({ seasonsRemaining: 4, totalSeasons: 4 });
    const halfway = directive({ seasonsRemaining: 2, totalSeasons: 4 });
    const almostDone = directive({ seasonsRemaining: 1, totalSeasons: 4 });

    expect(cityConstructionProgress([fresh], "city-1", false)).toBe(0);
    expect(cityConstructionProgress([halfway], "city-1", false)).toBe(0.5);
    expect(cityConstructionProgress([almostDone], "city-1", false)).toBe(0.75);
  });

  it("ignores a directive targeting a different city", () => {
    const elsewhere = directive({ targetCityId: "city-2" });

    expect(cityConstructionProgress([elsewhere], "city-1", false)).toBeNull();
  });

  /** `local/cityScene.ts`'s own `activeDirectivesForCity` puts a targetless directive on the capital —
   *  duplicated here (not imported, to keep the Canvas 2D world map free of PixiJS) but the same rule. */
  it("puts a directive with no target on the capital, and nowhere else", () => {
    const untargeted = directive({ targetCityId: null });

    expect(cityConstructionProgress([untargeted], "capital-city", true)).not.toBeNull();
    expect(cityConstructionProgress([untargeted], "other-city", false)).toBeNull();
  });

  /**
   * visual.md §2.4 draws one arc per city, but a city can have more than one active directive. The
   * design does not say which one wins, so what actually matters is that the choice does not depend on
   * array order — permuting the same three directives must always pick the same progress.
   */
  it("picks a stable directive regardless of the array's own order", () => {
    const soonest = directive({ id: "a", seasonsRemaining: 1, totalSeasons: 4 });
    const middle = directive({ id: "b", seasonsRemaining: 2, totalSeasons: 4 });
    const newest = directive({ id: "c", seasonsRemaining: 4, totalSeasons: 4 });

    const forward = cityConstructionProgress([soonest, middle, newest], "city-1", false);
    const reversed = cityConstructionProgress([newest, middle, soonest], "city-1", false);
    const shuffled = cityConstructionProgress([middle, newest, soonest], "city-1", false);

    expect(forward).toBe(reversed);
    expect(forward).toBe(shuffled);
    // And it is specifically the closest-to-completion one, not merely order-independent by accident.
    expect(forward).toBe(0.75);
  });

  it("breaks an exact tie by the lower directive id, not by array position", () => {
    const first = directive({ id: "a", seasonsRemaining: 1, totalSeasons: 2 });
    const second = directive({ id: "b", seasonsRemaining: 1, totalSeasons: 4 });

    const aFirst = cityConstructionProgress([first, second], "city-1", false);
    const bFirst = cityConstructionProgress([second, first], "city-1", false);

    expect(aFirst).toBe(bFirst);
    expect(aFirst).toBe(0.5); // first's own ratio (1 - 1/2), not second's (1 - 1/4)
  });
});
