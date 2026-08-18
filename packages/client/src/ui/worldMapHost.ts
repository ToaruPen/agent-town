import type { NationCityState, WorldCellChange, WorldHistory } from "@agent-town/shared";

import { nextSeasonBoundary } from "./worldMapChangeViewModel.js";
import {
  buildWorldMapViewModel,
  polityIdAtWorldMapPosition,
  renderWorldMapCanvas,
  type TrackedTerritoryChange,
  worldMapPositionFromPointer,
} from "./worldMapView.js";

/**
 * Everything the map needs from a payload, and nothing else. `NationWorldState` carries all three, but
 * naming them here keeps the chronicle — which has no nation state at all — able to mount the same
 * surface with an empty city list and no player.
 */
export interface WorldMapSnapshot {
  history: WorldHistory;
  /** `nations.flatMap(({ cities }) => cities)`. Empty means every city draws at the smallest tier. */
  cityStates: readonly NationCityState[];
  playerPolityId: string | null;
  /** The city the docked local view currently shows, or null while it is closed (traversal.md §2.2). */
  openCityId: string | null;
  /** The tick this payload was current as of — the input every phase in `worldMapChangeViewModel.ts` is
   *  a pure function of (visual.md §2.4). */
  tick: number;
  /**
   * This payload's own per-season territory delta (`WorldCellChange`, `nation.ts:127`) — empty for a
   * `clock` heartbeat, which carries none. The host folds each entry into its own accumulator below and
   * never re-derives one by diffing `history` against a previous snapshot, or a coalesced update would
   * silently lose a flash.
   */
  changedCells: readonly WorldCellChange[];
}

export interface WorldMapHostController {
  /** Repaints from a new snapshot, painting whatever is currently hovered — a repaint neither clears nor
   *  artificially preserves a hover, it simply keeps using the live state. The clicked nation is kept
   *  as-is either way; see `selection` below. */
  render(snapshot: WorldMapSnapshot): void;
  /** The last nation clicked, decoupled from hover. Null until something is clicked, and again when a
   *  click lands off any nation. */
  selection(): string | null;
  /**
   * The on-demand "find my nation" pulse (visual.md §2.6): the player's inner rule rises to full alpha
   * and one pixel further out, then settles back, once, over 500 ms. Calling it again before the pulse
   * ends restarts the same 500 ms window rather than stacking a second one.
   */
  locate(): void;
}

export interface WorldMapHostOptions {
  /**
   * The canvas class. Required rather than defaulted because the two surfaces that mount this host are
   * sized by different CSS — the chronicle's canvas fits a panel, the nation page's sits in a docked
   * column — and a shared default would silently restyle whichever one was written second.
   */
  className: string;
  onSelect?: (polityId: string | null) => void;
}

const CANVAS_LABEL = "現存国家、都市、交易路、現在地を示す世界地図";
/** visual.md §2.6: the locate pulse's one-shot span. */
const LOCATE_PULSE_DURATION_MS = 500;

/**
 * The world map's persistent surface: it owns the canvas, the pointer handler and the view-model
 * closure that `mapPanel()` used to own privately.
 *
 * The reason this exists as a host rather than staying inside the chronicle panel is that the chronicle
 * is opened on demand and this map is not. A canvas created inside a panel body is destroyed whenever
 * that body is rebuilt, so its selection and its paint state cannot outlive a repaint of the thing
 * around it — and on the nation page the map is the thing the rest is arranged around.
 *
 * Repainting is driven by `render`, i.e. by the server, not by the pointer. The old handler repainted
 * only on `pointerup`, which meant every value that moves with the clock — a season wash, a border that
 * just changed hands, a city that grew a tier — sat frozen on screen until the player happened to click.
 * A hover still repaints on its own, but only to show or clear the transient highlight — see
 * `hoveredPolityId` below; it never carries any of the values a server `render` does. `render` itself
 * also re-resolves the hover, against the pointer's last position rather than the map it was resolved
 * against last — a server update can hand the hovered cell to a different owner, or take its owner away
 * entirely, without any `pointermove` in between, and §2.2.1 forbids a highlight that lags behind that.
 */
