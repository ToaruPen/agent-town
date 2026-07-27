import type { NationId, Polity } from "@agent-town/shared";

import { NATION_BANNER_RING } from "./colors.js";

export interface NationBanner {
  nationId: NationId;
  color: number;
  slot: number;
}

/** The designed hue centre of each `NATION_BANNER_RING` slot, in degrees, from visual.md §2.1.
 *  These are spec values, not measurements: slots 8-11 were sRGB-clamped when the ring was built, so
 *  a slot's rendered hue can sit a few degrees off its centre. The assignment anchors on the centre,
 *  which is what reproduces the drift figures the design published. */
export const NATION_BANNER_SLOT_HUES = [
  25, 70, 105, 145, 189, 258, 300, 340, 50, 125, 225, 310,
] as const;

/** ΔE76 a candidate slot must clear before hue proximity is allowed to decide (visual.md §2.1). */
const MIN_SEPARATION = 26;
/** Below this chroma an archival colour's hue angle is noise, so the polity claims no hue. */
const CHROMA_FLOOR = 18;

/** Escape hatch for the cases where separation and lore disagree — visual.md §2.1 names 黒貂辺境国 in
 *  crimson as the one to look at. Keyed by archival `Polity.color`, valued as a ring slot index.
 *  Empty on purpose: an entry is claimed before the ring walk and withheld from the free pool, which
 *  preserves the ΔE 26 acceptance bar but not the measured floor, so each one has to be re-measured. */
export const POLITY_BANNER_OVERRIDE: Readonly<Record<number, number>> = {};

interface RingSlot {
  slot: number;
  color: number;
  hue: number;
  lab: readonly [number, number, number];
}

interface SlotCandidate {
  ring: RingSlot;
  separation: number;
  hueDistance: number;
}

function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function pivot(ratio: number): number {
  return ratio > 216 / 24389 ? Math.cbrt(ratio) : (841 / 108) * ratio + 4 / 29;
}

/** CIE Lab under D65, from a 0xRRGGBB sRGB value. Every distance here is ΔE76 — a plain Lab
 *  distance — which is what visual.md measured every threshold in this module against. */
function labOf(color: number): readonly [number, number, number] {
  const red = toLinear((color >> 16) & 0xff);
  const green = toLinear((color >> 8) & 0xff);
  const blue = toLinear(color & 0xff);
  const x = pivot((0.4124 * red + 0.3576 * green + 0.1805 * blue) / 0.95047);
  const y = pivot(0.2126 * red + 0.7152 * green + 0.0722 * blue);
  const z = pivot((0.0193 * red + 0.1192 * green + 0.9505 * blue) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const RING_SLOTS: readonly RingSlot[] = NATION_BANNER_RING.map((color, slot) => ({
  slot,
  color,
  hue: NATION_BANNER_SLOT_HUES[slot] ?? 0,
  lab: labOf(color),
}));

function labDistance(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
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

function compareIds(left: NationId, right: NationId): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Chroma-priority: a polity whose archival colour has a real hue claims its slot first, so the
 *  near-neutral greys absorb all the drift instead of spending it (visual.md §2.1, property 2).
 *  The id breaks a chroma tie, never the list position — that is what makes this permutation-stable. */
function assignmentOrder(polities: readonly Polity[]): Polity[] {
  return [...polities].sort(
    (left, right) => chromaOf(right.color) - chromaOf(left.color) || compareIds(left.id, right.id),
  );
}

/** Free slots, or the whole ring once it is exhausted. Past twelve nations visual.md §2.1 calls for a
 *  second channel rather than a thirteenth hue; repeating keeps this a total function until then. */
function freeSlots(taken: readonly RingSlot[]): readonly RingSlot[] {
  const free = RING_SLOTS.filter((ring) => !taken.includes(ring));
  return free.length === 0 ? RING_SLOTS : free;
}

function candidateFor(
  ring: RingSlot,
  taken: readonly RingSlot[],
  hue: number | null,
): SlotCandidate {
  let separation = Number.POSITIVE_INFINITY;
  for (const claimed of taken) {
    separation = Math.min(separation, labDistance(ring.lab, claimed.lab));
  }
  return { ring, separation, hueDistance: hue === null ? 0 : hueArc(ring.hue, hue) };
}

/** Prefer a candidate that clears the acceptance bar; among those, the closest hue; otherwise the
 *  greatest separation. A tie holds the incumbent, so the lower slot index wins. */
function isBetter(candidate: SlotCandidate, best: SlotCandidate): boolean {
  const candidateClears = candidate.separation >= MIN_SEPARATION;
  const bestClears = best.separation >= MIN_SEPARATION;
  if (candidateClears !== bestClears) return candidateClears;
  if (candidateClears && candidate.hueDistance !== best.hueDistance) {
    return candidate.hueDistance < best.hueDistance;
  }
  return candidate.separation > best.separation;
}

function chooseSlot(taken: readonly RingSlot[], color: number): RingSlot {
  const hue = chromaOf(color) >= CHROMA_FLOOR ? hueOf(color) : null;
  return freeSlots(taken)
    .map((ring) => candidateFor(ring, taken, hue))
    .reduce((best, candidate) => (isBetter(candidate, best) ? candidate : best)).ring;
}

function bannerOf(nationId: NationId, ring: RingSlot): NationBanner {
  return { nationId, color: ring.color, slot: ring.slot };
}

/**
 * `assignNationBanners` applied to a candidate override table, so that a table can be measured
 * against the separation floor before it ships, per visual.md §2.1. An entry naming a slot the ring
 * does not have is ignored, leaving that polity to the ring walk.
 */
export function assignNationBannersWithOverrides(
  polities: readonly Polity[],
  overrides: Readonly<Record<number, number>>,
): NationBanner[] {
  const banners = new Map<NationId, NationBanner>();
  const taken: RingSlot[] = [];
  for (const { id, color } of polities) {
    const ring = RING_SLOTS[overrides[color] ?? -1];
    if (ring === undefined) continue;
    banners.set(id, bannerOf(id, ring));
    taken.push(ring);
  }
  for (const { id, color } of assignmentOrder(polities)) {
    if (banners.has(id)) continue;
    const ring = chooseSlot(taken, color);
    banners.set(id, bannerOf(id, ring));
    taken.push(ring);
  }
  return polities.flatMap(({ id }) => banners.get(id) ?? []);
}

/**
 * Derive each nation's banner colour — the alpha-1.0 identity channel of visual.md §2.0 — from the
 * ring, so that no two nations are hard to tell apart. `Polity.color` is archival and collides: 36%
 * of generated worlds hold a pair below ΔE 15 (visual.md §1.3). It is deliberately never read as a
 * colour here, only as the hue and chroma hint that anchors a slot to the lore.
 *
 * Feed this `history.polities` — the set fixed at world generation — not the list of nations
 * currently alive. A dead nation's slot would otherwise come free and recolour the map mid-game.
 * The result is a pure function of that set, so the ranking re-sorting cannot move a colour.
 */
export function assignNationBanners(polities: readonly Polity[]): NationBanner[] {
  return assignNationBannersWithOverrides(polities, POLITY_BANNER_OVERRIDE);
}
