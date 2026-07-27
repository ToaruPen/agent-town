import {
  NATION_TICKS_PER_SEASON,
  type Season,
  type SpeedMultiplier,
  TICK_RATE,
} from "@agent-town/shared";

import { nationSeasonLabel } from "./nationText.js";

/** The last `clock` message, stamped with the wall-clock moment it arrived so time can be predicted. */
export interface NationClockSnapshot {
  tick: number;
  year: number;
  season: Season;
  speed: SpeedMultiplier;
  receivedAt: number;
}

export interface NationClockViewModel {
  /** `紀元1043年 夏（第3年）`, or 同期中 before the first clock of a session. */
  headline: string;
  calendarYear: number | null;
  elapsedYear: number | null;
  seasonLabel: string | null;
  /** 0..1 through the current season, driven by the predicted tick. */
  seasonProgress: number;
  remainingTicks: number | null;
  /** Null while paused: a frozen "12.4秒" reads as a bug, so paused shows ticks instead. */
  remainingSecondsLabel: string | null;
  paused: boolean;
  urgent: boolean;
}

/** Wall-clock seconds left at which the commit stops being future and starts being now. */
const URGENT_THRESHOLD_MS = 5_000;

const SYNCHRONISING: NationClockViewModel = {
  headline: "同期中",
  calendarYear: null,
  elapsedYear: null,
  seasonLabel: null,
  seasonProgress: 0,
  remainingTicks: null,
  remainingSecondsLabel: null,
  paused: false,
  urgent: false,
};

function seasonStartTick(tick: number): number {
  return Math.floor(tick / NATION_TICKS_PER_SEASON) * NATION_TICKS_PER_SEASON;
}

/**
 * The tick the simulation has most likely reached, given how long ago the last heartbeat arrived.
 *
 * Clamped one tick short of the boundary, which is the whole rule: only a `season` message advances
 * the season and the year, so local prediction may approach the boundary and must never cross it. A
 * HUD that predicts its way into the next spring and then gets corrected is worse than one that sits
 * at まもなく for 200 ms.
 */
function predictTick(clock: NationClockSnapshot, now: number): number {
  const boundaryTick = seasonStartTick(clock.tick) + NATION_TICKS_PER_SEASON;
  const elapsedMs = Math.max(now - clock.receivedAt, 0);
  const elapsedTicks = Math.floor((elapsedMs * TICK_RATE * clock.speed) / 1_000);
  return Math.min(clock.tick + elapsedTicks, boundaryTick - 1);
}

/**
 * The clock bar's whole state, derived at the display edge.
 *
 * The year and season come from the authoritative message, never from `nationSeasonOfTick` on the
 * current tick — that is what keeps prediction structurally unable to run the calendar forward. Only
 * the countdown is predicted, and `currentYear` is `history.currentYear`, captured once from `welcome`.
 */
export function buildNationClockViewModel(
  clock: NationClockSnapshot | null,
  currentYear: number,
  now: number,
): NationClockViewModel {
  if (clock === null) return SYNCHRONISING;

  const predictedTick = predictTick(clock, now);
  const remainingTicks = seasonStartTick(clock.tick) + NATION_TICKS_PER_SEASON - predictedTick;
  const paused = clock.speed === 0;
  const remainingMs = paused ? null : (remainingTicks * 1_000) / (TICK_RATE * clock.speed);
  const calendarYear = currentYear + clock.year - 1;
  const seasonLabel = nationSeasonLabel(clock.season);

  return {
    headline: `紀元${calendarYear}年 ${seasonLabel}（第${clock.year}年）`,
    calendarYear,
    elapsedYear: clock.year,
    seasonLabel,
    seasonProgress: (predictedTick - seasonStartTick(clock.tick)) / NATION_TICKS_PER_SEASON,
    remainingTicks,
    remainingSecondsLabel: remainingMs === null ? null : `${(remainingMs / 1_000).toFixed(1)}秒`,
    paused,
    urgent: remainingMs !== null && remainingMs <= URGENT_THRESHOLD_MS,
  };
}
