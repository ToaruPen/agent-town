import type { NationId, NationState, NationWorldState, Polity } from "@agent-town/shared";

import type { SendClientMessage } from "../net/wsClient.js";
import { createNationClockBar, type NationClockBarController } from "./nationClockBar.js";
import { buildNationClockViewModel } from "./nationClockViewModel.js";
import { createNationDashboard, type NationDashboardController } from "./nationDashboard.js";
import {
  buildNationDashboardViewModel,
  type NationDashboardViewModel,
} from "./nationDashboardViewModel.js";
import {
  adoptPlayerNation,
  applyUpdate,
  applyWelcome,
  initialNationHudState,
  type NationHudState,
  selectableNations,
} from "./nationHudState.js";
import { createNationSelect, type NationSelectController } from "./nationSelect.js";
import { createProsperityRanking, type ProsperityRankingController } from "./prosperityRanking.js";
import { buildProsperityRankingViewModel } from "./prosperityViewModel.js";

export interface NationHudRoots {
  clock: HTMLElement;
  dashboard: HTMLElement;
  ranking: HTMLElement;
  /** The start-of-game picker, shown only while the player holds no nation. */
  select: HTMLElement;
  /** The existing `#world-status` live region; announcements go through it, the countdown never does. */
  status: HTMLElement;
}

export interface NationHudController {
  applyWelcome(world: NationWorldState, now: number): void;
  applyUpdate(world: NationWorldState, now: number): void;
  /** Takes only `nationId` — the server's acknowledgement that a `selectNation` landed. */
  applyOrdersNation(nationId: NationId): void;
  /** Called from a `requestAnimationFrame` loop and short-circuited here, not by the caller. */
  tick(now: number): void;
  state(): NationHudState;
}

interface Panels {
  clock: NationClockBarController;
  dashboard: NationDashboardController;
  ranking: ProsperityRankingController;
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
  return own === null ? null : buildNationDashboardViewModel(own.nation, own.polity, true);
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

  const panels: Panels = {
    clock: createNationClockBar(roots.clock, send),
    dashboard: createNationDashboard(roots.dashboard),
    ranking: createProsperityRanking(roots.ranking),
    select: createNationSelect(roots.select, send),
  };

  const announce = (message: string): void => {
    roots.status.textContent = message;
  };

  const renderPanels = (): void => {
    panels.select.render(selectableNations(state), state.history);
    panels.dashboard.render(dashboardView(state), state.generation);
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

    applyOrdersNation(nationId: NationId): void {
      const claimed = state.playerNationId === null;
      state = adoptPlayerNation(state, nationId);
      renderPanels();
      if (claimed) announce("国を選びました。");
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
