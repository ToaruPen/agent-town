/**
 * The element helper the nation panels share. `worldChronicle.ts:177` has the same six lines as a
 * module-private function; importing it would mean exporting from a file C1-4 is about to reshape, so
 * the nation layer keeps its own copy rather than creating a merge conflict over a helper.
 */
export function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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

/** Replaces a panel's contents in one go, the destroy-and-rebuild half of the established idiom. */
export function replaceChildren(root: HTMLElement, ...children: readonly Node[]): void {
  root.replaceChildren(...children);
}
