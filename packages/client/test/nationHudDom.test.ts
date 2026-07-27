// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ClientMessage } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { createNationDashboard } from "../src/ui/nationDashboard.js";
import { buildNationDashboardViewModel } from "../src/ui/nationDashboardViewModel.js";
import { createNationHud, type NationHudRoots } from "../src/ui/nationHud.js";
import { bindNationKeys } from "../src/ui/nationKeyboard.js";
import {
  historyFixture,
  nationFixture,
  ordersFixture,
  polityFixture,
  worldFixture,
} from "./nationFixture.js";

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
  const directives = doc.getElementById("directive-panel");
  const select = doc.getElementById("nation-select");
  const status = doc.getElementById("world-status");
  if (clock === null || dashboard === null || ranking === null) return null;
  if (directives === null || select === null || status === null) return null;
  return { clock, dashboard, ranking, directives, select, status };
}

/**
 * Everything the mounted HUD sent, so a control that looks live can be checked against the wire.
 *
 * `deliver` is what the transport reports back. `false` is the reconnect gap as `wsClient` actually
 * behaves: the message is accepted by the call and reaches nothing.
 */
function mountAgainstIndexHtml(deliver: () => boolean = () => true): {
  roots: NationHudRoots;
  hud: ReturnType<typeof createNationHud>;
  sent: ClientMessage[];
} {
  document.body.innerHTML = loadIndexBody();
  const roots = findRoots(document);
  if (roots === null) throw new Error("index.html no longer provides the ids main.ts looks up");
  const sent: ClientMessage[] = [];
  return {
    roots,
    hud: createNationHud(roots, (message) => {
      if (!deliver()) return false;
      sent.push(message);
      return true;
    }),
    sent,
  };
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

  /**
   * `orders` is how the server confirms a `selectNation`, so this is the real claim path. It used to go
   * through `applyOrdersNation`, a stand-in that read only the nation id while C1-4 was unwritten.
   */
  it("fills the dashboard and the ranking once a nation is claimed", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyOrders(ordersFixture({ nationId: "polity-2" }));

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

/**
 * The order desk's claims, checked against real controls rather than against a view model.
 *
 * These are the assertions the view model tests cannot make. "A blocked option is unsubmittable but never
 * hidden" is a statement about a button that exists in the document, is reachable, and does nothing when
 * pressed — three properties of a DOM node. Until this package had a document, the nearest available check
 * was reading `index.html` as a string and confirming the CSS selector existed.
 */
describe("the order desk's controls", () => {
  function openDesk(orders = ordersFixture({ nationId: "polity-2", autoPilot: false })) {
    const mounted = mountAgainstIndexHtml();
    mounted.hud.applyWelcome(unclaimedWorld(), 1_000);
    mounted.hud.applyOrders(orders);
    mounted.hud.toggleDirectives();
    return mounted;
  }

  const submitFor = (root: HTMLElement, key: string): HTMLButtonElement => {
    const button = root.querySelector(`[data-directive-key="${key}"]`);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`no submit control for ${key}`);
    return button;
  };

  it("keeps the panel hidden until it is asked for", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyOrders(ordersFixture({ nationId: "polity-2" }));

    expect(roots.directives.hidden).toBe(true);

    hud.toggleDirectives();

    expect(roots.directives.hidden).toBe(false);
    expect(roots.directives.childElementCount).toBeGreaterThan(0);
  });

  it("renders one submit control per option the server sent", () => {
    const { roots } = openDesk();

    expect(roots.directives.querySelectorAll("[data-directive-key]")).toHaveLength(6);
  });

  /**
   * Bullet 1, and the reason `aria-disabled` was chosen over `disabled`: a `disabled` button leaves the tab
   * order and takes the explanation with it. The control has to be present, reachable and inert all at once.
   */
  it("leaves a blocked option present, reachable, explained and inert", () => {
    const { roots, sent } = openDesk();
    const blocked = submitFor(roots.directives, "openMine:");

    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    expect(blocked.disabled).toBe(false);
    expect(blocked.getAttribute("aria-label")).toContain("丘陵・山岳を領有していません");
    expect(roots.directives.textContent).toContain("丘陵・山岳を領有していません");

    blocked.click();

    expect(sent).toEqual([]);
  });

  it("sends the directive a submittable option names, target included", () => {
    const { roots, sent } = openDesk();

    submitFor(roots.directives, "growCity:city-polity-1-1").click();

    expect(sent).toEqual([
      { type: "issueDirective", kind: "growCity", targetCityId: "city-polity-1-1" },
    ]);
  });

  /** The slot's cancel control, which the server accepts in both modes. */
  it("cancels the queued order by id from the dashboard", () => {
    const { roots, sent } = openDesk(
      ordersFixture({
        nationId: "polity-2",
        autoPilot: false,
        queued: { id: "directive-3", kind: "holdFestival", targetCityId: null },
      }),
    );
    const cancel = roots.dashboard.querySelector(".nation-dashboard__cancel");
    if (!(cancel instanceof HTMLButtonElement)) throw new Error("no cancel control");

    cancel.click();

    expect(sent).toEqual([{ type: "cancelDirective", directiveId: "directive-3" }]);
  });

  /**
   * 取消 sits in the same desk as 発令 and has to obey the same rule. Gating only the submit control left the
   * worse of the two live: withdrawing an order is what a player does *because* something looked wrong, and
   * a 取消 that silently reaches nothing leaves the order committing at the boundary anyway.
   *
   * Connectivity is not in the dashboard's view model, so this also pins that the button is re-marked
   * without a rebuild — the dedupe key is unchanged and `render` returns early.
   */
  it("stops offering to cancel while the socket is down", () => {
    const queued = ordersFixture({
      nationId: "polity-2",
      autoPilot: false,
      queued: { id: "directive-3", kind: "holdFestival", targetCityId: null },
    });
    const { roots, hud, sent } = openDesk(queued);
    const cancel = roots.dashboard.querySelector(".nation-dashboard__cancel");
    if (!(cancel instanceof HTMLButtonElement)) throw new Error("no cancel control");

    expect(cancel.getAttribute("aria-disabled")).toBeNull();

    hud.applyDisconnected();

    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    expect(cancel.disabled).toBe(false);
    cancel.click();

    expect(sent).toEqual([]);
  });

  /** Bullet 4: the lamp is the server's echo, and pressing it asks for the opposite of what it shows. */
  it("shows the mode the server reported and asks for its opposite", () => {
    const { roots, sent } = openDesk(ordersFixture({ nationId: "polity-2", autoPilot: true }));
    const toggle = roots.clock.querySelector(".nation-clock__autopilot");
    if (!(toggle instanceof HTMLButtonElement)) throw new Error("no autopilot control");

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.textContent).toBe("自動運転 ●ON");

    toggle.click();

    expect(sent).toEqual([{ type: "setAutoPilot", enabled: false }]);
  });

  /**
   * A reconnect leaves the list on screen and the mode unknown. The lamp must not offer a toggle then: it
   * has no value to invert, and guessing would flip a nation that starts autopiloted.
   */
  it("refuses to toggle a mode it has not been told", () => {
    const { roots, hud, sent } = openDesk(
      ordersFixture({ nationId: "polity-2", autoPilot: false }),
    );
    hud.applyWelcome(unclaimedWorld(), 2_000);
    const toggle = roots.clock.querySelector(".nation-clock__autopilot");
    if (!(toggle instanceof HTMLButtonElement)) throw new Error("no autopilot control");

    expect(toggle.textContent).toBe("自動運転 同期中");
    expect(toggle.getAttribute("aria-disabled")).toBe("true");

    toggle.click();

    expect(sent).toEqual([]);
  });

  /**
   * The reconnect gap made real. `wsClient` discards every send for the second between a drop and the
   * replacement socket, so a submit control that stayed live would look accepted and reach nothing at all —
   * the one refusal that produces no `rejected` message to show.
   */
  it("stops offering to submit while the socket is down, and says why", () => {
    const { roots, hud, sent } = openDesk();
    const live = submitFor(roots.directives, "growCity:city-polity-1-1");

    expect(live.getAttribute("aria-disabled")).toBeNull();

    hud.applyDisconnected();
    const offline = submitFor(roots.directives, "growCity:city-polity-1-1");

    expect(offline.getAttribute("aria-disabled")).toBe("true");
    expect(offline.disabled).toBe(false);
    offline.click();

    expect(sent).toEqual([]);
    const notice = roots.directives.querySelector(".directive-panel__offline");
    expect(notice?.textContent).toBe("接続が切れています。再接続するまで発令できません。");
    expect(notice?.getAttribute("role")).toBe("alert");
  });

  /** A reconnect delivers a `welcome`, which is also the proof that there is a socket again. */
  it("offers to submit again once a welcome says the socket is back", () => {
    const { roots, hud, sent } = openDesk();
    hud.applyDisconnected();
    hud.applyWelcome(unclaimedWorld(), 2_000);
    hud.applyOrders(ordersFixture({ nationId: "polity-2", autoPilot: false }));

    submitFor(roots.directives, "growCity:city-polity-1-1").click();

    expect(sent).toEqual([
      { type: "issueDirective", kind: "growCity", targetCityId: "city-polity-1-1" },
    ]);
    expect(roots.directives.querySelector(".directive-panel__offline")).toBeNull();
  });

  /**
   * The keys are the half of the §3.5 map with nothing on screen to grey out, so they take the other route:
   * a send the transport refused is announced. Without this, clicking during the gap was visibly refused
   * while pressing `A` or `2` vanished in silence — the same lie, one layer down.
   *
   * `deliver: () => false` is the gap itself rather than the HUD's own `connected` flag, because these two
   * can disagree: the socket closes before `onclose` runs, and the drop `wsClient` has seen but not yet
   * reported is exactly when a key is most likely to be pressed.
   */
  it("says so out loud when a key's send reached nothing", () => {
    const { roots, hud, sent } = mountAgainstIndexHtml(() => false);
    const unbind = bindNationKeys(hud.send, () => hud.state(), {
      toggleDirectives: () => {
        hud.toggleDirectives();
      },
      closeTopPanel: () => hud.closeTopPanel(),
    });
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyOrders(ordersFixture({ nationId: "polity-2", autoPilot: false }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(sent).toEqual([]);
    expect(roots.status.textContent).toBe("接続が切れています。送信できませんでした。");
    unbind();
  });

  /** The refusal is announced, not merely printed, because at speed 0 nothing else on screen moves. */
  it("puts a server refusal on screen as an alert", () => {
    const { roots } = openDesk(
      ordersFixture({ nationId: "polity-2", autoPilot: false, rejected: "insufficientWealth" }),
    );
    const alert = roots.directives.querySelector('[role="alert"]');

    expect(alert?.textContent).toBe("発令できませんでした：富が足りません");
  });
});

/**
 * The HUD calls `renderCanSend` after every `render`, so through it a freshly built cancel control is never
 * observably wrong. This tests the controller's own promise rather than that arrangement: a cancel button
 * built while the channel is down must be born inert, so a later caller that renders without the refresh
 * cannot reintroduce a live-looking control.
 */
describe("the dashboard's cancel control on its own", () => {
  it("is born inert when there is nothing to send on", () => {
    document.body.innerHTML = "<div id='d'></div>";
    const root = document.getElementById("d");
    if (root === null) throw new Error("no root");
    const sent: ClientMessage[] = [];
    const dashboard = createNationDashboard(root, {
      send: (message) => {
        sent.push(message);
        return true;
      },
      openDirectives: () => {
        throw new Error("this test never opens the candidate list");
      },
      readCanSend: () => false,
    });

    dashboard.render(
      buildNationDashboardViewModel(
        nationFixture({ id: "polity-2", controller: "player" }),
        polityFixture({ id: "polity-2", name: "ヴェルナ" }),
        true,
        ordersFixture({
          nationId: "polity-2",
          autoPilot: false,
          queued: { id: "directive-3", kind: "holdFestival", targetCityId: null },
        }),
      ),
      1,
    );
    const cancel = root.querySelector(".nation-dashboard__cancel");
    if (!(cancel instanceof HTMLButtonElement)) throw new Error("no cancel control");

    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    cancel.click();

    expect(sent).toEqual([]);
  });
});
