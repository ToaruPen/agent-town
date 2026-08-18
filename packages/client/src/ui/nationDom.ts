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
 * A CSS selector that can find a freshly rebuilt stand-in for `node`, when it carries the single stable
 * class every node this codebase builds via `element()` (worldChronicle.ts) gets — e.g. the dashboard's
 * own "施策を選ぶ" button, class `nation-dashboard__choose`, which `nationHud.renderPanels()` rebuilds
 * wholesale on every `applyOrders`/`applyUpdate`. Used by `directivePanel.ts` and `seasonReportPanel.ts`
 * to re-resolve an opener that a rebuild elsewhere on the page detached while a panel sat open (hud.md
 * §3.5). `null` when the node has no class to key off (a bare test fixture, `document.body`), in which
 * case a stale reference just stays stale — there is nothing left to re-resolve by.
 *
 * Assumes the class is unique enough on the page that the first match is the right one. Not used for
 * `seasonReportPanel.ts`'s own strip toggle: that node is rebuilt by *this controller's own* `paint()`
 * unconditionally on every call, so its selector is a hardcoded constant scoped to `roots.strip` rather
 * than a `document`-wide lookup by a class read off the stale node.
 */
export function stableSelectorFor(node: HTMLElement): string | null {
  const className = node.classList[0];
  return className === undefined ? null : `.${className}`;
}

/** A captured opener, as `stableSelectorFor` produces it: the raw node, plus a fallback to re-find it by. */
export interface CapturedOpener {
  readonly element: HTMLElement;
  readonly selector: string | null;
}

/**
 * Resolves a captured opener (hud.md §3.5) to a live, focusable node: the raw reference if a rebuild
 * elsewhere on the page has not detached it, otherwise a fresh match for its `stableSelectorFor` selector,
 * otherwise `null` — the opener was genuinely removed from the page, not just rebuilt, and there is
 * nothing sensible left to focus. Shared by `directivePanel.ts` and `seasonReportPanel.ts` rather than
 * duplicated: both panels face the identical staleness once an opener is captured as a raw node.
 */
export function resolveOpener(opener: CapturedOpener): HTMLElement | null {
  if (opener.element.isConnected) return opener.element;
  return opener.selector === null ? null : document.querySelector<HTMLElement>(opener.selector);
}
