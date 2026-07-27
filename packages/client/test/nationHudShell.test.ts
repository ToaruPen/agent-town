import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

/**
 * The markup and CSS the HUD mounts into, checked as text in the style of `worldChronicleShell.test.ts`.
 * There is no DOM environment in this package, so the roots `main.ts` looks up by id are pinned here —
 * a renamed root would otherwise leave the HUD silently unmounted with no test failing.
 */
describe("nation HUD shell", () => {
  it("provides every root main.ts requires, so the HUD cannot go silently unmounted", () => {
    expect(html).toContain('id="nation-clock"');
    expect(html).toContain('id="nation-dashboard"');
    expect(html).toContain('id="nation-ranking"');
    expect(html).toContain('id="nation-select"');
    // Announcements reuse the existing live region rather than adding a second one.
    expect(html).toContain('id="world-status"');
    expect(html).toMatch(/id="world-status"[\s\S]*?aria-live="polite"/);
  });

  /** The picker only exists while the player holds no nation, so it must start out of the way. */
  it("starts the nation picker hidden", () => {
    expect(html).toMatch(/id="nation-select"[\s\S]*?hidden[\s\S]*?>/);
  });

  it("labels the HUD regions for a screen reader", () => {
    expect(html).toContain('aria-label="暦と進行速度"');
    expect(html).toContain('aria-label="自国の状況"');
    expect(html).toContain('aria-label="繁栄度の順位"');
    expect(html).toContain('aria-label="国の選択"');
  });

  it("keeps the 44px touch target the rest of the UI already promises", () => {
    expect(html).toMatch(/\.nation-clock__speed\s*\{[^}]*min-height:\s*44px[^}]*\}/s);
    expect(html).toMatch(/\.nation-select__option\s*\{[^}]*min-height:\s*44px[^}]*\}/s);
  });

  it("styles the metric deltas by direction so the diff is not carried by colour alone", () => {
    expect(html).toContain(".nation-dashboard__delta--up");
    expect(html).toContain(".nation-dashboard__delta--down");
    expect(html).toContain(".nation-dashboard__delta--flat");
  });

  it("reuses the world palette rather than introducing a second one", () => {
    expect(html).toMatch(/\.nation-clock\s*\{[^}]*var\(--world-parchment\)[^}]*\}/s);
  });

  it("collapses the two side panels into one column on a narrow screen", () => {
    expect(html).toMatch(/@media \(width <= 40rem\)[\s\S]*?\.nation-hud\s*\{[\s\S]*?column/);
  });

  /** Nothing populates it now that main.ts is the nation shell, so it must not be sitting on screen. */
  it("hides the resident-era traffic overlay toggle instead of leaving it dead on screen", () => {
    expect(html).toMatch(/id="traffic-overlay-toggle"[\s\S]*?hidden[\s\S]*?>/);
  });
});
