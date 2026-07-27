import type { SendClientMessage } from "../net/wsClient.js";
import type { NationHudState } from "./nationHudState.js";
import { speedCommandForKey } from "./nationHudState.js";

/**
 * Document-level single-key shortcuts are safe because `index.html` contains no text input, but this
 * bails on an editable target anyway so a later screen that adds one does not have to remember to.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The speed half of the §3.5 key map. `Space` is deliberately absent: it is already "activate the
 * cursor cell" on the map canvas and it activates focused buttons, so pause takes `P` instead.
 *
 * Returns an unbind, following `bindWorldChronicleEscape`.
 */
export function bindNationSpeedKeys(
  send: SendClientMessage,
  readState: () => NationHudState,
): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    const command = speedCommandForKey(event.key, readState());
    if (command === null) return;
    event.preventDefault();
    send(command);
  };

  document.addEventListener("keydown", onKeydown);
  return () => {
    document.removeEventListener("keydown", onKeydown);
  };
}
