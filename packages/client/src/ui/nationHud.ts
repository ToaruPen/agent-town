import type { NationState, NationWorldState, Polity, SeasonReport } from "@agent-town/shared";

import type { SendClientMessage } from "../net/wsClient.js";
import { createDirectivePanel, type DirectivePanelController } from "./directivePanel.js";
import {
  buildDirectiveListViewModel,
  type DirectiveListViewModel,
  ordersAnnouncement,
} from "./directiveViewModel.js";
import { createNationClockBar, type NationClockBarController } from "./nationClockBar.js";
import { buildNationClockViewModel } from "./nationClockViewModel.js";
import { createNationDashboard, type NationDashboardController } from "./nationDashboard.js";
import {
  buildNationDashboardViewModel,
  type NationDashboardViewModel,
} from "./nationDashboardViewModel.js";
import {
  applyDisconnected,
  applyOrders,
  applyUpdate,
  applyWelcome,
  initialNationHudState,
  type NationHudState,
  type NationOrders,
  selectableNations,
} from "./nationHudState.js";
import { createNationSelect, type NationSelectController } from "./nationSelect.js";
import { createProsperityRanking, type ProsperityRankingController } from "./prosperityRanking.js";
import { buildProsperityRankingViewModel } from "./prosperityViewModel.js";
import { createSeasonReportPanel, type SeasonReportPanelController } from "./seasonReportPanel.js";
import { buildSeasonReportViewModel, type SeasonReportViewModel } from "./seasonReportViewModel.js";

const SEND_REFUSED_ANNOUNCEMENT = "接続が切れています。送信できませんでした。";

export interface NationHudRoots {
  clock: HTMLElement;
  dashboard: HTMLElement;
  ranking: HTMLElement;
  /** The candidate list, opened on demand. */
  directives: HTMLElement;
  /** The start-of-game picker, shown only while the player holds no nation. */
  select: HTMLElement;
  /** The existing `#world-status` live region; announcements go through it, the countdown never does. */
  status: HTMLElement;
  /** The always-on decision strip (hud.md §4.1), summarising the same report `report` shows in full. */
  strip: HTMLElement;
  /** The season report, opened on demand by `R` or by clicking the strip (hud.md §4.5). */
  report: HTMLElement;
}

export interface NationHudController {
  /**
   * The HUD's outbound channel, which is the one the keys must use. A refused send is announced in the live
   * region here, because a key has no control to grey out: without this, clicking during the reconnect gap
   * would be visibly refused while pressing `A` or `2` was swallowed in silence.
   */
  send: SendClientMessage;
  applyWelcome(world: NationWorldState, now: number): void;
  applyUpdate(world: NationWorldState, now: number): void;
  /** The whole order desk: the candidate list, what commits next, the mode, and any refusal. */
  applyOrders(orders: NationOrders): void;
  /**
   * The socket dropped. Repaints so the desk's controls stop offering to send — for the next second every
   * send is discarded, and a control that looks live is the one lie the desk cannot afford.
   */
  applyDisconnected(): void;
  toggleDirectives(): void;
  toggleReport(): void;
  /** True when a panel was open and has now been closed, so `Escape` can stop there. */
  closeTopPanel(): boolean;
  /** Called from a `requestAnimationFrame` loop and short-circuited here, not by the caller. */
  tick(now: number): void;
  state(): NationHudState;
}

interface Panels {
  clock: NationClockBarController;
  dashboard: NationDashboardController;
  ranking: ProsperityRankingController;
  directives: DirectivePanelController;
  select: NationSelectController;
  report: SeasonReportPanelController;
}

function ownPair(state: NationHudState): { nation: NationState; polity: Polity } | null {
  const nation = state.nations.find(({ id }) => id === state.playerNationId);
  const polity = state.history?.polities.find(({ id }) => id === state.playerNationId);
  if (nation === undefined || polity === undefined) return null;
  return { nation, polity };
}

function dashboardView(state: NationHudState): NationDashboardViewModel | null {
  const own = ownPair(state);
  return own === null
    ? null
    : buildNationDashboardViewModel(own.nation, own.polity, true, state.orders);
}

