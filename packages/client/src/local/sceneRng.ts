import type { Position } from "@agent-town/shared";

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;

/**
 * A city's scene seed. Salted by position as well as identifier, because the identifiers are
 * seed-invariant — `polity-N` and `city-polity-N-M` are the same strings in every generated world —
 * while a capital's position is not. Salting from `cityId` alone would give every world one town.
 */
export function citySceneSeed(cityId: string, pos: Position): number {
  const salt = `${cityId}:${pos.x},${pos.y}`;
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < salt.length; index += 1) {
    hash ^= salt.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * The simulation's generator technique, kept client-side: nothing in `packages/client/` can reach
 * `packages/server/src/sim/rng.ts`, and a view's randomness is not the simulation's.
 */
export function createSceneRng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
