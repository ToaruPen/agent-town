// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createNationHud, type NationHudRoots } from "../src/ui/nationHud.js";
import { historyFixture, nationFixture, polityFixture, worldFixture } from "./nationFixture.js";

/**
 * Everything else in this package tests view models, which are pure and never touch a document. That
 * left the last step — view model to pixels — covered by nothing: `createNationHud` and the four panel
 * renderers write to the DOM, and the whole suite could stay green while the page rendered blank.
 *
 * So this file mounts the HUD against `index.html`'s real markup, looked up by the same ids `main.ts`
 * uses, and asserts something reaches the screen. It is deliberately coarse. Asserting *what* each
 * panel says belongs to the view model tests, which already do it; what has never been asserted is
 * that anything at all arrives.
 */

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadIndexBody(): string {
  const html = readFileSync(join(CLIENT_ROOT, "index.html"), "utf8");
  const opening = html.indexOf("<body>");
  const script = html.indexOf('<script type="module"', opening);
  const closing = html.indexOf("</body>");
  expect(opening).toBeGreaterThan(-1);
  expect(script).toBeGreaterThan(opening);
  expect(closing).toBeGreaterThan(script);
  return html.slice(opening + "<body>".length, script);
}

/** Mirrors `findNationHudRoots` in `main.ts`. A null here is exactly the failure that blanks the page. */
function findRoots(doc: Document): NationHudRoots | null {
  const clock = doc.getElementById("nation-clock");
  const dashboard = doc.getElementById("nation-dashboard");
  const ranking = doc.getElementById("nation-ranking");
  const select = doc.getElementById("nation-select");
  const status = doc.getElementById("world-status");
  if (clock === null || dashboard === null || ranking === null) return null;
  if (select === null || status === null) return null;
  return { clock, dashboard, ranking, select, status };
}

function mountAgainstIndexHtml(): {
  roots: NationHudRoots;
  hud: ReturnType<typeof createNationHud>;
} {
  document.body.innerHTML = loadIndexBody();
  const roots = findRoots(document);
  if (roots === null) throw new Error("index.html no longer provides the ids main.ts looks up");
  // Nothing here submits, so the outbound channel discards. C1-4 is where sends start to matter.
  const discard = (): void => undefined;
  return { roots, hud: createNationHud(roots, discard) };
}

const POLITIES = [
  polityFixture({ id: "polity-1", name: "アシュカル" }),
  polityFixture({ id: "polity-2", name: "ヴェルナ" }),
];

/** The shape the server actually sends on a fresh connect: nobody has claimed a nation yet. */
function unclaimedWorld() {
  return worldFixture({
    playerNationId: null,
    history: historyFixture(POLITIES),
    nations: [
      nationFixture({ id: "polity-1", controller: "agent" }),
      nationFixture({ id: "polity-2", controller: "agent" }),
    ],
  });
}

describe("the page before the first payload", () => {
  it("says something rather than nothing", () => {
    document.body.innerHTML = loadIndexBody();
    const boot = document.getElementById("nation-boot");
    expect(boot).not.toBeNull();
    expect(boot?.textContent?.trim()).not.toBe("");
  });

  it("leaves every panel empty, which is why the notice has to exist", () => {
    document.body.innerHTML = loadIndexBody();
    const roots = findRoots(document);
    if (roots === null) throw new Error("index.html no longer provides the ids main.ts looks up");
    for (const root of [roots.clock, roots.dashboard, roots.ranking, roots.select]) {
      expect(root.childElementCount).toBe(0);
    }
  });
});

describe("the HUD against index.html's real markup", () => {
  it("finds every root main.ts looks up", () => {
    document.body.innerHTML = loadIndexBody();
    expect(findRoots(document)).not.toBeNull();
  });

  it("puts something on screen for a player who has not chosen a nation yet", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);

    // The clock and the picker are the two that must never be empty at this point: with no nation
    // chosen there is nothing else on the page, so if these are blank, the page is blank.
    expect(roots.clock.childElementCount).toBeGreaterThan(0);
    expect(roots.select.childElementCount).toBeGreaterThan(0);
    expect(roots.status.textContent).not.toBe("");
  });

  it("names every selectable nation in the picker", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    const text = roots.select.textContent ?? "";
    for (const polity of POLITIES) expect(text).toContain(polity.name);
  });

  it("fills the dashboard and the ranking once a nation is claimed", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyOrdersNation("polity-2");

    expect(roots.dashboard.childElementCount).toBeGreaterThan(0);
    expect(roots.ranking.childElementCount).toBeGreaterThan(0);
  });

  it("keeps rendering after a reconnect delivers a second welcome", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyWelcome(unclaimedWorld(), 2_000);

    expect(roots.clock.childElementCount).toBeGreaterThan(0);
    expect(roots.select.childElementCount).toBeGreaterThan(0);
  });
});