/** City names for `growCity`'s per-city cards; `NationCityState` carries only the id. */
function cityNames(state: NationHudState): ReadonlyMap<string, string> {
  return new Map((state.history?.worldMap.cities ?? []).map(({ id, name }) => [id, name] as const));
}

/**
 * Null only while there is nothing to choose from: no nation held, or no `orders` has ever arrived.
 *
 * Exported because this gate is where the reconnect rule actually lands. Gating on `state.orders` instead
 * would empty the panel after every `welcome` — the server sends no `orders` on connect — and at speed 0
 * there is no action left that would refill it. Gating on the list keeps the desk usable while `orders`
 * being null is what makes the mode, the star and the refusal read as unknown.
 */
export function directiveView(state: NationHudState): DirectiveListViewModel | null {
  const own = ownPair(state);
  if (own === null || state.options.length === 0) return null;
  return buildDirectiveListViewModel(
    state.options,
    state.orders,
    own.nation,
    own.polity,
    cityNames(state),
    state.speed,
    state.connected,
  );
}

/**
 * Null only while there is no nation to report on. Unlike `directiveView`, not gated on `state.options`:
 * the report has something honest to say (`waitingForFirstReport`) even before the first `orders`
 * message, so gating it the same way the candidate list is gated would blank a panel that should read as
 * waiting rather than as absent.
 */
export function seasonReportView(state: NationHudState): SeasonReportViewModel | null {
  const own = ownPair(state);
  if (own === null) return null;
  return buildSeasonReportViewModel(
    own.nation.lastReport,
    state.directiveLog,
    state.ownDirectiveIds,
    state.orders,
    state.currentYear,
  );
}

function hasFamineEntry(report: SeasonReport): boolean {
  return report.entries.some((entry) => entry.reason === "famine");
}

/**
 * Composes the always-on HUD and owns the state the panels read. The only nation module `main.ts`
 * talks to.
 *
 * Wall-clock time arrives as an argument on every call rather than being read in here, which is what
 * keeps every view model behind this a pure function of its inputs.
 */
