import type {
  NationCityState,
  NationState,
  Season,
  WorldCellChange,
  WorldHistory,
} from "@agent-town/shared";

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
  /** Every living nation's own state — visual.md §2.4's construction-progress arc reads a city's
   *  `activeDirectives` from its own owning nation here. Empty means no city ever shows an arc. */
  nations: readonly NationState[];
  /** The season this payload is current as of — what the layer-2 wash paints, and what the host
   *  compares against its own last-seen season to decide whether a crossfade should start. Null for a
   *  surface with no live season to report (the chronicle's static archive mount); the wash draws
   *  nothing rather than the host inventing one. */
  season: Season | null;
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
/** visual.md §2.4: the season boundary's own whole-map crossfade span. */
const SEASON_CROSSFADE_DURATION_MS = 600;

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
  // The ownership fact the flash and hatch above are only ever a temporary treatment *of* — kept
  // deliberately separate from `territoryChanges`, which forgets a change the instant its own animation
  // window closes. `history.worldMap.cells` only refreshes on a fresh `welcome`, so without a record of
  // its own the host would paint (and hit-test) a cell against its pre-change owner the moment the
  // animation accumulator prunes the entry — the flash would have been a lie about what actually
  // happened. Each entry is a delta applied from the wire's own `WorldCellChange` the instant it arrives,
  // never a diff of two snapshots, and it is never pruned by a season boundary — only `updateLiveOwnership`
  // below ever clears it, and only when a fresh `history` says the accumulated deltas no longer apply.
  const liveOwnership = new Map<number, string | null>();
  // The `history` reference `liveOwnership` was last folded against. `wsClient.ts` never reassigns
  // `NationWorldState.history` on a `clock` or `season` message, only a fresh `welcome` does — so a
  // changed reference here means a reconnect handed the host a new authoritative snapshot, and every
  // delta accumulated against the old one is stale.
  let lastHistory: WorldHistory | null = null;
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

  // The season crossfade's own state — deliberately not shared with the locate pulse's above, even
  // though the shape rhymes: the two animate different things on different schedules, and sharing a
  // deadline field between them would let a change to one animation's timing silently retime the other.
  // `lastSeason` tracks the same nullable season `WorldMapSnapshot.season` carries, so a surface with no
  // live season (null on every render) can never satisfy the "changed" half of the trigger below.
  let lastSeason: Season | null = null;
  let crossfadeFromSeason: Season | null = null;
  let crossfadeStartedAt: number | null = null;
  let crossfadeFrameScheduled = false;

  const crossfadePhase = (): number | null => {
    if (crossfadeStartedAt === null) return null;
    const elapsed = Date.now() - crossfadeStartedAt;
    return elapsed >= SEASON_CROSSFADE_DURATION_MS ? null : elapsed / SEASON_CROSSFADE_DURATION_MS;
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

  /**
   * Clears every accumulated delta the moment `next.history` is a different object than the one they
   * were folded against, then folds `next.changedCells` into what remains. Run before `resolveOwnership`
   * on every `render`, so a reconnect's fresh `welcome` — which never carries a `changedCells` of its own
   * to imply a reset — still drops whatever the previous connection had accumulated.
   */
  const updateLiveOwnership = (next: WorldMapSnapshot): void => {
    if (next.history !== lastHistory) liveOwnership.clear();
    lastHistory = next.history;
    for (const change of next.changedCells) liveOwnership.set(change.index, change.polityId);
  };

  /**
   * `history.worldMap` with every entry `liveOwnership` currently overrides. Handing this resolved
   * history to `buildWorldMapViewModel` and reusing it for hit-testing below, rather than patching cell
   * fill and edge extraction and hover and hit-testing separately, is what keeps paint and hit-test from
   * ever being able to disagree about who a cell belongs to right now — they read the same object. Returns
   * `history` unchanged when there is nothing to override, which is the common case for a game with no
   * live territory activity at all.
   */
  const resolveOwnership = (history: WorldHistory): WorldHistory => {
    if (liveOwnership.size === 0) return history;
    const cells = history.worldMap.cells.map((cell, index) => {
      const owner = liveOwnership.get(index);
      return owner === undefined ? cell : { ...cell, polityId: owner };
    });
    return { ...history, worldMap: { ...history.worldMap, cells } };
  };

  const paint = (): void => {
    if (snapshot === null) return;
    const crossfade = crossfadePhase();
    const view = buildWorldMapViewModel(snapshot.history, snapshot.cityStates, {
      playerPolityId: snapshot.playerPolityId,
      hoveredPolityId,
      pulsePhase: pulsePhase(),
      openCityId: snapshot.openCityId,
      tick: snapshot.tick,
      territoryChanges,
      nations: snapshot.nations,
      seasonWash: {
        season: snapshot.season,
        previousSeason: crossfade === null ? null : crossfadeFromSeason,
        crossfadeProgress: crossfade,
      },
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

  /** The crossfade's own frame loop — see `scheduleNextPulseFrame`'s comment for why this is a
   *  duplicate of that loop rather than a shared one. */
  const scheduleNextCrossfadeFrame = (): void => {
    if (crossfadeFrameScheduled) return;
    crossfadeFrameScheduled = true;
    requestAnimationFrame(stepCrossfade);
  };

  function stepCrossfade(): void {
    crossfadeFrameScheduled = false;
    const phase = crossfadePhase();
    paint();
    if (phase === null) {
      crossfadeStartedAt = null;
      crossfadeFromSeason = null;
      return;
    }
    scheduleNextCrossfadeFrame();
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
      // `lastSeason !== null` excludes the very first render: there is no "previous" season to fade
      // from yet, only a resting one to start on — a crossfade there would flash the wash in from
      // nothing rather than simply showing it. `next.season !== null` excludes a surface with no live
      // season at all (the chronicle) from ever starting a crossfade toward nothing to draw.
      if (lastSeason !== null && next.season !== null && lastSeason !== next.season) {
        crossfadeFromSeason = lastSeason;
        crossfadeStartedAt = Date.now();
        scheduleNextCrossfadeFrame();
      }
      lastSeason = next.season;
      updateLiveOwnership(next);
      // `updateTrackedTerritoryChanges` reads `next.changedCells`/`next.tick` — unaffected by which
      // `history` `snapshot` ends up holding, so it takes the original `next`, not the resolved copy.
      updateTrackedTerritoryChanges(next);
      snapshot = { ...next, history: resolveOwnership(next.history) };
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
