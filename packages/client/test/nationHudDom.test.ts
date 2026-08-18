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
  ledgerEntry,
  nationFixture,
  ordersFixture,
  polityFixture,
  reportFixture,
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
  const strip = doc.getElementById("nation-strip");
  const report = doc.getElementById("season-report");
  if (clock === null || dashboard === null || ranking === null) return null;
  if (directives === null || select === null || status === null) return null;
  if (strip === null || report === null) return null;
  return { clock, dashboard, ranking, directives, select, status, strip, report };
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
   * hud.md §3.5: closing a panel returns focus to whatever opened it — here, the dashboard's own
   * "施策を選ぶ" button, which is how `D` and a click both actually reach `toggle()`. Focus is moved onto
   * a control *inside* the panel before closing it, so the assertion cannot pass merely because nothing
   * ever moved focus away from the opener in the first place.
   */
  it("returns focus to the opener when the directive panel closes", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyOrders(ordersFixture({ nationId: "polity-2", autoPilot: false }));
    const opener = roots.dashboard.querySelector(".nation-dashboard__choose");
    expect(opener).not.toBeNull();
    (opener as HTMLElement).focus();
    expect(document.activeElement).toBe(opener);

    hud.toggleDirectives();
    expect(roots.directives.hidden).toBe(false);

    const submit = roots.directives.querySelector("[data-directive-key]");
    expect(submit).not.toBeNull();
    (submit as HTMLElement).focus();
    expect(document.activeElement).toBe(submit);

    hud.toggleDirectives();

    expect(roots.directives.hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  /**
   * The click path is not the keyboard path: `document.activeElement` at the moment `toggle()` runs is
   * whatever had focus *before* the click, not necessarily the clicked control itself — a
   * script-dispatched click does not run a browser's focusing steps (confirmed empirically: happy-dom's
   * `.click()` leaves `document.activeElement` on `<body>`), and click-to-focus for a `<button>`
   * specifically is UA-dependent even for a real pointer click. Reading `activeElement` on this path would
   * capture the wrong opener, or none. The button that was actually clicked must be captured directly.
   */
  it("returns focus to the button that was actually clicked, even though the click itself never focused it", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyOrders(ordersFixture({ nationId: "polity-2", autoPilot: false }));
    const opener = roots.dashboard.querySelector(".nation-dashboard__choose");
    expect(opener).not.toBeNull();
    expect(document.activeElement).not.toBe(opener);

    (opener as HTMLElement).click();
    expect(roots.directives.hidden).toBe(false);

    hud.toggleDirectives();

    expect(roots.directives.hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  /**
   * The ambiguous case §3.5 leaves unstated: the opener can vanish from the document while the panel is
   * open (a dashboard rebuild, say). Closing must not throw and must not hand focus to a detached node —
   * there is nothing sensible left to return it to, so it is left wherever the browser's default lands.
   */
  it("does not throw and does not focus a detached opener when the opener is gone by close time", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyOrders(ordersFixture({ nationId: "polity-2", autoPilot: false }));
    const ephemeral = document.createElement("button");
    document.body.append(ephemeral);
    ephemeral.focus();
    expect(document.activeElement).toBe(ephemeral);

    hud.toggleDirectives();
    ephemeral.remove();

    expect(() => hud.toggleDirectives()).not.toThrow();
    expect(roots.directives.hidden).toBe(true);
    expect(document.activeElement).not.toBe(ephemeral);
  });

  /**
   * The common real flow, not an edge case: submitting a directive does not close the panel, and the
   * `orders` echo that follows rebuilds the dashboard wholesale (`nationHud.renderPanels()` calls
   * `panels.dashboard.render(...)` on every `applyOrders`) while the panel is still open — detaching
   * whatever `toggle()` captured as the opener before the player gets around to closing it.
   */
  it("returns focus to the rebuilt opener when the dashboard repaints while the panel is still open", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyOrders(ordersFixture({ nationId: "polity-2", autoPilot: false }));
    const opener = roots.dashboard.querySelector(".nation-dashboard__choose");
    expect(opener).not.toBeNull();
    (opener as HTMLElement).focus();

    hud.toggleDirectives();
    expect(roots.directives.hidden).toBe(false);

    // Simulates the `orders` echo a submitted directive triggers, panel still open — `autoPilot`
    // flips so the dashboard's view model genuinely differs and its memoized render is not skipped.
    hud.applyOrders(ordersFixture({ nationId: "polity-2", autoPilot: true }));
    const rebuiltOpener = roots.dashboard.querySelector(".nation-dashboard__choose");
    expect(rebuiltOpener).not.toBeNull();
    expect(rebuiltOpener).not.toBe(opener);

    hud.toggleDirectives();

    expect(roots.directives.hidden).toBe(true);
    expect(document.activeElement).toBe(rebuiltOpener);
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
    expect(toggle.getAttribute("aria-label")).toBe(
      "自動運転を切る（A）。今は実行可能なあなたの発令があればそれが優先され、なければ宰相が決めます",
    );

    toggle.click();

    expect(sent).toEqual([{ type: "setAutoPilot", enabled: false }]);
  });

  /**
   * The OFF-state aria-label, pinned directly rather than left to the ON test above: nothing else in this
   * file exercises the toggle with autopilot off, so a regression there would otherwise pass unnoticed.
   */
  it("names what turning autopilot on would do in the OFF-state aria-label", () => {
    const { roots } = openDesk(ordersFixture({ nationId: "polity-2", autoPilot: false }));
    const toggle = roots.clock.querySelector(".nation-clock__autopilot");
    if (!(toggle instanceof HTMLButtonElement)) throw new Error("no autopilot control");

    expect(toggle.textContent).toBe("自動運転 ○OFF");
    expect(toggle.getAttribute("aria-label")).toBe(
      "自動運転を入れる（A）。今はあなたの発令だけが実行されます",
    );
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
      toggleReport: () => {
        hud.toggleReport();
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

  /**
   * `L` is the map's own key (visual.md §2.6's on-demand locate), a third half of the §3.5 map alongside
   * the server and panel ones exercised above — it must reach neither `send` nor a panel, only whichever
   * `locate` the page supplied `bindNationKeys`.
   */
  it("calls the supplied locate on L, in either case, and sends nothing to the server", () => {
    const { hud, sent } = mountAgainstIndexHtml();
    let located = 0;
    const unbind = bindNationKeys(
      hud.send,
      () => hud.state(),
      {
        toggleDirectives: () => hud.toggleDirectives(),
        toggleReport: () => hud.toggleReport(),
        closeTopPanel: () => hud.closeTopPanel(),
      },
      {
        locate: () => {
          located += 1;
        },
      },
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "L", bubbles: true }));

    expect(located).toBe(2);
    expect(sent).toEqual([]);
    unbind();
  });

  /** A page with no map on screen supplies no fourth argument at all, and `L` must fall silently rather
   *  than throwing on a missing `locate`. */
  it("does nothing on L when the page supplied no locate at all", () => {
    const { hud } = mountAgainstIndexHtml();
    const unbind = bindNationKeys(hud.send, () => hud.state(), {
      toggleDirectives: () => hud.toggleDirectives(),
      toggleReport: () => hud.toggleReport(),
      closeTopPanel: () => hud.closeTopPanel(),
    });

    expect(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true })),
    ).not.toThrow();
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
 * The season report's DOM layer: the always-on strip (hud.md §4.1) and the on-demand panel it opens
 * (§4.5). These are the claims the view model tests cannot make on their own — that the panel actually
 * paints six rows, that the strip actually vanishes for a spectator, that a famine actually flips a real
 * `hidden` attribute rather than merely setting `isFamine` on a view model nothing reads.
 */
describe("the season report", () => {
  function boardedWithReport(report = reportFixture()) {
    const mounted = mountAgainstIndexHtml();
    mounted.hud.applyWelcome(unclaimedWorld(), 1_000);
    mounted.hud.applyOrders(ordersFixture({ nationId: "polity-2" }));
    mounted.hud.applyUpdate(
      worldFixture({
        history: historyFixture(POLITIES),
        nations: [nationFixture({ id: "polity-2", lastReport: report })],
      }),
      2_000,
    );
    return mounted;
  }

  it("keeps the strip and the panel out of the way for a spectator with no nation", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);

    expect(roots.strip.hidden).toBe(true);
    expect(roots.report.hidden).toBe(true);
  });

  it("shows the waiting headline in the strip as soon as a nation is held, before any report has resolved", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyOrders(ordersFixture({ nationId: "polity-2" }));

    expect(roots.strip.hidden).toBe(false);
    expect(roots.strip.textContent).toContain("最初の決算を待っています");
  });

  /**
   * hud.md §4.5: "This sentence, and only this sentence, goes to the always-on decision strip and the
   * live region" — so a screen-reader user learns a season resolved without having to poll the strip.
   */
  it("announces the season's headline to the live region when a season resolves", () => {
    const { roots } = boardedWithReport(reportFixture({ entries: [] }));

    expect(roots.status.textContent).toBe("この季は目立った変化がありませんでした。");
  });

  /**
   * The collision this guards: `applyWelcome`'s own "reconnected, orders were dropped" announcement runs
   * right after the boundary check, and a live region only speaks whichever `textContent` write landed
   * last. If the headline announced too, it would silently overwrite the reconnect notice — the more
   * important of the two, since it is the one telling the player their queued order is gone.
   */
  it("does not let a headline announcement on reconnect crowd out the reconnect notice", () => {
    const { roots, hud } = boardedWithReport(reportFixture({ year: 3, season: "summer" }));

    hud.applyWelcome(
      worldFixture({
        history: historyFixture(POLITIES),
        playerNationId: "polity-2",
        nations: [
          nationFixture({
            id: "polity-2",
            // A new boundary versus the one `boardedWithReport` already resolved, so the reconnect path
            // actually has something to (not) announce.
            lastReport: reportFixture({ year: 4, season: "winter", entries: [] }),
          }),
        ],
      }),
      5_000,
    );

    expect(roots.status.textContent).toBe("再接続しました。発令の履歴は失われました。");
  });

  /** The plan's third required test, at the DOM layer: no hole in the layout even for an empty season. */
  it("opens the report on R and shows all six metric rows even when the season had nothing in it", () => {
    const { roots, hud } = boardedWithReport(reportFixture({ entries: [] }));

    expect(roots.report.hidden).toBe(true);

    hud.toggleReport();

    expect(roots.report.hidden).toBe(false);
    expect(roots.report.querySelectorAll(".season-report__metric")).toHaveLength(6);
  });

  /** `R` itself, not just the controller method it calls — the two could disagree if the map ever did. */
  it("opens the report from the actual R keypress", () => {
    const { roots, hud } = boardedWithReport();
    const unbind = bindNationKeys(hud.send, () => hud.state(), {
      toggleDirectives: () => hud.toggleDirectives(),
      toggleReport: () => hud.toggleReport(),
      closeTopPanel: () => hud.closeTopPanel(),
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));

    expect(roots.report.hidden).toBe(false);
    unbind();
  });

  /**
   * hud.md §3.5/§4.2: opening a panel is a keyboard action, so it has to land somewhere a keyboard user
   * can act from — otherwise `R` opens a panel that reads as on screen but is invisible to Tab.
   */
  it("moves focus to the close button when the report opens", () => {
    const { roots, hud } = boardedWithReport();

    hud.toggleReport();

    expect(document.activeElement).toBe(roots.report.querySelector(".season-report__close"));
  });

  /**
   * The panel body is rebuilt wholesale on every render (`replaceChildren`), which would otherwise eject
   * focus to `<body>` the instant a season resolves while the player is reading the previous one —
   * exactly the boundary re-render hud.md §4.2 says must not disturb focus.
   */
  it("keeps focus on the close button across a season boundary that lands while the report stays open", () => {
    const { roots, hud } = boardedWithReport(reportFixture({ year: 3, season: "summer" }));
    hud.toggleReport();
    const firstClose = roots.report.querySelector(".season-report__close");
    expect(document.activeElement).toBe(firstClose);

    hud.applyUpdate(
      worldFixture({
        history: historyFixture(POLITIES),
        nations: [
          nationFixture({
            id: "polity-2",
            lastReport: reportFixture({
              year: 3,
              season: "autumn",
              entries: [ledgerEntry({ metric: "food", delta: 12 })],
            }),
          }),
        ],
      }),
      4_000,
    );

    const secondClose = roots.report.querySelector(".season-report__close");
    // A genuinely new node, not the one focus was already on — proof this is restored focus, not focus
    // that simply never moved.
    expect(secondClose).not.toBe(firstClose);
    expect(document.activeElement).toBe(secondClose);
  });

  /**
   * The strip is always-on chrome that repaints on every server update (§4.1), not only at a season
   * boundary — its own toggle button is rebuilt every time just like the panel's close button is, so it
   * needs the identical focus-preserving treatment, with the panel left closed throughout.
   */
  it("keeps focus on the strip's own toggle button across an ordinary repaint", () => {
    const { roots, hud } = boardedWithReport(reportFixture({ year: 3, season: "summer" }));
    const firstToggle = roots.strip.querySelector(".nation-strip__toggle");
    (firstToggle as HTMLElement | null)?.focus();
    expect(document.activeElement).toBe(firstToggle);

    hud.applyUpdate(
      worldFixture({
        history: historyFixture(POLITIES),
        nations: [
          nationFixture({
            id: "polity-2",
            lastReport: reportFixture({
              year: 3,
              season: "autumn",
              entries: [ledgerEntry({ metric: "food", delta: 12 })],
            }),
          }),
        ],
      }),
      4_000,
    );

    const secondToggle = roots.strip.querySelector(".nation-strip__toggle");
    expect(secondToggle).not.toBe(firstToggle);
    expect(document.activeElement).toBe(secondToggle);
    expect(roots.report.hidden).toBe(true);
  });

  /** hud.md §3.5: closing a panel returns focus to whatever opened it — here, the strip's own toggle. */
  it("returns focus to the opener when the season report closes", () => {
    const { roots, hud } = boardedWithReport(reportFixture({ year: 3, season: "summer" }));
    const opener = roots.strip.querySelector(".nation-strip__toggle");
    expect(opener).not.toBeNull();
    (opener as HTMLElement).focus();
    expect(document.activeElement).toBe(opener);

    hud.toggleReport();
    expect(roots.report.hidden).toBe(false);

    hud.toggleReport();

    expect(roots.report.hidden).toBe(true);
    // A genuinely new node: the strip repaints on the closing toggle too, same as it does on any other
    // update, so this is proof of restored focus rather than focus that simply never moved.
    const restoredOpener = roots.strip.querySelector(".nation-strip__toggle");
    expect(restoredOpener).not.toBe(opener);
    expect(document.activeElement).toBe(restoredOpener);
  });

  /**
   * The click path is not the keyboard path — see `directivePanel.ts`'s identical test for why
   * `document.activeElement` cannot be trusted at click time. The strip's own toggle must be captured
   * directly from the click itself, not read off whatever had focus beforehand.
   */
  it("returns focus to the strip's toggle button when it was clicked without being focused first", () => {
    const { roots, hud } = boardedWithReport(reportFixture({ year: 3, season: "summer" }));
    const opener = roots.strip.querySelector(".nation-strip__toggle");
    expect(opener).not.toBeNull();
    expect(document.activeElement).not.toBe(opener);

    (opener as HTMLElement).click();
    expect(roots.report.hidden).toBe(false);

    hud.toggleReport();

    expect(roots.report.hidden).toBe(true);
    const restoredOpener = roots.strip.querySelector(".nation-strip__toggle");
    expect(document.activeElement).toBe(restoredOpener);
  });

  /**
   * The report has a second opener beside the strip's own toggle: the dashboard's "施策を選ぶ" button is
   * focusable and `R` opens the report from anywhere. That button is exactly the node
   * `nationHud.renderPanels()` rebuilds on every `applyOrders`/`applyUpdate` — including while the report
   * sits open, unrelated to the report itself resolving.
   */
  it("returns focus to the rebuilt dashboard opener when it repaints while the report is still open", () => {
    const { roots, hud } = boardedWithReport(reportFixture({ year: 3, season: "summer" }));
    const opener = roots.dashboard.querySelector(".nation-dashboard__choose");
    expect(opener).not.toBeNull();
    (opener as HTMLElement).focus();

    hud.toggleReport();
    expect(roots.report.hidden).toBe(false);

    // Some other update lands while the report is still open — `autoPilot` flips off (the default from
    // `boardedWithReport` is on) so the dashboard's view model genuinely differs and its memoized render
    // is not skipped.
    hud.applyOrders(ordersFixture({ nationId: "polity-2", autoPilot: false }));
    const rebuiltOpener = roots.dashboard.querySelector(".nation-dashboard__choose");
    expect(rebuiltOpener).not.toBeNull();
    expect(rebuiltOpener).not.toBe(opener);

    hud.toggleReport();

    expect(roots.report.hidden).toBe(true);
    expect(document.activeElement).toBe(rebuiltOpener);
  });

  /**
   * The pin must not register an opener at all — hud.md §4.5 gives a famine the right to show the report,
   * not to claim a return destination for a player action that never happened. Closing it afterward must
   * not throw and must not yank focus to whatever the pin's own trigger happened to be.
   */
  it("does not return focus anywhere when a panel opened by the famine pin is later closed", () => {
    const famine = reportFixture({
      entries: [ledgerEntry({ metric: "population", delta: -200, reason: "famine" })],
    });
    const { roots, hud } = boardedWithReport(famine);
    expect(roots.report.hidden).toBe(false);
    expect(document.activeElement === null || document.activeElement === document.body).toBe(true);

    expect(() => hud.closeTopPanel()).not.toThrow();

    expect(roots.report.hidden).toBe(true);
    expect(document.activeElement === null || document.activeElement === document.body).toBe(true);
  });

  /**
   * The ambiguous case §3.5 leaves unstated: the opener can vanish from the document while the panel is
   * open. Closing must not throw and must not hand focus to a detached node.
   */
  it("does not throw and does not focus a detached opener when the opener is gone by close time", () => {
    const { roots, hud } = boardedWithReport(reportFixture({ year: 3, season: "summer" }));
    const ephemeral = document.createElement("button");
    document.body.append(ephemeral);
    ephemeral.focus();
    expect(document.activeElement).toBe(ephemeral);

    hud.toggleReport();
    ephemeral.remove();

    expect(() => hud.toggleReport()).not.toThrow();
    expect(roots.report.hidden).toBe(true);
    expect(document.activeElement).not.toBe(ephemeral);
  });

  /**
   * `heldOrderNote` is always null: a legal queued order commits in either autopilot mode
   * (`sim/nation/engine.ts` `selectDirective` runs `queuedSelection` before it looks at `autoPilot`,
   * pinned by the five state tests atop `nationEngine.test.ts`), and an illegal one is held but never
   * reported — the client judges no directive's legality. Checked in the mounted panel, not just the view
   * model, in the same otherwise-quiet-season fixture the old held-order state used.
   */
  it("renders no held-order element even with autopilot on and an order queued", () => {
    const mounted = mountAgainstIndexHtml();
    mounted.hud.applyWelcome(unclaimedWorld(), 1_000);
    mounted.hud.applyOrders(
      ordersFixture({
        nationId: "polity-2",
        autoPilot: true,
        queued: { id: "directive-9", kind: "holdFestival", targetCityId: null },
      }),
    );
    mounted.hud.applyUpdate(
      worldFixture({
        history: historyFixture(POLITIES),
        nations: [
          nationFixture({
            id: "polity-2",
            lastReport: reportFixture({ entries: [], completedDirectiveIds: [] }),
          }),
        ],
      }),
      2_000,
    );
    mounted.hud.toggleReport();

    expect(mounted.roots.report.querySelector(".season-report__held")).toBeNull();
  });

  /** hud.md §4.5: famine "pins the report open… it does not require the player to press R." */
  it("auto-opens the panel when a famine report resolves, without the player pressing R", () => {
    const famine = reportFixture({
      entries: [ledgerEntry({ metric: "population", delta: -200, reason: "famine" })],
    });
    const { roots } = boardedWithReport(famine);

    expect(roots.report.hidden).toBe(false);
    expect(roots.strip.classList.contains("nation-strip--famine")).toBe(true);
  });

  /**
   * The pin shows the report — it does not get to move the caret. hud.md §4.5 gives famine the right to
   * open the panel on its own, not to steal focus out from under a player who may be mid-decision
   * elsewhere (the directive panel, say) when the season happens to resolve.
   */
  it("does not steal focus when a famine season auto-opens the panel", () => {
    const famine = reportFixture({
      entries: [ledgerEntry({ metric: "population", delta: -200, reason: "famine" })],
    });
    const { roots } = boardedWithReport(famine);

    expect(roots.report.hidden).toBe(false);
    expect(document.activeElement).not.toBe(roots.report.querySelector(".season-report__close"));
    expect(document.activeElement === null || document.activeElement === document.body).toBe(true);
  });

  /**
   * The risk in pinning on the report at all: if the pin fired on object identity rather than on the
   * boundary the report belongs to, a `wsClient` that hands back a freshly built (but unchanged) world
   * snapshot on an ordinary tick would reopen a panel the player just closed, every tick, for the rest of
   * the famine season. This rebuilds the report as a new object with the same year and season to prove
   * the pin is keyed on the boundary, not on reference equality.
   */
  it("does not reopen a closed panel on a later repaint of the same famine season", () => {
    const famine = reportFixture({
      entries: [ledgerEntry({ metric: "population", delta: -200, reason: "famine" })],
    });
    const { roots, hud } = boardedWithReport(famine);
    expect(roots.report.hidden).toBe(false);

    hud.toggleReport();
    expect(roots.report.hidden).toBe(true);

    hud.applyUpdate(
      worldFixture({
        history: historyFixture(POLITIES),
        nations: [
          nationFixture({
            id: "polity-2",
            lastReport: { ...famine, entries: [...famine.entries] },
          }),
        ],
      }),
      3_000,
    );

    expect(roots.report.hidden).toBe(true);
  });

  /**
   * No stack of open panels is tracked (`nationHud.ts`'s `closeTopPanel`), so this pins the fixed
   * priority that decision was made with: the read-only report closes before the actionable directive
   * panel when `Escape` finds both open.
   */
  it("closes the report before the directive panel when both are open", () => {
    const { roots, hud } = mountAgainstIndexHtml();
    hud.applyWelcome(unclaimedWorld(), 1_000);
    hud.applyOrders(ordersFixture({ nationId: "polity-2", autoPilot: false }));
    hud.toggleDirectives();
    hud.toggleReport();

    expect(roots.directives.hidden).toBe(false);
    expect(roots.report.hidden).toBe(false);
    expect(hud.closeTopPanel()).toBe(true);

    expect(roots.report.hidden).toBe(true);
    expect(roots.directives.hidden).toBe(false);
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
