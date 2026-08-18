import { NATION_TICKS_PER_SEASON } from "@agent-town/shared";

/** visual.md §2.4: a multi-cell change staggers the cells' own start ticks, rather than every one of
 *  them flashing on the same frame — the map should read as many small events, not one blanket flash. */
const TERRITORY_CHANGE_STAGGER_STEP_TICKS = 7;
const TERRITORY_CHANGE_STAGGER_MODULUS_TICKS = 12;

/** visual.md §2.4: the flash's own span, from the peak alpha down to the cell's resting fill. */
export const TERRITORY_CHANGE_FLASH_DURATION_TICKS = 30;
export const TERRITORY_CHANGE_FLASH_PEAK_ALPHA = 0.55;
/** visual.md §2.4: the recent-change hatch's own peak, reached the instant the flash settles. */
export const TERRITORY_CHANGE_HATCH_PEAK_ALPHA = 0.35;

/**
 * Pure in `index` alone, so the paint layer can compute a cell's own delay without touching the clock or
 * the tracked change that produced it.
 */
export function territoryChangeStagger(index: number): number {
  return (index * TERRITORY_CHANGE_STAGGER_STEP_TICKS) % TERRITORY_CHANGE_STAGGER_MODULUS_TICKS;
}

/**
 * The first tick of the season *after* `changeTick`'s own — a plain multiple of the season length, not
 * an offset from the change. Stagger shifts a cell's own start by a few ticks; it does not move the
 * calendar fact the hatch decays toward.
 */
function nextSeasonBoundary(changeTick: number): number {
  return (Math.floor(changeTick / NATION_TICKS_PER_SEASON) + 1) * NATION_TICKS_PER_SEASON;
}

export interface TerritoryChangePhase {
  /**
   * 0 at the instant this cell's (staggered) change begins, rising to 1 as the flash settles into the
   * cell's resting fill; null before the change starts and again once the flash has fully settled — in
   * both cases the caller has no flash blend to make, only its own resting alpha (or the hatch's).
   */
  flashProgress: number | null;
  /** visual.md §2.4: the recent-change hatch's own alpha for this instant, 0 outside its window. */
  hatchAlpha: number;
}

const NO_CHANGE: TerritoryChangePhase = { flashProgress: null, hatchAlpha: 0 };

/**
 * A pure function of `tick`: the same tick always renders the same frame, with no wall clock and no
 * accumulated state — the property every phase in this module is required to hold (visual.md §2.4). The
 * caller supplies `changeTick` from its own tracked-change accumulator (never re-derived by diffing
 * snapshots) and `index` for this cell's stagger delay.
 *
 * Three sequential phases, matching visual.md §2.4: the flash, then the recent-change hatch decaying to
 * zero at the season boundary, then plain fill — the third phase needs no representation here, since
 * `NO_CHANGE`'s all-null-and-zero shape already *is* "just paint the resting fill".
 */
export function territoryChangePhase(
  tick: number,
  changeTick: number,
  index: number,
): TerritoryChangePhase {
  const start = changeTick + territoryChangeStagger(index);
  if (tick < start) return NO_CHANGE;

  const flashEnd = start + TERRITORY_CHANGE_FLASH_DURATION_TICKS;
  if (tick < flashEnd) {
    return { flashProgress: (tick - start) / TERRITORY_CHANGE_FLASH_DURATION_TICKS, hatchAlpha: 0 };
  }

  const boundary = nextSeasonBoundary(changeTick);
  if (tick >= boundary) return NO_CHANGE;

  const hatchSpan = boundary - flashEnd;
  if (hatchSpan <= 0) return NO_CHANGE;
  return {
    flashProgress: null,
    hatchAlpha: TERRITORY_CHANGE_HATCH_PEAK_ALPHA * (1 - (tick - flashEnd) / hatchSpan),
  };
}
