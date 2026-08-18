// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Reviewer-found regression: `.city-view { display: flex }` outranks the UA stylesheet's
 * `[hidden] { display: none }` (a class selector beats a plain attribute selector), and unlike every
 * other panel on the page there was no `.city-view[hidden]` rule to win it back. `cityViewPanel.ts`
 * hides the host via `host.hidden = true` both before the first open and on every `close()` — with the
 * bug, the empty canvas, the × button and the flex slot all stayed visible regardless, so the visual
 * local→world transition never actually happened even though `onClose` and the locate pulse still fired.
 *
 * This loads the real, currently-shipped `<style>` block from `index.html` rather than a hand-copied
 * excerpt — a fix that only lives in a copy pasted into the test would drift from the page silently.
 */

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadIndexStylesheet(): string {
  const html = readFileSync(join(CLIENT_ROOT, "index.html"), "utf8");
  const opening = html.indexOf("<style>");
  const closing = html.indexOf("</style>");
  expect(opening).toBeGreaterThan(-1);
  expect(closing).toBeGreaterThan(opening);
  return html.slice(opening + "<style>".length, closing);
}

describe("the docked city view's hidden state", () => {
  it("computes display:none once main.ts marks #city-view hidden, not just the attribute", () => {
    const style = document.createElement("style");
    style.textContent = loadIndexStylesheet();
    document.head.append(style);

    const el = document.createElement("section");
    el.id = "city-view";
    el.className = "city-view";
    document.body.append(el);

    // Sanity check on the harness itself: confirms the stylesheet actually applied `.city-view`'s own
    // rule, so the assertion below is proof of the `[hidden]` rule specifically, not of CSS not loading
    // at all.
    expect(getComputedStyle(el).display).toBe("flex");

    el.hidden = true;

    expect(getComputedStyle(el).display).toBe("none");
  });
});
