import type { NationCityState, WorldHistory } from "@agent-town/shared";

import {
  buildWorldMapViewModel,
  polityIdAtWorldMapPosition,
  renderWorldMapCanvas,
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
}

export interface WorldMapHostController {
  /** Repaints from a new snapshot, keeping whatever the player has selected. */
  render(snapshot: WorldMapSnapshot): void;
  /** Null until something is selected, and again when a click lands off any nation. */
  selection(): string | null;
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
  let selectedPolityId: string | null = null;

  const paint = (): void => {
    if (snapshot === null) return;
    const view = buildWorldMapViewModel(snapshot.history, selectedPolityId, snapshot.cityStates, {
      playerPolityId: snapshot.playerPolityId,
    });
    renderWorldMapCanvas(canvas, view);
  };

  canvas.addEventListener("pointerup", (event) => {
    if (snapshot === null) return;
    // Rebuilt rather than cached: the snapshot behind it may have changed under the pointer since the
    // last paint, and hit-testing a stale view model would select whoever used to own the cell.
    const view = buildWorldMapViewModel(snapshot.history, selectedPolityId, snapshot.cityStates, {
      playerPolityId: snapshot.playerPolityId,
    });
    const pos = worldMapPositionFromPointer(
      view,
      canvas.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    selectedPolityId = pos === null ? null : polityIdAtWorldMapPosition(view, pos);
    paint();
    onSelect(selectedPolityId);
  });

  return {
    render(next: WorldMapSnapshot): void {
      snapshot = next;
      paint();
    },

    selection(): string | null {
      return selectedPolityId;
    },
  };
}