export function createWorldMapHost(
  root: HTMLElement,
  options: WorldMapHostOptions,
): WorldMapHostController {
  // Optional because the nation page has nothing to show for a selection yet; the chronicle does.
  const onSelect = options.onSelect ?? ((): void => undefined);
  const canvas = document.createElement("canvas");
  canvas.className = options.className;
  canvas.setAttribute("aria-label", CANVAS_LABEL);
  root.append(canvas);

  let snapshot: WorldMapSnapshot | null = null;
  // Transient: what the pointer is over right now, drives the 0.52 highlight, cleared the instant the
  // pointer leaves. Decoupled from `clickedPolityId` below — visual.md §2.2.1 made the highlight
  // hover-only, but a click still needs to persist for whichever consumer reads `selection()`.
  let hoveredPolityId: string | null = null;
  // The pointer's own last coordinates, retained while it sits inside the canvas and cleared on
  // `pointerout` alongside `hoveredPolityId` itself. `render` re-resolves the hover against these on
  // every snapshot swap, because §2.2.1's "hover-only, transient" is a claim about the current pointer
  // position — a `pointermove`-only resolution left `hoveredPolityId` stale across a server update that
  // changed the hovered cell's owner without the pointer moving, which is a de facto resting hover.
  let hoverPointerPosition: { clientX: number; clientY: number } | null = null;
  // Persistent: the last nation clicked, unaffected by hover or by a server-driven repaint.
  let clickedPolityId: string | null = null;
  // Territory changes still animating, keyed by cell index (visual.md §2.4). The wire only ever reports
  // a change the instant it happens — every render after that, including a plain `clock` heartbeat with
  // no `changedCells` of its own, must still know when each tracked change started so its flash and
  // hatch keep decaying. Pruned in `updateTrackedTerritoryChanges` once a change's own window closes.
  const territoryChanges = new Map<number, TrackedTerritoryChange>();
  // Wall clock start of the current locate pulse, or null between pulses. Read fresh on every paint —
  // not just from the frame loop below — so a server-driven repaint that happens to land mid-pulse still
  // shows the correct phase instead of one frame behind it.
  let pulseStartedAt: number | null = null;
  // Whether a pulse frame is already queued, so a second `locate()` call while one is still scheduled
  // restarts the deadline without stacking a second `requestAnimationFrame` loop alongside the first.
  let pulseFrameScheduled = false;

  const pulsePhase = (): number | null => {
    if (pulseStartedAt === null) return null;
    const elapsed = Date.now() - pulseStartedAt;
    return elapsed >= LOCATE_PULSE_DURATION_MS ? null : elapsed / LOCATE_PULSE_DURATION_MS;
  };

  /**
   * Folds `next.changedCells` into the accumulator and prunes every entry whose own season boundary the
   * current tick has already reached — run on every `render`, not only one that happens to carry a fresh
   * change, so a tracked change keeps decaying (and eventually clears) across the plain `clock` heartbeats
   * that make up most repaints.
   */
  const updateTrackedTerritoryChanges = (next: WorldMapSnapshot): void => {
    for (const change of next.changedCells) {
      territoryChanges.set(change.index, { polityId: change.polityId, changeTick: next.tick });
    }
    for (const [index, tracked] of territoryChanges) {
      if (next.tick >= nextSeasonBoundary(tracked.changeTick)) territoryChanges.delete(index);
    }
  };

  const paint = (): void => {
    if (snapshot === null) return;
    const view = buildWorldMapViewModel(snapshot.history, snapshot.cityStates, {
      playerPolityId: snapshot.playerPolityId,
      hoveredPolityId,
      pulsePhase: pulsePhase(),
      openCityId: snapshot.openCityId,
      tick: snapshot.tick,
      territoryChanges,
    });
    renderWorldMapCanvas(canvas, view);
  };

  /**
   * The pulse's own frame loop — deliberately not the HUD's `requestAnimationFrame` loop, which belongs
   * to the countdown and runs for the whole session. This one self-schedules only while a pulse is
   * live, and stops itself the instant `pulsePhase` reports the deadline has passed.
   */
  const scheduleNextPulseFrame = (): void => {
    if (pulseFrameScheduled) return;
    pulseFrameScheduled = true;
    requestAnimationFrame(stepPulse);
  };

  function stepPulse(): void {
    pulseFrameScheduled = false;
    const phase = pulsePhase();
    paint();
    if (phase === null) {
      pulseStartedAt = null;
      return;
    }
    scheduleNextPulseFrame();
  }

  /**
   * Resolves the polity under a pointer position straight off the raw map, without building the styled
   * view model — `pointermove` fires dozens of times a second, and paying for banner colours, city
   * glyphs and territory edges just to hit-test a cell would be wasted work on every one of them.
   */
  const polityAtPointer = (clientX: number, clientY: number): string | null => {
    if (snapshot === null) return null;
    const { worldMap } = snapshot.history;
    const pos = worldMapPositionFromPointer(
      worldMap,
      canvas.getBoundingClientRect(),
      clientX,
      clientY,
    );
    return pos === null ? null : polityIdAtWorldMapPosition(worldMap, pos);
  };

  // Re-resolves `hoveredPolityId` against the current `snapshot` from the pointer's last known
  // position, rather than trusting whatever it was set to last. `render` calls this on every snapshot
  // swap so a server update that changes the hovered cell's owner is reflected immediately, without
  // waiting on a `pointermove` that may never come if the cursor sits still.
  const resolveHover = (): void => {
    hoveredPolityId =
      hoverPointerPosition === null
        ? null
        : polityAtPointer(hoverPointerPosition.clientX, hoverPointerPosition.clientY);
  };

  canvas.addEventListener("pointermove", (event) => {
    if (snapshot === null) return;
    hoverPointerPosition = { clientX: event.clientX, clientY: event.clientY };
    const next = polityAtPointer(event.clientX, event.clientY);
    if (next === hoveredPolityId) return;
    hoveredPolityId = next;
    paint();
  });

  // `pointerout` fires whenever the pointer leaves the canvas, including onto a child element; there is
  // no resting hover, so this always clears — both the resolved polity and the position `render` would
  // otherwise re-resolve against — rather than keeping a position that no longer describes where the
  // pointer is.
  canvas.addEventListener("pointerout", () => {
    hoverPointerPosition = null;
    if (snapshot === null || hoveredPolityId === null) return;
    hoveredPolityId = null;
    paint();
  });

  // The click channel is unrelated to the highlight above: it answers "which nation did the player ask
  // to read about" (the chronicle's detail card), and it persists across a repaint on purpose.
  canvas.addEventListener("pointerup", (event) => {
    if (snapshot === null) return;
    clickedPolityId = polityAtPointer(event.clientX, event.clientY);
    onSelect(clickedPolityId);
  });

  return {
    render(next: WorldMapSnapshot): void {
      snapshot = next;
      updateTrackedTerritoryChanges(next);
      resolveHover();
      paint();
    },

    selection(): string | null {
      return clickedPolityId;
    },

    locate(): void {
      pulseStartedAt = Date.now();
      scheduleNextPulseFrame();
    },
  };
}
