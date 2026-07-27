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
