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

/** Every ordered draw of four templates from the eight, which is what `shuffled().slice(0, 4)` makes
 *  and what visual.md §2.1 enumerated to measure the floor: 8 x 7 x 6 x 5 = 1680 worlds. */
function generatedWorlds(): number[][] {
  const colors = Object.values(ARCHIVAL_COLORS);
  const worlds: number[][] = [];
  const walk = (drawn: number[]): void => {
    if (drawn.length === 4) {
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
    for (const world of generatedWorlds()) {
      worst = Math.min(worst, minPairwiseDeltaE(assignNationBanners(drawnPolities(world))));
    }

    expect(worst).toBeGreaterThanOrEqual(DECLARED_SEPARATION_FLOOR);
  }, 1_000);

  it("keeps a chromatic polity's banner within the stated hue drift of its archival colour", () => {
    let worstDrift = 0;
    for (const world of generatedWorlds()) {
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
});
