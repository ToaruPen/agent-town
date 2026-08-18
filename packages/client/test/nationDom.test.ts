// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { captureOpener, resolveOpener } from "../src/ui/nationDom.js";

/**
 * `captureOpener`/`resolveOpener` are hud.md §3.5's re-resolution mechanism, shared by
 * `directivePanel.ts` and `seasonReportPanel.ts`. Exercised directly here for the branching that a full
 * HUD mount would only ever hit indirectly — `nationHudDom.test.ts` still carries the end-to-end proof
 * (the dashboard-rebuild and same-class-submit-button regressions), this file is the unit-level map of
 * *why* each branch resolves the way it does.
 */
describe("captureOpener / resolveOpener", () => {
  it("returns the same element when it is still connected — no re-resolution needed", () => {
    document.body.innerHTML = '<div id="scope"><button class="widget"></button></div>';
    const button = document.querySelector("button");
    expect(button).not.toBeNull();

    const opener = captureOpener(button as HTMLElement);
    expect(resolveOpener(opener)).toBe(button);
  });

  it("resolves by the node's own id when it has one, even after the original node is gone", () => {
    document.body.innerHTML = '<button id="the-button"></button>';
    const original = document.getElementById("the-button");
    expect(original).not.toBeNull();
    const opener = captureOpener(original as HTMLElement);

    original?.remove();
    const rebuilt = document.createElement("button");
    rebuilt.id = "the-button";
    document.body.append(rebuilt);

    expect(resolveOpener(opener)).toBe(rebuilt);
  });

  it("resolves a same-class sibling by its data-* attribute, not by being first in scope", () => {
    document.body.innerHTML = `
      <section id="scope">
        <button class="card" data-key="a"></button>
        <button class="card" data-key="b"></button>
        <button class="card" data-key="c"></button>
      </section>
    `;
    const target = document.querySelector('[data-key="b"]');
    expect(target).not.toBeNull();
    const opener = captureOpener(target as HTMLElement);

    // Rebuild: same three cards, brand new nodes, same order.
    const scope = document.getElementById("scope") as HTMLElement;
    scope.innerHTML = `
      <button class="card" data-key="a"></button>
      <button class="card" data-key="b"></button>
      <button class="card" data-key="c"></button>
    `;
    const rebuiltTarget = scope.querySelector('[data-key="b"]');
    expect(rebuiltTarget).not.toBe(target);

    expect(resolveOpener(opener)).toBe(rebuiltTarget);
  });

  it("resolves a class-only node when it is the only match in its scope", () => {
    document.body.innerHTML =
      '<section id="scope"><button class="only-one-here"></button></section>';
    const original = document.querySelector(".only-one-here");
    expect(original).not.toBeNull();
    const opener = captureOpener(original as HTMLElement);

    const scope = document.getElementById("scope") as HTMLElement;
    scope.innerHTML = '<button class="only-one-here"></button>';
    const rebuilt = scope.querySelector(".only-one-here");
    expect(rebuilt).not.toBe(original);

    expect(resolveOpener(opener)).toBe(rebuilt);
  });

  it("refuses to guess when several same-class siblings exist and none carries a distinguishing attribute", () => {
    document.body.innerHTML = `
      <section id="scope">
        <button class="option"></button>
        <button class="option"></button>
      </section>
    `;
    const [first] = document.querySelectorAll(".option");
    expect(first).not.toBeUndefined();
    const opener = captureOpener(first as HTMLElement);

    // Rebuild: still two same-class siblings, neither distinguishable from the other — this is
    // `.directive-panel__submit`'s actual shape before `data-directive-key` is added to the picture, and
    // exactly the case a first-class-match guess got wrong.
    const scope = document.getElementById("scope") as HTMLElement;
    scope.innerHTML = '<button class="option"></button><button class="option"></button>';

    expect(resolveOpener(opener)).toBeNull();
  });

  it("gives up cleanly when the node has neither an id nor an identifiable ancestor", () => {
    document.body.innerHTML = "";
    const orphan = document.createElement("button");
    orphan.className = "drifting";
    // Deliberately never appended to the document.
    const opener = captureOpener(orphan);

    expect(resolveOpener(opener)).toBeNull();
  });

  it("gives up when the node has no class and no id at all", () => {
    document.body.innerHTML = '<section id="scope"></section>';
    const scope = document.getElementById("scope") as HTMLElement;
    const bare = document.createElement("button");
    scope.append(bare);

    const opener = captureOpener(bare);
    bare.remove();

    expect(resolveOpener(opener)).toBeNull();
  });
});
