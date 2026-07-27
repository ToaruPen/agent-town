import {
  type ClientMessage,
  type NationId,
  type NationState,
  type NationWorldState,
  SPEED_MULTIPLIERS,
  type SpeedMultiplier,
  type WorldHistory,
} from "@agent-town/shared";

import type { NationClockSnapshot } from "./nationClockViewModel.js";

export interface NationHudState {
  /** `history.currentYear`, captured once from `welcome`; it never changes mid-game. */
  currentYear: number | null;
  history: WorldHistory | null;
  nations: readonly NationState[];
  playerNationId: NationId | null;
  /**
   * The countdown's source, deliberately null until the first message after a `welcome`. `welcome`
   * carries a tick, but it is the tick from when the server built the message, so seeding the countdown
   * from it would count down from stale data after a reconnect. The bar reads 同期中 until then.
   */
  clock: NationClockSnapshot | null;
  /** Which speed button is lit. Seeded by `welcome` so the control is honest before the first update. */
  speed: SpeedMultiplier;
  lastNonZeroSpeed: SpeedMultiplier;
  /**
   * Bumped only by `welcome`. The panels dedupe on a rendered key, so a reconnect whose payload happens
   * to match what is already on screen would be skipped and anything the welcome should have cleared
   * would survive. Including this in the key makes the invalidation explicit rather than depending on
   * the values differing.
   */
  generation: number;
}

const DEFAULT_RESUME_SPEED: SpeedMultiplier = 1;

export function initialNationHudState(): NationHudState {
  return {
    currentYear: null,
    history: null,
    nations: [],
    playerNationId: null,
    clock: null,
    speed: 0,
    lastNonZeroSpeed: DEFAULT_RESUME_SPEED,
    generation: 0,
  };
}

function rememberRunningSpeed(previous: SpeedMultiplier, next: SpeedMultiplier): SpeedMultiplier {
  return next === 0 ? previous : next;
}

/** Re-establishes everything. The HUD must not assume it saw the seasons that passed during a gap. */
export function applyWelcome(state: NationHudState, world: NationWorldState): NationHudState {
  return {
    currentYear: world.history.currentYear,
    history: world.history,
    nations: world.nations,
    playerNationId: world.playerNationId,
    clock: null,
    speed: world.speed,
    lastNonZeroSpeed: rememberRunningSpeed(state.lastNonZeroSpeed, world.speed),
    generation: state.generation + 1,
  };
}

/**
 * Any post-welcome state message — `clock` or `season`, already merged by `wsClient` into the world it
 * belongs to. Both carry authoritative time, so both re-stamp the countdown; `season` carries no speed
 * of its own, and the merge preserves the last one rather than inventing a value here.
 */
export function applyUpdate(
  state: NationHudState,
  world: NationWorldState,
  now: number,
): NationHudState {
  return {
    ...state,
    nations: world.nations,
    clock: {
      tick: world.tick,
      year: world.year,
      season: world.season,
      speed: world.speed,
      receivedAt: now,
    },
    speed: world.speed,
    lastNonZeroSpeed: rememberRunningSpeed(state.lastNonZeroSpeed, world.speed),
  };
}

/**
 * The server's acknowledgement that a `selectNation` landed.
 *
 * `wsServer.selectNation` sets the player's nation and replies with `orders`, without re-sending
 * `welcome` — so `orders.nationId` is the only place the client learns which nation is now its own.
 * Only the id is taken here; the candidate list, the queued order and the chancellor's choice are the
 * order desk's, and this HUD does not read them.
 */
export function adoptPlayerNation(state: NationHudState, nationId: NationId): NationHudState {
  if (state.playerNationId === nationId) return state;
  return { ...state, playerNationId: nationId };
}

/** Nations the player may still claim. Empty once one is held, which is what hides the picker. */
export function selectableNations(state: NationHudState): readonly NationState[] {
  return state.playerNationId === null ? state.nations : [];
}

export function selectNationCommand(nationId: NationId): ClientMessage {
  return { type: "selectNation", nationId };
}

function isSpeedMultiplier(value: number): value is SpeedMultiplier {
  return (SPEED_MULTIPLIERS as readonly number[]).includes(value);
}

export function setSpeedCommand(speed: SpeedMultiplier): ClientMessage {
  return { type: "setSpeed", speed };
}

/** The speed half of the §3.5 key map: digits set a speed outright, `P` toggles pause both ways. */
export function speedCommandForKey(key: string, state: NationHudState): ClientMessage | null {
  if (key === "p" || key === "P") {
    return setSpeedCommand(state.speed === 0 ? state.lastNonZeroSpeed : 0);
  }
  if (key.length !== 1) return null;
  const requested = Number(key);
  if (Number.isNaN(requested) || !isSpeedMultiplier(requested)) return null;
  return setSpeedCommand(requested);
}
