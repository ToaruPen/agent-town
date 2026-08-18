import { element } from "./worldChronicle.js";

/**
 * A bar the player reads as a proportion. Native `<progress>` so it carries its own semantics, with
 * `aria-valuetext` giving the figure in words — the convention `createNeedsList` already established.
 */
export function meter(className: string, ratio: number, valueText: string): HTMLProgressElement {
  const bar = element("progress", className);
  bar.max = 1;
  bar.value = Math.min(Math.max(ratio, 0), 1);
  bar.setAttribute("aria-valuetext", valueText);
  return bar;
}

/**
 * How to re-find a freshly rebuilt stand-in for the node a `CapturedOpenerSelector` was taken from.
 *
 * `"id"`: the node had its own `id` (rare — `worldChronicle.ts`'s tab/panel elements, `#inspect-panel-name`
 * — but page-unique and unambiguous by construction; nothing else needs checking).
 *
 * `"scoped"`: the common case — a plain `element()`-built node with a class but no `id` of its own, e.g.
 * the dashboard's "施策を選ぶ" button. `scopeId` is the `id` of the nearest ANCESTOR that has one — every
 * root `main.ts` looks up (`#nation-dashboard`, `#directive-panel`, …) carries one, and none of them are
 * ever torn down and replaced wholesale the way their children are, so this stays reliable across a
 * rebuild. `className` narrows the search to that scope; `dataKey`, when the node carries a `data-*`
 * attribute (`directivePanel.ts`'s `data-directive-key` is the only one today), narrows further to the
 * *specific* same-class sibling — required because a class is not always a singleton within its scope
 * (one `.directive-panel__submit` exists per card). Without a `dataKey`, resolution only succeeds if the
 * class turns out to be the only match in scope; guessing the first of several is exactly the bug this
 * replaced (a rebuilt-and-refocused submit control could otherwise land on an unrelated card).
 */
type CapturedOpenerSelector =
  | { readonly kind: "id"; readonly id: string }
  | {
      readonly kind: "scoped";
      readonly scopeId: string;
      readonly className: string;
      readonly dataKey: { readonly name: string; readonly value: string } | null;
    };

/**
 * Captures how to re-find `node` later, when it carries either its own `id` or a class inside an
 * identifiable ancestor (see `CapturedOpenerSelector`). `null` when neither is available (a bare test
 * fixture, `document.body`) — a stale reference then just stays stale, there is nothing to re-resolve by.
 */
function captureOpenerSelector(node: HTMLElement): CapturedOpenerSelector | null {
  if (node.id !== "") return { kind: "id", id: node.id };

  const scope = node.closest<HTMLElement>("[id]");
  const className = node.classList[0];
  if (scope === null || className === undefined) return null;

  const dataAttribute = [...node.attributes].find((attribute) =>
    attribute.name.startsWith("data-"),
  );
  return {
    kind: "scoped",
    scopeId: scope.id,
    className,
    dataKey:
      dataAttribute === undefined ? null : { name: dataAttribute.name, value: dataAttribute.value },
  };
}

function resolveOpenerSelector(selector: CapturedOpenerSelector): HTMLElement | null {
  if (selector.kind === "id") return document.getElementById(selector.id);

  const scope = document.getElementById(selector.scopeId);
  if (scope === null) return null;
  const candidates = [...scope.getElementsByClassName(selector.className)].filter(
    (candidate): candidate is HTMLElement => candidate instanceof HTMLElement,
  );
  if (selector.dataKey === null) return candidates.length === 1 ? (candidates[0] ?? null) : null;
  const { name, value } = selector.dataKey;
  return candidates.find((candidate) => candidate.getAttribute(name) === value) ?? null;
}

/** A captured opener (hud.md §3.5): the raw node, plus a fallback to re-find it by if a rebuild detaches it. */
export interface CapturedOpener {
  readonly element: HTMLElement;
  readonly selector: CapturedOpenerSelector | null;
}

/** Builds the `selector` half of a `CapturedOpener` from the node being captured. */
export function captureOpener(node: HTMLElement): CapturedOpener {
  return { element: node, selector: captureOpenerSelector(node) };
}

/**
 * Resolves a captured opener (hud.md §3.5) to a live, focusable node: the raw reference if a rebuild
 * elsewhere on the page has not detached it, otherwise a fresh match for its `CapturedOpenerSelector`,
 * otherwise `null` — the opener was genuinely removed from the page, not just rebuilt, and there is
 * nothing sensible left to focus. Shared by `directivePanel.ts` and `seasonReportPanel.ts` rather than
 * duplicated: both panels face the identical staleness once an opener is captured as a raw node.
 */
export function resolveOpener(opener: CapturedOpener): HTMLElement | null {
  if (opener.element.isConnected) return opener.element;
  return opener.selector === null ? null : resolveOpenerSelector(opener.selector);
}
