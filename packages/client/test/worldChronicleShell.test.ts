import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("world chronicle shell", () => {
  it("provides an accessible toggle, labelled panel, and reduced-motion styling", () => {
    expect(html).toContain('id="chronicle-toggle"');
    expect(html).toContain('aria-controls="world-chronicle"');
    expect(html).toContain('id="world-chronicle"');
    expect(html).toContain('aria-labelledby="world-chronicle-title"');
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
