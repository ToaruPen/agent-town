import { NATION_TICKS_PER_SEASON, type SpeedMultiplier, TICK_RATE } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  buildNationClockViewModel,
  type NationClockSnapshot,
  type NationClockViewModel,
} from "../src/ui/nationClockViewModel.js";

const CURRENT_YEAR = 1041;

function snapshot(overrides: Partial<NationClockSnapshot> = {}): NationClockSnapshot {
  return { tick: 0, year: 1, season: "spring", speed: 1, receivedAt: 1_000, ...overrides };
}

/** `remainingTicks` is null only when no clock has arrived, which these cases all supply. */
function ticksLeft(view: NationClockViewModel): number {
  if (view.remainingTicks === null) throw new Error("expected a clock to have arrived");
  return view.remainingTicks;
}

describe("buildNationClockViewModel", () => {
  it("shows the calendar year from history plus the elapsed year, not the elapsed year alone", () => {
    const view = buildNationClockViewModel(snapshot({ year: 3 }), CURRENT_YEAR, 1_000);

    expect(view.calendarYear).toBe(1_043);
    expect(view.elapsedYear).toBe(3);
  });

  /** The formula is `history.currentYear + clock.year - 1`, so the first game year is the archive's own. */
  it("puts the first elapsed year at the year the chronicle ended", () => {
    expect(buildNationClockViewModel(snapshot({ year: 1 }), CURRENT_YEAR, 1_000).calendarYear).toBe(
      1_041,
    );
  });

  it("advances the calendar year with the authoritative year at a rollover", () => {
    const lastOfYear = buildNationClockViewModel(
      snapshot({ tick: NATION_TICKS_PER_SEASON * 4 - 1, year: 1, season: "winter" }),
      CURRENT_YEAR,
      1_000,
    );
    const firstOfNext = buildNationClockViewModel(
      snapshot({ tick: NATION_TICKS_PER_SEASON * 4, year: 2, season: "spring" }),
      CURRENT_YEAR,
      1_000,
    );

    expect(lastOfYear.calendarYear).toBe(1_041);
    expect(firstOfNext.calendarYear).toBe(1_042);
  });

  /**
   * The hard rule from §3.1: prediction may approach the boundary and never cross it. A HUD that
   * predicts its way into the next spring and is then corrected is worse than one that sits at まもなく.
   */
  it("never predicts past the season boundary however late the next heartbeat is", () => {
    const late = buildNationClockViewModel(snapshot({ tick: 299, speed: 8 }), CURRENT_YEAR, 60_000);

    expect(late.remainingTicks).toBe(1);
    expect(late.seasonProgress).toBeLessThan(1);
  });

  it("counts down as wall-clock time passes within the season", () => {
    const atArrival = buildNationClockViewModel(snapshot({ tick: 0 }), CURRENT_YEAR, 1_000);
    const oneSecondLater = buildNationClockViewModel(snapshot({ tick: 0 }), CURRENT_YEAR, 2_000);

    expect(atArrival.remainingTicks).toBe(NATION_TICKS_PER_SEASON);
    expect(oneSecondLater.remainingTicks).toBe(NATION_TICKS_PER_SEASON - TICK_RATE);
  });

  it("scales prediction by the speed multiplier", () => {
    const consumedAt = (speed: SpeedMultiplier): number =>
      NATION_TICKS_PER_SEASON -
      ticksLeft(buildNationClockViewModel(snapshot({ speed }), CURRENT_YEAR, 2_000));

    expect(consumedAt(1)).toBe(TICK_RATE);
    expect(consumedAt(8)).toBe(TICK_RATE * 8);
  });

  /** Monotonic under a late heartbeat: a stale snapshot must not make the countdown jump backwards. */
  it("keeps the countdown non-increasing as now advances", () => {
    const remaining = [0, 500, 1_000, 1_500, 2_000, 5_000].map((elapsed) =>
      ticksLeft(
        buildNationClockViewModel(snapshot({ tick: 40, speed: 2 }), CURRENT_YEAR, 1_000 + elapsed),
      ),
    );

    expect(remaining).toEqual([...remaining].toSorted((a, b) => b - a));
  });

  /** Seconds are meaningless when time is not flowing; a frozen "12.4秒" reads as a bug. */
  it("reports ticks and no seconds while paused", () => {
    const paused = buildNationClockViewModel(
      snapshot({ tick: 120, speed: 0 }),
      CURRENT_YEAR,
      9_999,
    );

    expect(paused.paused).toBe(true);
    expect(paused.remainingSecondsLabel).toBeNull();
    expect(paused.remainingTicks).toBe(NATION_TICKS_PER_SEASON - 120);
  });

  it("does not let wall-clock time advance the tick while paused", () => {
    const early = buildNationClockViewModel(snapshot({ tick: 120, speed: 0 }), CURRENT_YEAR, 1_000);
    const late = buildNationClockViewModel(snapshot({ tick: 120, speed: 0 }), CURRENT_YEAR, 99_000);

    expect(late.remainingTicks).toBe(early.remainingTicks);
  });

  it("labels the remaining wall-clock seconds to one decimal while running", () => {
    const view = buildNationClockViewModel(snapshot({ tick: 0, speed: 1 }), CURRENT_YEAR, 1_000);

    expect(view.remainingSecondsLabel).toBe("30.0秒");
  });

  it("shortens the same countdown at higher speed", () => {
    const view = buildNationClockViewModel(snapshot({ tick: 0, speed: 8 }), CURRENT_YEAR, 1_000);

    expect(view.remainingSecondsLabel).toBe("3.8秒");
  });

  it("marks the last few wall-clock seconds urgent, and never while paused", () => {
    const calm = buildNationClockViewModel(snapshot({ tick: 0, speed: 1 }), CURRENT_YEAR, 1_000);
    const late = buildNationClockViewModel(snapshot({ tick: 280, speed: 1 }), CURRENT_YEAR, 1_000);
    const paused = buildNationClockViewModel(
      snapshot({ tick: 299, speed: 0 }),
      CURRENT_YEAR,
      1_000,
    );

    expect(calm.urgent).toBe(false);
    expect(late.urgent).toBe(true);
    expect(paused.urgent).toBe(false);
  });

  it("reads the season from the authoritative message rather than from the tick", () => {
    // A tick that says spring with a message that says autumn: the message wins, always.
    const view = buildNationClockViewModel(
      snapshot({ tick: 0, season: "autumn" }),
      CURRENT_YEAR,
      1_000,
    );

    expect(view.seasonLabel).toBe("秋");
  });

  it("names the year, season and elapsed year in one readable headline", () => {
    const view = buildNationClockViewModel(
      snapshot({ year: 3, season: "summer" }),
      CURRENT_YEAR,
      1_000,
    );

    expect(view.headline).toBe("紀元1043年 夏（第3年）");
  });

  it("fills the progress bar as the season is consumed", () => {
    const start = buildNationClockViewModel(snapshot({ tick: 0, speed: 0 }), CURRENT_YEAR, 1_000);
    const middle = buildNationClockViewModel(
      snapshot({ tick: 150, speed: 0 }),
      CURRENT_YEAR,
      1_000,
    );

    expect(start.seasonProgress).toBe(0);
    expect(middle.seasonProgress).toBeCloseTo(0.5, 5);
  });

  /** Before the first `clock` after a reconnect there is nothing to derive a countdown from. */
  it("reports a synchronising state when no clock has arrived", () => {
    const view = buildNationClockViewModel(null, CURRENT_YEAR, 1_000);

    expect(view.headline).toBe("同期中");
    expect(view.remainingSecondsLabel).toBeNull();
    expect(view.seasonProgress).toBe(0);
  });
});
