import { NATION_TICKS_PER_SEASON } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  TERRITORY_CHANGE_FLASH_DURATION_TICKS,
  TERRITORY_CHANGE_HATCH_PEAK_ALPHA,
  territoryChangePhase,
  territoryChangeStagger,
} from "../src/ui/worldMapChangeViewModel.js";

describe("territoryChangePhase", () => {
  /** Required: the same tick must always render the same frame — no wall clock, no accumulated state. */
  it("is a pure function of tick — repeated calls with the same arguments agree", () => {
    const changeTick = 900;
    const samples = [0, 1, 15, 29, 30, 150, 299, 300, 5000];

    for (const tick of samples) {
      const first = territoryChangePhase(changeTick + tick, changeTick, 3);
      const second = territoryChangePhase(changeTick + tick, changeTick, 3);
      expect(second).toEqual(first);
    }
  });

  it("starts at the flash's peak alpha the instant a cell changes", () => {
    const changeTick = 0;

    const phase = territoryChangePhase(changeTick, changeTick, 0);

    expect(phase.flashProgress).toBe(0);
    expect(phase.hatchAlpha).toBe(0);
  });

  /**
   * visual.md:825: below ~5 Hz — the real cadence at every playable speed, since the `clock` heartbeat is
   * fixed at ~1 Hz regardless of speed (`wsServer.ts`) — a smooth decay is not achievable, and the flash
   * must be a two-step change instead: full strength for the whole window, then the hatch. A render can
   * land anywhere inside the window (or be the only one to land inside it at all), so any tick in the
   * window must report the same full-strength state as any other — not a fraction that happens to have
   * decayed by however far that particular render landed.
   */
  it("holds the flash at full strength for its whole window, landing on the hatch the instant it ends", () => {
    const changeTick = 0;

    const start = territoryChangePhase(0, changeTick, 0);
    const mid = territoryChangePhase(15, changeTick, 0);
    const justBeforeEnd = territoryChangePhase(
      TERRITORY_CHANGE_FLASH_DURATION_TICKS - 1,
      changeTick,
      0,
    );
    const atEnd = territoryChangePhase(TERRITORY_CHANGE_FLASH_DURATION_TICKS, changeTick, 0);

    for (const phase of [start, mid, justBeforeEnd]) {
      expect(phase.flashProgress).toBe(0);
      expect(phase.hatchAlpha).toBe(0);
    }
    // The flash has fully settled into the resting fill by the hatch's own first tick — the caller no
    // longer has a flash-blend decision to make, only the hatch's own alpha.
    expect(atEnd.flashProgress).toBeNull();
  });

  /**
   * Required: decay reaches zero exactly at the season boundary. Pinned with more than the two
   * endpoints — a `tick >= boundary ? 0 : PEAK` implementation would pass a boundary-only check, so this
   * also asserts the alpha is still positive one tick before the boundary and strictly decreasing across
   * the window, which only a real linear decay satisfies.
   */
  it("decays the hatch to exactly zero at the season boundary, and nowhere earlier", () => {
    const changeTick = 0;
    const boundary = NATION_TICKS_PER_SEASON;
    const hatchStart = TERRITORY_CHANGE_FLASH_DURATION_TICKS;

    const samples = [hatchStart, hatchStart + 50, hatchStart + 150, boundary - 1].map(
      (tick) => territoryChangePhase(tick, changeTick, 0).hatchAlpha,
    );
    for (const alpha of samples) expect(alpha).toBeGreaterThan(0);
    for (let i = 1; i < samples.length; i += 1) {
      const previous = samples[i - 1];
      const current = samples[i];
      if (previous === undefined || current === undefined) throw new Error("missing sample");
      expect(current).toBeLessThan(previous);
    }
    expect(samples[0]).toBeCloseTo(TERRITORY_CHANGE_HATCH_PEAK_ALPHA, 5);

    expect(territoryChangePhase(boundary, changeTick, 0).hatchAlpha).toBe(0);
    expect(territoryChangePhase(boundary + 1, changeTick, 0).hatchAlpha).toBe(0);
  });

  it("shows no change at all before the change tick or after the season boundary has passed", () => {
    const changeTick = 900; // NATION_TICKS_PER_SEASON * 3, an exact season boundary

    const before = territoryChangePhase(changeTick - 1, changeTick, 0);
    const longAfter = territoryChangePhase(changeTick + NATION_TICKS_PER_SEASON + 1, changeTick, 0);

    expect(before).toEqual({ flashProgress: null, hatchAlpha: 0 });
    expect(longAfter).toEqual({ flashProgress: null, hatchAlpha: 0 });
  });

  /**
   * Required: a multi-cell change staggers rather than firing as one flash. Indices 0 and 1 give
   * strictly different delays (0 and 7 ticks) — 0 and 12 would both give delay 0 and pass vacuously. A
   * broken implementation that ignores `index` (returns the same phase for every cell) fails this: at
   * tick 3, cell 0 has started (it changed at tick 0) and cell 1 has not (its own start is delayed to
   * tick 7), so the two must disagree.
   */
  it("staggers cells with different indices rather than starting them all together", () => {
    const changeTick = 0;
    expect(territoryChangeStagger(0)).toBe(0);
    expect(territoryChangeStagger(1)).toBe(7);

    const cellZero = territoryChangePhase(3, changeTick, 0);
    const cellOne = territoryChangePhase(3, changeTick, 1);

    expect(cellZero.flashProgress).not.toBeNull();
    expect(cellOne.flashProgress).toBeNull();
    expect(cellOne.hatchAlpha).toBe(0);
  });

  it("delays a staggered cell's own window by the same offset, boundary included", () => {
    const changeTick = 0;
    const delay = territoryChangeStagger(1);

    const atUnstaggeredStart = territoryChangePhase(0, changeTick, 1);
    const atStaggeredStart = territoryChangePhase(delay, changeTick, 1);

    expect(atUnstaggeredStart).toEqual({ flashProgress: null, hatchAlpha: 0 });
    expect(atStaggeredStart.flashProgress).toBe(0);
  });

  /**
   * Required: at x8 the compressed lifetimes still complete. The function is stateless, so "compressed"
   * means the caller may jump straight from one broadcast tick to the next without ever being asked for
   * every intermediate tick in between — the renderer must not depend on visiting every frame to reach
   * the correct end state. A single far jump past the boundary must resolve exactly as a step-by-step
   * walk would, with nothing left "stuck" mid-flash or mid-hatch.
   */
  it("resolves correctly when tick jumps straight past the whole window, as x8 compresses it to", () => {
    const changeTick = 0;
    const wayPastTheBoundary = NATION_TICKS_PER_SEASON * 8;

    const jumped = territoryChangePhase(wayPastTheBoundary, changeTick, 5);

    expect(jumped).toEqual({ flashProgress: null, hatchAlpha: 0 });
  });
});
