import type { CityViewPanelController } from "./cityViewPanel.js";
import type { CityViewTarget } from "./cityViewTarget.js";

export interface CityViewSyncController {
  /**
   * Drives the panel from the latest resolved target (or null while nothing resolves). Three cases:
   *  - no target while something is shown → the nation died; the panel closes for real (fires
   *    `onClose`, so the world-view locate pulse fires — this is a genuine local→world transition,
   *    not a player choice) and the closed-city suppression clears, so a respawn can reopen.
   *  - a target whose city id differs from what is currently shown → open (covers both the first
   *    open and a switch, e.g. reconnecting as a different nation). Keying on identity rather than the
   *    panel's own redraw fingerprint matters here: two different cities can share a season and
   *    building count (bootstrap nations commonly do), where a fingerprint-only gate would silently
   *    keep painting the old city under the new one's chrome.
   *  - the same city id as what is shown → update.
   * A city the player explicitly closed (see `notifyClosed`) is skipped until its target actually
   * changes identity — matching the panel's own close button, which must stay meaningful rather than
   * being overridden by the next server broadcast a moment later.
   */
  sync(target: CityViewTarget | null): void;
  /**
   * Call this from the panel's own `onClose` (e.g. its × button) so `sync` can tell "the player closed
   * it" apart from "I closed it because the target vanished" — the latter must not suppress a later
   * respawn. Re-entrant calls triggered by `sync`'s own `close()` are ignored; see the internal guard.
   */
  notifyClosed(): void;
  /** The city id currently shown, or null while closed. */
  shownCityId(): string | null;
}

/**
 * Wraps a `CityViewPanelController` with the identity tracking main.ts's `paintCityView` needs but the
 * panel itself has no business knowing — the panel only ever draws whatever scene it is handed, it does
 * not know whether that scene is the same city as last time. Kept as its own pure-ish module (no DOM,
 * no socket) rather than inlined into `main.ts`'s closure specifically so this decision logic — which
 * target state calls open/update/close — is unit-testable without mounting the whole page.
 */
export function createCityViewSync(panel: CityViewPanelController): CityViewSyncController {
  // The id currently painted, or null while closed.
  let shownCityId: string | null = null;
  // The id the *player* closed, or null. Distinct from `shownCityId` being null: a vanished target
  // also leaves `shownCityId` null but must not set this, or a respawn would stay suppressed forever.
  let closedCityId: string | null = null;
  // Set only around `sync`'s own `panel.close()` call, so the `onClose` it triggers can tell that this
  // close did not come from the player — see `notifyClosed`.
  let closingProgrammatically = false;

  return {
    sync(target): void {
      if (target === null) {
        if (shownCityId !== null) {
          // Cleared before close(), not after: the real panel's close() invokes its onClose
          // synchronously, and main.ts's onClose reads shownCityId() to repaint the map's "open
          // city" mark before returning here. Clearing it first means that nested repaint already
          // sees "nothing open" rather than the city that is, at that instant, in the middle of
          // being torn down.
          shownCityId = null;
          closingProgrammatically = true;
          panel.close();
          closingProgrammatically = false;
        }
        // The city the player closed no longer exists either way — nothing left to suppress.
        closedCityId = null;
        return;
      }
      const cityId = target.scene.city.id;
      if (cityId === closedCityId) return;
      if (cityId === shownCityId) {
        panel.update(target);
        return;
      }
      panel.open(target);
      shownCityId = cityId;
      closedCityId = null;
    },

    notifyClosed(): void {
      if (closingProgrammatically) return;
      closedCityId = shownCityId;
      shownCityId = null;
    },

    shownCityId(): string | null {
      return shownCityId;
    },
  };
}
