import type { SendClientMessage } from "../net/wsClient.js";
import type { DirectiveCardViewModel, DirectiveListViewModel } from "./directiveViewModel.js";
import { meter } from "./nationDom.js";
import { issueDirectiveCommand } from "./nationHudState.js";
import { element } from "./worldChronicle.js";

export interface DirectivePanelController {
  render(view: DirectiveListViewModel | null, generation: number): void;
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

const CARD_KEY_ATTRIBUTE = "data-directive-key";

/**
 * The submit control, present on blocked options too.
 *
 * `aria-disabled` rather than `disabled` is the whole point: `disabled` would drop the option out of the
 * tab order and take the explanation with it, which is the one thing §3.4 exists to prevent. The click
 * handler therefore has to refuse by itself — a blocked card is reachable, readable, and inert.
 */
function submitButton(card: DirectiveCardViewModel, send: SendClientMessage): HTMLButtonElement {
  const button = element(
    "button",
    "directive-panel__submit",
    card.canSubmit ? "発令する" : "発令不可",
  );
  button.type = "button";
  button.setAttribute(CARD_KEY_ATTRIBUTE, card.key);
  button.setAttribute("aria-label", card.accessibleName);
  if (!card.canSubmit) button.setAttribute("aria-disabled", "true");
  button.addEventListener("click", () => {
    if (!card.canSubmit) return;
    send(issueDirectiveCommand(card.kind, card.targetCityId));
  });
  return button;
}

function cardItem(card: DirectiveCardViewModel, send: SendClientMessage): HTMLElement {
  const item = element("li", "directive-panel__option");
  if (!card.canSubmit) item.classList.add("directive-panel__option--blocked");

  const header = element("p", "directive-panel__header");
  header.append(
    element("span", "directive-panel__name", card.label),
    element("span", "directive-panel__duration", card.durationLabel),
    element("span", "directive-panel__affinity-label", card.affinityLabel),
  );

  item.append(header, element("p", "directive-panel__cost", card.costLabel));
  item.append(meter("directive-panel__affinity", card.affinityRatio, card.affinityNote));
  item.append(element("p", "directive-panel__note", card.affinityNote));
  if (card.isChancellorChoice) {
    item.append(element("p", "directive-panel__star", "★宰相の推奨"));
  }
  if (card.blockedText !== null) {
    item.append(element("p", "directive-panel__blocked", card.blockedText));
  }
  item.append(submitButton(card, send));
  return item;
}

/** The key of the focused card, so a rebuild at a season boundary does not eject the player's focus. */
function focusedCardKey(root: HTMLElement): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
  return active.getAttribute(CARD_KEY_ATTRIBUTE);
}

function restoreFocus(root: HTMLElement, key: string | null): void {
  if (key === null) return;
  const target = root.querySelector(`[${CARD_KEY_ATTRIBUTE}="${key}"]`);
  if (target instanceof HTMLElement) target.focus();
}

function panelBody(view: DirectiveListViewModel, send: SendClientMessage): HTMLElement[] {
  const body: HTMLElement[] = [
    element("h2", "directive-panel__title", "施策を選ぶ"),
    element("p", "directive-panel__mode", view.autoPilotLabel),
    element("p", "directive-panel__mode-description", view.autoPilotDescription),
  ];
  if (view.refusal !== null) {
    // A live region rather than plain text: at speed 0 nothing else on screen changes when an order is
    // refused, so a sighted-only banner would be the whole feedback for half the audience.
    const refusal = element("p", "directive-panel__refusal", view.refusal);
    refusal.setAttribute("role", "alert");
    body.push(refusal);
  }
  const list = element("ul", "directive-panel__options");
  list.append(...view.cards.map((card) => cardItem(card, send)));
  body.push(list);
  return body;
}

/**
 * The order desk's candidate list. Opened on demand (`D`) and rebuilt only when the server sends a new
 * `orders`, which is once a season plus once per action — never on the countdown's frame loop.
 */
export function createDirectivePanel(
  root: HTMLElement,
  send: SendClientMessage,
): DirectivePanelController {
  let renderedKey: string | null = null;
  let open = false;
  let latest: DirectiveListViewModel | null = null;

  const paint = (): void => {
    root.hidden = !open;
    if (!open || latest === null) return;
    const focused = focusedCardKey(root);
    root.replaceChildren(...panelBody(latest, send));
    restoreFocus(root, focused);
  };

  return {
    render(view: DirectiveListViewModel | null, generation: number): void {
      const nextKey = `${generation}:${open}:${JSON.stringify(view)}`;
      if (nextKey === renderedKey) return;
      renderedKey = nextKey;
      latest = view;
      paint();
    },

    toggle(): void {
      open = !open;
      renderedKey = null;
      paint();
    },

    close(): void {
      if (!open) return;
      open = false;
      renderedKey = null;
      paint();
    },

    isOpen(): boolean {
      return open;
    },
  };
}
