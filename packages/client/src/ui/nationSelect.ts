import type { NationState, WorldHistory } from "@agent-town/shared";

import type { SendClientMessage } from "../net/wsClient.js";
import { element } from "./nationDom.js";
import { selectNationCommand } from "./nationHudState.js";

export interface NationSelectController {
  render(nations: readonly NationState[], history: WorldHistory | null): void;
}

/**
 * The start-of-game nation picker, kept to a plain button list.
 *
 * A fresh connection arrives with `playerNationId === null` — measured against the live server, not
 * assumed — and the server only learns which nation is the player's when the client asks. Without this
 * the dashboard has no nation to draw and would never appear at all.
 *
 * The 国柄 cards and the map-based selection the design wants belong to a later slice; this is the
 * minimum that makes the rest of the HUD reachable.
 */
export function createNationSelect(
  root: HTMLElement,
  send: SendClientMessage,
): NationSelectController {
  let renderedKey: string | null = null;

  return {
    render(nations: readonly NationState[], history: WorldHistory | null): void {
      const nextKey = nations.map(({ id }) => id).join(",");
      if (nextKey === renderedKey) return;
      renderedKey = nextKey;

      if (nations.length === 0) {
        root.replaceChildren();
        root.hidden = true;
        return;
      }

      const names = new Map((history?.polities ?? []).map(({ id, name }) => [id, name] as const));
      const list = element("ul", "nation-select__options");
      for (const nation of nations) {
        const button = element(
          "button",
          "nation-select__option",
          names.get(nation.id) ?? nation.id,
        );
        button.type = "button";
        button.addEventListener("click", () => {
          send(selectNationCommand(nation.id));
        });
        const item = element("li", "nation-select__item");
        item.append(button);
        list.append(item);
      }

      root.hidden = false;
      root.replaceChildren(element("h2", "nation-select__title", "治める国を選んでください"), list);
    },
  };
}
