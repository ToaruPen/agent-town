import { describe, expect, it } from "vitest";

import { directiveView } from "../src/ui/nationHud.js";
import { applyOrders, applyWelcome, initialNationHudState } from "../src/ui/nationHudState.js";
import { ordersFixture, worldFixture } from "./nationFixture.js";

const welcomed = () => applyWelcome(initialNationHudState(), worldFixture());
const desked = () => applyOrders(welcomed(), ordersFixture({ autoPilot: false }));

/**
 * The state-to-panel mapping, which is where the reconnect rule takes effect. The pieces either side of it
 * are already covered — `applyWelcome` keeps the list and drops the claims, `buildDirectiveListViewModel`
 * reads a null `orders` as unknown — but nothing pinned that the two are wired to each other.
 */
describe("directiveView", () => {
  it("has nothing to show before any orders have arrived", () => {
    expect(directiveView(welcomed())).toBeNull();
  });

  it("shows the list and the mode once an orders message has landed", () => {
    const view = directiveView(desked());

    expect(view?.cards).toHaveLength(6);
    expect(view?.autoPilot).toBe(false);
  });

  /**
   * The whole point of storing the list apart from the claims: after a reconnect the player can still act,
   * and nothing on screen asserts a mode or a decision the server has not restated.
   */
  it("survives a reconnect with the list intact and the mode unknown", () => {
    const view = directiveView(applyWelcome(desked(), worldFixture()));

    expect(view?.cards).toHaveLength(6);
    expect(view?.cards.some((card) => card.canSubmit)).toBe(true);
    expect(view?.autoPilot).toBeNull();
    expect(view?.autoPilotLabel).toBe("自動運転 同期中");
  });

  it("shows nothing at all while the player holds no nation", () => {
    const spectating = applyWelcome(
      initialNationHudState(),
      worldFixture({ playerNationId: null }),
    );

    expect(directiveView(spectating)).toBeNull();
  });
});
