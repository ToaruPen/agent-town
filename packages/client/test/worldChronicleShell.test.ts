import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("world chronicle shell", () => {
  it("provides an accessible map toggle, tabs, responsive canvas, and reduced motion", () => {
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('id="chronicle-toggle"');
    expect(html).toContain('aria-controls="world-chronicle"');
    expect(html).toContain('id="world-chronicle"');
    expect(html).toContain('aria-labelledby="world-chronicle-title"');
    expect(html).toContain(".world-chronicle__tabs");
    expect(html).toContain(".world-chronicle__map-canvas-wrapper");
    expect(html).toContain(".world-chronicle__map-canvas");
    expect(html).toContain(".world-chronicle__map-legend");
    expect(html).toContain(".world-chronicle__map-selection");
    expect(html).toMatch(/\.world-chronicle__tab\s*\{[^}]*min-height:\s*44px[^}]*\}/s);
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
    expect(html).toContain("旧世界を見る");
    expect(html).toContain("エージェント・タウンの世界");
  });
});
