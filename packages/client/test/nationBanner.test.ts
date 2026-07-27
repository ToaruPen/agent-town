import type { Polity } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { NATION_BANNER_RING } from "../src/render/colors.js";
import {
  assignNationBanners,
  assignNationBannersWithOverrides,
  NATION_BANNER_SLOT_HUES,
  type NationBanner,
  POLITY_BANNER_OVERRIDE,
} from "../src/render/nationBanner.js";

/** The eight archival template colours, copied from the private POLITY_TEMPLATES table in
 *  packages/server/src/sim/historyGen.ts. The client cannot import from the server package, so this
 *  duplicate is what keeps the enumeration below measuring the worlds the generator really makes. */
const ARCHIVAL_COLORS = {
  sable: 0x6f7f88,
  gold: 0xc49a4b,
  moss: 0x708c5a,
  river: 0x5d8fa3,
  ivory: 0xc6bfa2,
  ember: 0xa65f45,
  thorn: 0x8b6b72,
  salt: 0x879a92,
} as const;

/** The floor visual.md §2.1 measures for the four-nation worlds the generator makes today is 40.9;
 *  V-1 declares 40 as the bar, so an override table that degrades the map fails a test. */
const DECLARED_SEPARATION_FLOOR = 40;
/** visual.md §2.1: below this chroma an archival hue is noise, so the polity claims no hue. */
const CHROMA_FLOOR = 18;
/** visual.md §2.1: "maximum hue drift among chromatic polities is 12°". */
const MAX_CHROMATIC_HUE_DRIFT_DEG = 12;
/** `WORLD_POLITY_COUNT` is 4 today. Held as a literal so the floor declared for a count stays
 *  pinned to the count it was measured at even if the generator's number moves. */
const WORLD_POLITY_COUNT_TODAY = 4;
/** The ΔE76 a candidate slot must clear before hue proximity is allowed to decide, mirroring the
 *  private `MIN_SEPARATION` in nationBanner.ts (visual.md §2.1). */
const DECLARED_ACCEPTANCE_BAR = 26;
/** Worst-case min pairwise ΔE76 per nation count, each declared one below the value measured here
 *  the way `DECLARED_SEPARATION_FLOOR` sits below 40.86. visual.md §2.1's table reads
 *  39.6 / 36.4 / 33.2 / 33.2; measured against this implementation, 39.5541 / 36.3539 / 33.2409 /
 *  33.2409. Eight nations is the ceiling: `historyGen` shuffles eight templates and slices, so
 *  raising `WORLD_POLITY_COUNT` past eight still yields eight. */
const DECLARED_SEPARATION_FLOOR_BY_COUNT: Readonly<Record<number, number>> = {
  5: 39,
  6: 36,
  7: 33,
  8: 33,
};