export function createNationHud(
  roots: NationHudRoots,
  send: SendClientMessage,
): NationHudController {
  let state = initialNationHudState();
  let clockKey: string | null = null;
  let announcedSpeed: number | null = null;

  const announce = (message: string): void => {
    roots.status.textContent = message;
  };

  // Every outbound message goes through here, so there is exactly one place that turns a discarded send
  // into something the player can perceive.
  const post: SendClientMessage = (message) => {
    if (send(message)) return true;
    announce(SEND_REFUSED_ANNOUNCEMENT);
    return false;
  };

  const directives = createDirectivePanel(roots.directives, post);
  const panels: Panels = {
    clock: createNationClockBar(roots.clock, post),
    dashboard: createNationDashboard(roots.dashboard, {
      send: post,
      openDirectives: () => {
        if (!directives.isOpen()) directives.toggle();
      },
      readCanSend: () => state.connected,
    }),
    ranking: createProsperityRanking(roots.ranking),
    directives,
    select: createNationSelect(roots.select, post),
    report: createSeasonReportPanel({ strip: roots.strip, panel: roots.report }),
  };

  const renderPanels = (): void => {
    panels.select.render(selectableNations(state), state.history);
    panels.dashboard.render(dashboardView(state), state.generation);
    panels.dashboard.renderCanSend(state.connected);
    panels.directives.render(directiveView(state), state.generation);
    panels.report.render(seasonReportView(state), state.generation);
    panels.clock.renderAutoPilot(state.orders?.autoPilot ?? null);
    if (state.history !== null) {
      panels.ranking.render(
        buildProsperityRankingViewModel(state.nations, state.history, state.playerNationId),
        state.generation,
      );
    }
  };

  let lastSeenReportKey: string | null = null;

  /**
   * True exactly once per season boundary this report belongs to, as opposed to every repaint of an
   * unchanged one — keyed on the report's own (year, season) rather than on object identity: `wsClient`
   * is not guaranteed to hand back the same `SeasonReport` reference across an ordinary tick, and keying
   * on reference equality would either never fire (if it does) or fire on every repaint of an unchanged
   * season (if it does not). Advances `lastSeenReportKey` as a side effect, so a second caller checking
   * the same still-current report later in the same boundary correctly sees it as not-new.
   */
  const isNewReportBoundary = (report: SeasonReport): boolean => {
    const key = `${report.year}:${report.season}`;
    if (key === lastSeenReportKey) return false;
    lastSeenReportKey = key;
    return true;
  };

  /**
   * Runs the two things hud.md ties to a *new* season boundary:
   * - §4.5: "any famine entry pins the report open… it does not require the player to press R."
   * - §3.5 / §4.5: "This sentence, and only this sentence, goes to the always-on decision strip and
   *   the live region" — the one-line headline, on every resolved season, not only a famine one.
   *
   * `announceHeadline` is false from `applyWelcome`: a reconnect already gets its own "you're back,
   * queued orders were dropped" announcement immediately after this call, and a screen reader only
   * speaks whichever `announce()` call landed last, so sending the headline first would just be
   * overwritten in silence. The famine pin still runs on `applyWelcome` — reconnecting into an active
   * famine should still open the report — only the audio announcement is withheld there.
   *
   * Called after `renderPanels`, so `panels.report` (and, for the headline, `seasonReportView`) already
   * reflect this boundary before anything reacts to it.
   */
  const onReportBoundary = (announceHeadline: boolean): void => {
    const report = ownPair(state)?.nation.lastReport ?? null;
    if (report === null || !isNewReportBoundary(report)) return;
    if (announceHeadline) announce(seasonReportView(state)?.headline ?? "");
    if (!panels.report.isOpen() && hasFamineEntry(report)) panels.report.toggle();
  };

  const renderClock = (now: number): void => {
    const view = buildNationClockViewModel(state.clock, state.currentYear ?? 0, now);
    // Re-render only when a displayed value changes. Without this the bar would repaint 60×/s at x8
    // and, worse, keep repainting while paused, when by definition nothing is moving.
    const nextKey = [
      view.headline,
      view.paused,
      view.remainingSecondsLabel,
      view.remainingTicks,
      view.seasonProgress.toFixed(2),
      state.speed,
    ].join("|");
    if (nextKey === clockKey) return;
    clockKey = nextKey;
    panels.clock.render(view, state.speed);
  };

  return {
    send: post,

    applyWelcome(world: NationWorldState, now: number): void {
      const reconnected = state.generation > 0;
      state = applyWelcome(state, world);
      clockKey = null;
      announcedSpeed = state.speed;
      renderPanels();
      onReportBoundary(false);
      renderClock(now);
      announce(reconnected ? "再接続しました。発令の履歴は失われました。" : "世界に接続しました。");
    },

    applyUpdate(world: NationWorldState, now: number): void {
      state = applyUpdate(state, world, now);
      renderPanels();
      onReportBoundary(true);
      renderClock(now);
      if (state.speed !== announcedSpeed) {
        announcedSpeed = state.speed;
        announce(state.speed === 0 ? "一時停止しました。" : `速度をx${state.speed}にしました。`);
      }
    },

    applyOrders(orders: NationOrders): void {
      const claimed = state.playerNationId === null;
      const previous = state.orders;
      const activeIds = ownPair(state)?.nation.activeDirectives.map(({ id }) => id) ?? [];
      state = applyOrders(state, orders);
      renderPanels();
      if (claimed) {
        announce("国を選びました。");
        return;
      }
      const message = ordersAnnouncement(previous, orders, activeIds);
      if (message !== null) announce(message);
    },

    applyDisconnected(): void {
      state = applyDisconnected(state);
      renderPanels();
    },

    toggleDirectives(): void {
      panels.directives.toggle();
    },

    toggleReport(): void {
      panels.report.toggle();
    },

    /**
     * No stack of open panels is tracked, so "topmost" is a fixed priority rather than most-recently-
     * opened: the report is read-only and meant to be glanced at and dismissed, while the directive
     * panel is where a decision may be mid-flight, so `Escape` clears the read-only one first and leaves
     * the actionable one in place if both happen to be open.
     */
    closeTopPanel(): boolean {
      if (panels.report.isOpen()) {
        panels.report.close();
        return true;
      }
      if (!panels.directives.isOpen()) return false;
      panels.directives.close();
      return true;
    },

    tick(now: number): void {
      if (state.clock === null || state.clock.speed === 0) return;
      renderClock(now);
    },

    state(): NationHudState {
      return state;
    },
  };
}
