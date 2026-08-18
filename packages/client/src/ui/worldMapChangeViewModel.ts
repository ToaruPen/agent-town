import {
  CLOCK_BROADCAST_MS,
  NATION_TICKS_PER_SEASON,
  SPEED_MULTIPLIERS,
  TICK_RATE,
} from "@agent-town/shared";

/** visual.md §2.4: a multi-cell change staggers the cells' own start ticks, rather than every one of
 *  them flashing on the same frame — the map should read as many small events, not one blanket flash. */
const TERRITORY_CHANGE_STAGGER_STEP_TICKS = 7;
const TERRITORY_CHANGE_STAGGER_MODULUS_TICKS = 12;

/**
 * The widest gap, in simulated ticks, between two consecutive client-visible repaints — verified from
 * the server's own broadcast loops (`wsServer.ts`), not assumed: a `clock` heartbeat fires every
 * `CLOCK_BROADCAST_MS` regardless of speed, so no repaint is ever more than that many milliseconds behind
 * the last one, and at the fastest speed a session can be watching (`SPEED_MULTIPLIERS`'s own max), that
 * many milliseconds of wall clock advances this many simulated ticks. A window wider than this cannot be
 * jumped over by every repaint in a row.
 */
const MAX_BROADCAST_GAP_TICKS =
  Math.max(...SPEED_MULTIPLIERS) * TICK_RATE * (CLOCK_BROADCAST_MS / 1_000);
/** Margin over `MAX_BROADCAST_GAP_TICKS` for real scheduling jitter (event-loop delay, `setInterval`
 *  drift) — not for the per-cell stagger delay, which is already folded into a window's own start tick
 *  before this margin is ever measured against it. */
const BROADCAST_JITTER_MARGIN_TICKS = 30;

/**
 * visual.md §2.4 / visual.md:825: the flash's own span. Below ~5 Hz — the real cadence at every playable
 * speed, since the `clock` heartbeat is fixed at ~1 Hz regardless of speed — a smooth decay is not
 * achievable: a render can land anywhere inside the window, or nowhere at all if the window is narrower
 * than the gap between two renders. Sized past `MAX_BROADCAST_GAP_TICKS` so a render is always guaranteed
 * to land inside a changed cell's own window; `territoryChangePhase` below holds the flash at its peak for
 * the whole span rather than ramping it down; see its own comment for why.
 */
export const TERRITORY_CHANGE_FLASH_DURATION_TICKS =
  MAX_BROADCAST_GAP_TICKS + BROADCAST_JITTER_MARGIN_TICKS;
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
 * calendar fact the hatch decays toward. Exported so the host's own accumulator can prune a tracked
 * change once it is done, without duplicating this arithmetic or guessing from `territoryChangePhase`'s
 * output — that sentinel alone cannot tell "not started yet" apart from "already finished".
 */
export function nextSeasonBoundary(changeTick: number): number {
  return (Math.floor(changeTick / NATION_TICKS_PER_SEASON) + 1) * NATION_TICKS_PER_SEASON;
}

export interface TerritoryChangePhase {
  /**
   * 0 for every tick inside this cell's (staggered) flash window; null before the change starts and
   * again once the window has ended — in both null cases the caller has no flash to draw, only its own
   * resting alpha (or the hatch's). Deliberately not a rising fraction toward 1: visual.md:825's two-step
   * respecification means the flash holds at full strength for its whole span rather than decaying, since
   * at real broadcast cadence (see `MAX_BROADCAST_GAP_TICKS`) the client cannot promise it will ever be
   * asked to render more than one frame inside the window — a decaying value here would describe a fade
   * the surface may never actually show.
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
    return { flashProgress: 0, hatchAlpha: 0 };
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
