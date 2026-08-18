import type { NationCityState, WorldCity } from "@agent-town/shared";
import { describe, expect, it, vi } from "vitest";

import type { CityViewPanelController, CityViewPanelInput } from "../src/local/cityViewPanel.js";
import { createCityViewSync } from "../src/local/cityViewSync.js";
import type { CityViewTarget } from "../src/local/cityViewTarget.js";
import { historyFixture, nationFixture, polityFixture } from "./nationFixture.js";

/**
 * `createCityViewSync` only ever reads `target.scene.city.id` — everything else on the scene passes
 * through to the panel untouched — so this fixture only needs a real `city.id` and otherwise-valid
 * shape, not simulation realism (contrast `cityViewPanelPanel.test.ts`'s fixtures, which do need it).
 */
function makeTarget(cityId: string): CityViewTarget {
  const polity = polityFixture();
  const cityState: NationCityState = { cityId, population: 4000, developmentLevel: 3 };
  const city: WorldCity = {
    id: cityId,
    name: "府",
    pos: { x: 0, y: 0 },
    polityId: polity.id,
    isCapital: true,
    foundedByEventId: "event-1",
  };
  const history = historyFixture([polity]);
  return {
    scene: {
      city,
      cityState,
      nation: nationFixture({ cities: [cityState] }),
      polity,
      worldMap: history.worldMap,
      tick: 0,
    },
    bannerColor: "#a1b2c3",
  };
}

/** A fake panel whose `close()` optionally fires a caller-supplied `onClose`, mirroring how the real
 *  `createCityViewPanel` synchronously invokes `options.onClose` from inside `close()` — that coupling
 *  is exactly what `notifyClosed()`'s re-entrancy guard has to survive. */
function makePanel(onClose?: () => void): CityViewPanelController & {
  open: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  let open = false;
  const openFn = vi.fn((_input: CityViewPanelInput) => {
    open = true;
  });
  const updateFn = vi.fn((_input: CityViewPanelInput) => undefined);
  const closeFn = vi.fn(() => {
    if (!open) return;
    open = false;
    onClose?.();
  });
  return {
    open: openFn,
    update: updateFn,
    close: closeFn,
    isOpen: () => open,
  };
}

describe("createCityViewSync", () => {
  it("opens on the first target and never calls update before an open", () => {
    const panel = makePanel();
    const sync = createCityViewSync(panel);

    sync.sync(makeTarget("city-a"));

    expect(panel.open).toHaveBeenCalledTimes(1);
    expect(panel.update).not.toHaveBeenCalled();
    expect(sync.shownCityId()).toBe("city-a");
  });

  it("updates, not opens, on repeated syncs for the same city", () => {
    const panel = makePanel();
    const sync = createCityViewSync(panel);

    sync.sync(makeTarget("city-a"));
    sync.sync(makeTarget("city-a"));
    sync.sync(makeTarget("city-a"));

    expect(panel.open).toHaveBeenCalledTimes(1);
    expect(panel.update).toHaveBeenCalledTimes(2);
  });

  it("opens the new city (not update) when the target's identity changes, even with an equal redraw key", () => {
    // The bug this guards: bootstrap nations can share season and buildings.length, so a naive
    // key-based gate would have let a nation switch silently keep painting the old city.
    const panel = makePanel();
    const sync = createCityViewSync(panel);

    sync.sync(makeTarget("city-a"));
    sync.sync(makeTarget("city-b"));

    expect(panel.open).toHaveBeenCalledTimes(2);
    expect(panel.update).not.toHaveBeenCalled();
    expect(sync.shownCityId()).toBe("city-b");
  });

  it("closes and fires the real transition when the target vanishes (nation death)", () => {
    const onClose = vi.fn();
    const panel = makePanel(onClose);
    const sync = createCityViewSync(panel);

    sync.sync(makeTarget("city-a"));
    sync.sync(null);

    expect(panel.close).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sync.shownCityId()).toBeNull();

    // A second null sync while already closed must not call close() again.
    sync.sync(null);
    expect(panel.close).toHaveBeenCalledTimes(1);
  });

  it("has already cleared shownCityId by the time the vanished-target close's onClose fires", () => {
    // The real panel's close() invokes onClose synchronously (see makePanel's comment above), and
    // main.ts's onClose reads sync.shownCityId() to repaint the world map's "open city" mark
    // (traversal.md §2.2) before the caller's own paintMap() runs again. If shownCityId were still
    // set to the dead city while onClose is running, that nested repaint would mark a city that no
    // longer exists as open — a one-frame wrong state that happens to get papered over only because
    // every caller of paintCityView() also calls paintMap() again right after.
    let shownDuringClose: string | null | undefined;
    const onClose = vi.fn(() => {
      shownDuringClose = sync.shownCityId();
    });
    const panel = makePanel(onClose);
    const sync = createCityViewSync(panel);

    sync.sync(makeTarget("city-a"));
    sync.sync(null);

    expect(shownDuringClose).toBeNull();
  });

  it("stays closed after the player closes the panel, for the same city", () => {
    const onClose = vi.fn(() => sync.notifyClosed());
    const panel = makePanel(onClose);
    const sync = createCityViewSync(panel);

    sync.sync(makeTarget("city-a"));
    panel.close(); // simulates the panel's own × button, which fires onClose synchronously

    sync.sync(makeTarget("city-a"));
    sync.sync(makeTarget("city-a"));

    expect(panel.open).toHaveBeenCalledTimes(1); // only the original open — no reopen
    expect(panel.update).not.toHaveBeenCalled();
    expect(sync.shownCityId()).toBeNull();
  });

  it("reopens for a different city after the player closed a previous one (nation switch)", () => {
    const onClose = vi.fn(() => sync.notifyClosed());
    const panel = makePanel(onClose);
    const sync = createCityViewSync(panel);

    sync.sync(makeTarget("city-a"));
    panel.close(); // player closes city-a
    const cityB = makeTarget("city-b"); // a different nation is now held
    sync.sync(cityB);

    expect(panel.open).toHaveBeenCalledTimes(2);
    expect(panel.open).toHaveBeenLastCalledWith(cityB);
    expect(sync.shownCityId()).toBe("city-b");
  });

  it("reopens after a nation dies and respawns, even as the same city id", () => {
    const panel = makePanel();
    const sync = createCityViewSync(panel);

    sync.sync(makeTarget("city-a"));
    sync.sync(null); // nation died — `sync` itself closes it, not the player
    sync.sync(makeTarget("city-a")); // respawned with the same capital id

    expect(panel.open).toHaveBeenCalledTimes(2);
    expect(sync.shownCityId()).toBe("city-a");
  });

  it("does not mistake sync's own vanished-target close for a player close", () => {
    // The re-entrancy guard: `sync`'s close() for a vanished target fires the same onClose the panel's
    // × button would, so without the guard this would incorrectly suppress the respawn below.
    const onClose = vi.fn(() => sync.notifyClosed());
    const panel = makePanel(onClose);
    const sync = createCityViewSync(panel);

    sync.sync(makeTarget("city-a"));
    sync.sync(null);
    sync.sync(makeTarget("city-a"));

    expect(panel.open).toHaveBeenCalledTimes(2);
    expect(sync.shownCityId()).toBe("city-a");
  });
});
