import type { SendClientMessage } from "../net/wsClient.js";
import type { NationHudState } from "./nationHudState.js";
import { nationKeyCommand } from "./nationHudState.js";

/** The panel half of the §3.5 key map, kept separate because these act on the DOM, not the server. */
export interface NationPanelKeys {
  toggleDirectives: () => void;
  toggleReport: () => void;
  /** Returns true when it closed something, so `Escape` can stop rather than falling through. */
  closeTopPanel: () => boolean;
}

/**
 * The map's own half of the §3.5 key map — kept apart from `NationPanelKeys` because a locate is not a
 * panel: it opens nothing and closes nothing, it pulses the map host directly. A page mounted with no
 * map supplies none, which `bindNationKeys`'s default below turns into a silent no-op rather than a
 * missing-argument error.
 */
export interface NationMapKeys {
  /** "Find my nation" — visual.md §2.6's on-demand locate pulse. */
  locate: () => void;
}

const NO_MAP_KEYS: NationMapKeys = { locate: (): void => undefined };

/**
 * Document-level single-key shortcuts are safe because `index.html` contains no text input, but this
 * bails on an editable target anyway so a later screen that adds one does not have to remember to.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** The keys that act on a panel rather than on the server, so the two halves stay separable. */
export function panelActionForKey(key: string): "close" | "directives" | "report" | null {
  if (key === "Escape") return "close";
  if (key === "d" || key === "D") return "directives";
  if (key === "r" || key === "R") return "report";
  return null;
}

/** The key that acts on the map rather than on a panel or the server. */
export function mapActionForKey(key: string): "locate" | null {
  return key === "l" || key === "L" ? "locate" : null;
}

/**
 * True when the key was consumed. `Escape` reports what it did: with nothing open it consumes nothing,
 * so a later slice can fall through to clearing the map selection without this having swallowed the key.
 */
function runPanelAction(
  action: "close" | "directives" | "report",
  panels: NationPanelKeys,
): boolean {
  if (action === "directives") {
    panels.toggleDirectives();
    return true;
  }
  if (action === "report") {
    panels.toggleReport();
    return true;
  }
  return panels.closeTopPanel();
}

/** A chord or a text field belongs to the page, not to the key map. */
function isForAnotherHandler(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  return isEditableTarget(event.target);
}

/**
 * The §3.5 key map: speeds and pause, `A` for autopilot, `D` for the candidate list, `Escape` to close.
 *
 * At module scope rather than inside the binder because the cognitive-complexity budget counts the
 * nesting of a closure, and the same branches cost half as much unnested.
 */
function handleNationKey(
  event: KeyboardEvent,
  send: SendClientMessage,
  readState: () => NationHudState,
  panels: NationPanelKeys,
  map: NationMapKeys,
): void {
  if (isForAnotherHandler(event)) return;
  const action = panelActionForKey(event.key);
  if (action !== null) {
    if (runPanelAction(action, panels)) event.preventDefault();
    return;
  }
  if (mapActionForKey(event.key) === "locate") {
    map.locate();
    event.preventDefault();
    return;
  }
  const command = nationKeyCommand(event.key, readState());
  if (command === null) return;
  event.preventDefault();
  send(command);
}

/**
 * `Space` is deliberately absent from the map: it is already "activate the cursor cell" on the map canvas
 * and it activates focused buttons, so pause takes `P` instead.
 *
 * `A` sends the opposite of the server's last echo rather than tracking a local mode, so the key and the
 * on-screen toggle can never disagree about which way the nation is running.
 *
 * `L` locates the player's own nation on the map (visual.md §2.6) and is the one key here with nothing to
 * send and no panel to open — `map` defaults to a no-op so a page with no map on screen never needs to
 * pass a fourth argument just to satisfy this one.
 *
 * Returns an unbind, following `bindWorldChronicleEscape`.
 */
export function bindNationKeys(
  send: SendClientMessage,
  readState: () => NationHudState,
  panels: NationPanelKeys,
  map: NationMapKeys = NO_MAP_KEYS,
): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    handleNationKey(event, send, readState, panels, map);
  };

  document.addEventListener("keydown", onKeydown);
  return () => {
    document.removeEventListener("keydown", onKeydown);
  };
}