// An independent CIE ΔE76 implementation, deliberately not the one under test: sRGB -> D65 Lab.
function labOf(color: number): [number, number, number] {
  const toLinear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const pivot = (ratio: number): number =>
    ratio > 0.008856 ? Math.cbrt(ratio) : 7.787 * ratio + 16 / 116;
  const red = toLinear((color >> 16) & 0xff);
  const green = toLinear((color >> 8) & 0xff);
  const blue = toLinear(color & 0xff);
  const x = pivot((0.4124 * red + 0.3576 * green + 0.1805 * blue) / 0.95047);
  const y = pivot(0.2126 * red + 0.7152 * green + 0.0722 * blue);
  const z = pivot((0.0193 * red + 0.1192 * green + 0.9505 * blue) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE76(left: number, right: number): number {
  const [leftL, leftA, leftB] = labOf(left);
  const [rightL, rightA, rightB] = labOf(right);
  return Math.hypot(leftL - rightL, leftA - rightA, leftB - rightB);
}

function chromaOf(color: number): number {
  const [, a, b] = labOf(color);
  return Math.hypot(a, b);
}

function hueOf(color: number): number {
  const [, a, b] = labOf(color);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

function hueArc(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function polityOf(id: string, color: number): Polity {
  return {
    id,
    name: `${id}国`,
    adjective: id,
    color,
    values: [],
    foundingMyth: "",
    formativeTraumaEventIds: [],
    taboo: "",
    ambition: "",
    governance: "",
  };
}

/** Polities as the generator makes them: templates shuffled, then labelled polity-1..polity-N. */
function drawnPolities(colors: readonly number[]): Polity[] {
  return colors.map((color, index) => polityOf(`polity-${index + 1}`, color));
}

function slotByNation(banners: readonly NationBanner[]): Map<string, number> {
  return new Map(banners.map(({ nationId, slot }) => [nationId, slot]));
}

function slotOf(banners: readonly NationBanner[], nationId: string): number {
  return slotByNation(banners).get(nationId) ?? -1;
}

function minPairwiseDeltaE(banners: readonly NationBanner[]): number {
  let worst = Number.POSITIVE_INFINITY;
  for (let left = 0; left < banners.length; left += 1) {
    for (let right = left + 1; right < banners.length; right += 1) {
      worst = Math.min(worst, deltaE76(banners[left]?.color ?? 0, banners[right]?.color ?? 0));
    }
  }
  return worst;
}

/** Every ordered draw of `size` templates from the eight, which is what `shuffled().slice(0, size)`
 *  makes and what visual.md §2.1 enumerated to measure the floor: 8 x 7 x 6 x 5 = 1680 at four. */
function generatedWorlds(size: number): number[][] {
  const colors = Object.values(ARCHIVAL_COLORS);
  const worlds: number[][] = [];
  const walk = (drawn: number[]): void => {
    if (drawn.length === size) {
      worlds.push(drawn);
      return;
    }
    for (const color of colors) {
      if (drawn.includes(color)) continue;
      walk([...drawn, color]);
    }
  };
  walk([]);
  return worlds;
}

/** The ring pairs sitting below the acceptance bar. These are the only places the bar can change a
 *  choice: everywhere else every candidate clears it, so the bar has nothing to refuse. Measured
 *  here as olive/moss at ΔE 24.6 and violet/plum at ΔE 20.8, both a primary against a fallback. */
function ringPairsBelowBar(): [number, number][] {
  const pairs: [number, number][] = [];
  for (let left = 0; left < NATION_BANNER_RING.length; left += 1) {
    for (let right = left + 1; right < NATION_BANNER_RING.length; right += 1) {
      const gap = deltaE76(NATION_BANNER_RING[left] ?? 0, NATION_BANNER_RING[right] ?? 0);
      if (gap < DECLARED_ACCEPTANCE_BAR) pairs.push([left, right]);
    }
  }
  return pairs;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe("assignNationBanners", () => {
  it("gives every polity one ring slot, in input order, carrying that slot's colour", () => {
    const polities = drawnPolities([ARCHIVAL_COLORS.sable, ARCHIVAL_COLORS.gold]);

    const banners = assignNationBanners(polities);

    expect(banners.map(({ nationId }) => nationId)).toEqual(["polity-1", "polity-2"]);
    expect(new Set(banners.map(({ slot }) => slot)).size).toBe(banners.length);
    for (const { color, slot } of banners) {
      expect(color).toBe(NATION_BANNER_RING[slot]);
    }
  });

  it("is deterministic for a given polity list", () => {
    const colors = [
      ARCHIVAL_COLORS.sable,
      ARCHIVAL_COLORS.river,
      ARCHIVAL_COLORS.salt,
      ARCHIVAL_COLORS.thorn,
    ];

    expect(assignNationBanners(drawnPolities(colors))).toEqual(
      assignNationBanners(drawnPolities(colors)),
    );
  });

  it("assigns the same colour under every permutation of the polity list", () => {
    const polities = drawnPolities([
      ARCHIVAL_COLORS.gold,
      ARCHIVAL_COLORS.sable,
      ARCHIVAL_COLORS.ember,
      ARCHIVAL_COLORS.ivory,
    ]);
    const expected = slotByNation(assignNationBanners(polities));

    for (const permuted of permutations(polities)) {
      expect(slotByNation(assignNationBanners(permuted))).toEqual(expected);
    }
  });

  it("breaks a chroma tie on the nation id, not on list position", () => {
    const first = polityOf("polity-1", ARCHIVAL_COLORS.sable);
    const second = polityOf("polity-2", ARCHIVAL_COLORS.sable);

    expect(slotByNation(assignNationBanners([second, first]))).toEqual(
      slotByNation(assignNationBanners([first, second])),
    );
  });

  // The two enumerations below walk 1680 worlds each, measured at 13 ms locally. CI runs about 2.7x
  // slower, so the stated budget is far above that rather than merely three times it.
  it("keeps every four-nation world the generator can make above the declared separation floor", () => {
    let worst = Number.POSITIVE_INFINITY;
    for (const world of generatedWorlds(WORLD_POLITY_COUNT_TODAY)) {
      worst = Math.min(worst, minPairwiseDeltaE(assignNationBanners(drawnPolities(world))));
    }

    expect(worst).toBeGreaterThanOrEqual(DECLARED_SEPARATION_FLOOR);
  }, 1_000);

  it("keeps a chromatic polity's banner within the stated hue drift of its archival colour", () => {
    let worstDrift = 0;
    for (const world of generatedWorlds(WORLD_POLITY_COUNT_TODAY)) {
      const polities = drawnPolities(world);
      const banners = assignNationBanners(polities);
      for (const { id, color } of polities) {
        if (chromaOf(color) < CHROMA_FLOOR) continue;
        const designedHue = NATION_BANNER_SLOT_HUES[slotOf(banners, id)] ?? 0;
        worstDrift = Math.max(worstDrift, hueArc(designedHue, hueOf(color)));
      }
    }

    expect(worstDrift).toBeLessThanOrEqual(MAX_CHROMATIC_HUE_DRIFT_DEG);
  }, 1_000);

  it("keeps the designed slot hues aligned with the ring colours", () => {
    expect(NATION_BANNER_SLOT_HUES).toHaveLength(NATION_BANNER_RING.length);

    for (const [slot, designedHue] of NATION_BANNER_SLOT_HUES.entries()) {
      // Slots 8-11 were sRGB-clamped, so a few degrees of gap is expected; a swapped pair is not.
      expect(hueArc(designedHue, hueOf(NATION_BANNER_RING[slot] ?? 0))).toBeLessThan(6);
    }
  });

  it("ships an empty override table, so the measured floor is the unconstrained one", () => {
    expect(POLITY_BANNER_OVERRIDE).toEqual({});
  });

  it("honours an override and withholds its slot from the free pool", () => {
    const polities = drawnPolities([
      ARCHIVAL_COLORS.sable,
      ARCHIVAL_COLORS.gold,
      ARCHIVAL_COLORS.moss,
      ARCHIVAL_COLORS.river,
    ]);
    const unconstrained = assignNationBanners(polities);
    const contestedSlot = slotOf(unconstrained, "polity-2");

    const overridden = assignNationBannersWithOverrides(polities, {
      [ARCHIVAL_COLORS.sable]: contestedSlot,
    });

    expect(slotOf(unconstrained, "polity-1")).not.toBe(contestedSlot);
    expect(slotOf(overridden, "polity-1")).toBe(contestedSlot);
    expect(slotOf(overridden, "polity-2")).not.toBe(contestedSlot);
    expect(overridden.filter(({ slot }) => slot === contestedSlot)).toHaveLength(1);
  });

  // Enumerating five through eight nations walks 6720 + 20160 + 40320 + 40320 = 107520 worlds,
  // measured at 0.95 s locally. CI runs about 2.7x slower, so the budget sits well above that.
  it("keeps every nation count the generator can reach above its declared floor", () => {
    const shortfalls = Object.entries(DECLARED_SEPARATION_FLOOR_BY_COUNT).flatMap(
      ([count, floor]) => {
        let worst = Number.POSITIVE_INFINITY;
        for (const world of generatedWorlds(Number(count))) {
          worst = Math.min(worst, minPairwiseDeltaE(assignNationBanners(drawnPolities(world))));
        }
        return worst >= floor ? [] : [`${count} nations: ${worst.toFixed(2)} is below ${floor}`];
      },
    );

    expect(shortfalls).toEqual([]);
  }, 10_000);

  /** The acceptance bar's only job is refusing a slot that would sit too close to one already taken.
   *  Reaching it needs two nations contending for the same region of the ring, which the eight
   *  archival colours never do — only four of them clear the chroma floor, so at most four hues are
   *  ever claimed. Feeding the two ring colours of a below-bar pair is what puts the bar under load. */
  it("refuses a hue-exact slot whose neighbour is already taken", () => {
    const pairs = ringPairsBelowBar();
    // If a re-tuned ring left no pair below the bar, this test would pass by doing nothing.
    expect(pairs.length).toBeGreaterThan(0);

    for (const [left, right] of pairs) {
      const banners = assignNationBanners(
        drawnPolities([NATION_BANNER_RING[left] ?? 0, NATION_BANNER_RING[right] ?? 0]),
      );

      expect(new Set(banners.map(({ slot }) => slot))).not.toEqual(new Set([left, right]));
      expect(minPairwiseDeltaE(banners)).toBeGreaterThanOrEqual(DECLARED_ACCEPTANCE_BAR);
    }
  });

  it("spends the ring once at twelve nations and repeats a colour past it", () => {
    const twelve = assignNationBanners(drawnPolities([...NATION_BANNER_RING]));

    expect(twelve).toHaveLength(NATION_BANNER_RING.length);
    expect(new Set(twelve.map(({ slot }) => slot)).size).toBe(NATION_BANNER_RING.length);

    // Past twelve, `freeSlots` offers the whole ring again — visual.md §2.1 answers that count with a
    // second channel, not a thirteenth hue. Every nation still gets a banner and two now share one,
    // so there is no separation floor to assert here and claiming one would be false.
    const thirteen = assignNationBanners(
      drawnPolities([...NATION_BANNER_RING, ARCHIVAL_COLORS.sable]),
    );

    expect(thirteen).toHaveLength(NATION_BANNER_RING.length + 1);
    expect(new Set(thirteen.map(({ slot }) => slot)).size).toBe(NATION_BANNER_RING.length);
  });
});
