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
function submitButton(
  card: DirectiveCardViewModel,
  canSend: boolean,
  send: SendClientMessage,
): HTMLButtonElement {
  const submittable = card.canSubmit && canSend;
  const button = element(
    "button",
    "directive-panel__submit",
    submittable ? "発令する" : "発令不可",
  );
  button.type = "button";
  button.setAttribute(CARD_KEY_ATTRIBUTE, card.key);
  button.setAttribute("aria-label", card.accessibleName);
  if (!submittable) button.setAttribute("aria-disabled", "true");
  button.addEventListener("click", () => {
    if (!submittable) return;
    send(issueDirectiveCommand(card.kind, card.targetCityId));
  });
  return button;
}

function cardItem(
  card: DirectiveCardViewModel,
  canSend: boolean,
  send: SendClientMessage,
): HTMLElement {
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
  item.append(submitButton(card, canSend, send));
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
  if (view.sendNotice !== null) {
    // Its own banner, not the refusal's: this one is the client admitting it cannot ask, which is a
    // different thing from the server having answered no.
    const notice = element("p", "directive-panel__offline", view.sendNotice);
    notice.setAttribute("role", "alert");
    body.push(notice);
  }
  const list = element("ul", "directive-panel__options");
  list.append(...view.cards.map((card) => cardItem(card, view.canSend, send)));
  body.push(list);
  return body;
}

/**
 * A CSS selector that can find a freshly rebuilt stand-in for `node`, when it carries the single stable
 * class every node this codebase builds via `element()` (worldChronicle.ts) gets — e.g. the dashboard's
 * own "施策を選ぶ" button, class `nation-dashboard__choose`, which `nationHud.renderPanels()` rebuilds
 * wholesale on every `applyOrders`/`applyUpdate`, including while this panel sits open mid-decision.
 * `null` when the node has no class to key off (a bare test fixture, `document.body`), in which case a
 * stale reference just stays stale — there is nothing left to re-resolve by.
 *
 * Assumes the class is unique enough on the page that the first match is the right one, matching the
 * hardcoded `STRIP_TOGGLE_SELECTOR` lookup `seasonReportPanel.ts` already does for the same reason.
 */
function stableSelectorFor(node: HTMLElement): string | null {
  const className = node.classList[0];
  return className === undefined ? null : `.${className}`;
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
  /** Captured by `toggle()` when it opens the panel; consumed and cleared when it closes. */
  let opener: { readonly element: HTMLElement; readonly selector: string | null } | null = null;

  const paint = (): void => {
    root.hidden = !open;
    if (!open || latest === null) return;
    const focused = focusedCardKey(root);
    root.replaceChildren(...panelBody(latest, send));
    restoreFocus(root, focused);
  };

  /**
   * hud.md §3.5: closing a panel returns focus to whatever opened it.
   *
   * The raw captured element goes stale whenever whatever rebuilds it does so while this panel is still
   * open — most commonly the dashboard's "施策を選ぶ" button: submitting a directive without closing the
   * panel triggers the `orders` echo, which rebuilds the dashboard before the player gets around to
   * closing this panel. `opener.selector` re-resolves against the live document in that case. Failing
   * that (no selector, or nothing matches — the opener was genuinely removed, not just rebuilt), this is
   * a no-op rather than focusing something arbitrary.
   */
  const returnFocusToOpener = (): void => {
    if (opener !== null) {
      const target = opener.element.isConnected
        ? opener.element
        : opener.selector === null
          ? null
          : document.querySelector<HTMLElement>(opener.selector);
      target?.focus();
    }
    opener = null;
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
      const opening = !open;
      if (opening) {
        const active = document.activeElement;
        opener =
          active instanceof HTMLElement
            ? { element: active, selector: stableSelectorFor(active) }
            : null;
      }
      open = opening;
      renderedKey = null;
      paint();
      if (!opening) returnFocusToOpener();
    },

    close(): void {
      if (!open) return;
      open = false;
      renderedKey = null;
      paint();
      returnFocusToOpener();
    },

    isOpen(): boolean {
      return open;
    },
  };
}
