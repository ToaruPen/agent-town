import type { NationState, NationWorldState, Polity } from "@agent-town/shared";

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
}

export interface NationHudController {
  applyWelcome(world: NationWorldState, now: number): void;
  applyUpdate(world: NationWorldState, now: number): void;
  /** The whole order desk: the candidate list, what commits next, the mode, and any refusal. */
  applyOrders(orders: NationOrders): void;
  toggleDirectives(): void;
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
  );
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

  const directives = createDirectivePanel(roots.directives, send);
  const panels: Panels = {
    clock: createNationClockBar(roots.clock, send),
    dashboard: createNationDashboard(roots.dashboard, {
      send,
      openDirectives: () => {
        if (!directives.isOpen()) directives.toggle();
      },
    }),
    ranking: createProsperityRanking(roots.ranking),
    directives,
    select: createNationSelect(roots.select, send),
  };

  const announce = (message: string): void => {
    roots.status.textContent = message;
  };

  const renderPanels = (): void => {
    panels.select.render(selectableNations(state), state.history);
    panels.dashboard.render(dashboardView(state), state.generation);
    panels.directives.render(directiveView(state), state.generation);
    panels.clock.renderAutoPilot(state.orders?.autoPilot ?? null);
    if (state.history !== null) {
      panels.ranking.render(
        buildProsperityRankingViewModel(state.nations, state.history, state.playerNationId),
        state.generation,
      );
    }
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
    applyWelcome(world: NationWorldState, now: number): void {
      const reconnected = state.generation > 0;
      state = applyWelcome(state, world);
      clockKey = null;
      announcedSpeed = state.speed;
      renderPanels();
      renderClock(now);
      announce(reconnected ? "再接続しました。発令の履歴は失われました。" : "世界に接続しました。");
    },

    applyUpdate(world: NationWorldState, now: number): void {
      state = applyUpdate(state, world, now);
      renderPanels();
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

    toggleDirectives(): void {
      panels.directives.toggle();
    },

    closeTopPanel(): boolean {
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
