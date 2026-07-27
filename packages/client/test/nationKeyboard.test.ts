import { describe, expect, it } from "vitest";

import { panelActionForKey } from "../src/ui/nationKeyboard.js";

/**
 * The panel half of the §3.5 key map. Kept apart from the server half so that neither can answer for a key
 * the other owns: `D` and `Escape` act on the DOM and must never reach `nationKeyCommand`, and the speed
 * and autopilot keys must never be swallowed here.
 */
describe("panelActionForKey", () => {
  it("opens the candidate list on D, in either case", () => {
    expect(panelActionForKey("d")).toBe("directives");
    expect(panelActionForKey("D")).toBe("directives");
  });

  it("closes on Escape", () => {
    expect(panelActionForKey("Escape")).toBe("close");
  });

  /**
   * `Escape` always claims the *action* and lets `runPanelAction` report whether anything was open, which
   * is what lets a later slice fall through to clearing the map selection. Deciding here would need panel
   * state this function does not have, and would have to guess.
   */
  it("claims Escape unconditionally, leaving what it consumed to the panel to report", () => {
    expect(panelActionForKey("Escape")).not.toBeNull();
  });

  it("leaves the server keys alone", () => {
    expect(panelActionForKey("a")).toBeNull();
    expect(panelActionForKey("A")).toBeNull();
    expect(panelActionForKey("p")).toBeNull();
    expect(panelActionForKey("1")).toBeNull();
  });

  it("ignores a key that merely starts with d", () => {
    expect(panelActionForKey("Delete")).toBeNull();
    expect(panelActionForKey("ArrowDown")).toBeNull();
  });
});
