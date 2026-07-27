import {
  type ClientMessage,
  type DirectiveId,
  type DirectiveKind,
  type DirectiveOption,
  type NationId,
  type NationState,
  type NationWorldState,
  type ServerMessage,
  SPEED_MULTIPLIERS,
  type SpeedMultiplier,
  type WorldHistory,
} from "@agent-town/shared";

import type { NationClockSnapshot } from "./nationClockViewModel.js";

/** The `orders` message verbatim. The order desk renders the server's answer, never its own guess. */
export type NationOrders = Extract<ServerMessage, { type: "orders" }>;

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
  /**
   * The candidate list on its own, because it is the one part of an `orders` message that survives a
   * reconnect. Every kind is present every season and the server re-validates anything issued from it,
   * so a carried-over list is usable rather than a claim.
   */
  options: readonly DirectiveOption[];
  /**
   * The server's assertions about the *next boundary* — what is queued, which way autopilot is running,
   * what the chancellor picked, what was just refused. Null before the first `orders` and again after a
   * `welcome`, because none of it is knowable across a gap. The commit slot reads only this, so it
   * cannot name a decision the server has not stated for the season that is actually running.
   */
  orders: NationOrders | null;
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
    options: [],
    orders: null,
    speed: 0,
    lastNonZeroSpeed: DEFAULT_RESUME_SPEED,
    generation: 0,
  };
}

function rememberRunningSpeed(previous: SpeedMultiplier, next: SpeedMultiplier): SpeedMultiplier {
  return next === 0 ? previous : next;
}

/**
 * Re-establishes everything. The HUD must not assume it saw the seasons that passed during a gap.
 *
 * The two halves of the order desk part company here, which is why they are stored apart. The candidate
 * list survives: the server sends nothing but `welcome` on connect (`net/wsServer.ts` `startServer`), so
 * dropping it would leave the desk with no options at speed 0 — and with no options there is no action to
 * take that would fetch new ones. Carrying it is safe because it is not a claim; the server re-validates
 * every issue and refuses a stale target with a reason.
 *
 * `orders` does not survive, because every field in it is an assertion about the next boundary and a gap
 * of unknown length just passed. The queued order may have committed or been cleared (`selectNation` nulls
 * it), autopilot may have been flipped from another connection — `playerNationId` and `autoPilot` live on
 * the shared runtime, not the session — and the chancellor's pick was for a season that may be over. The
 * slot reads 同期中 until the next `orders`, which is the one thing here that is true.
 */
export function applyWelcome(state: NationHudState, world: NationWorldState): NationHudState {
  return {
    currentYear: world.history.currentYear,
    history: world.history,
    nations: world.nations,
    playerNationId: world.playerNationId,
    clock: null,
    options: state.options,
    orders: null,
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
 * The whole order desk, and the only place the client learns which nation is its own:
 * `wsServer.selectNation` replies with `orders` without re-sending `welcome`, so `orders.nationId` is
 * the acknowledgement that a selection landed.
 *
 * The message is stored verbatim. Nothing is merged into it and nothing is predicted from it, which is
 * what makes `rejected` a refusal rather than a hint: a refused issue arrives with the queued slot
 * exactly as the server still holds it (measured — a refusal never disturbs `queued`).
 */
export function applyOrders(state: NationHudState, orders: NationOrders): NationHudState {
  return { ...state, playerNationId: orders.nationId, options: orders.options, orders };
}

export function issueDirectiveCommand(
  kind: DirectiveKind,
  targetCityId: string | null,
): ClientMessage {
  return { type: "issueDirective", kind, targetCityId };
}

export function cancelDirectiveCommand(directiveId: DirectiveId): ClientMessage {
  return { type: "cancelDirective", directiveId };
}

export function setAutoPilotCommand(enabled: boolean): ClientMessage {
  return { type: "setAutoPilot", enabled };
}

function isAutoPilotKey(key: string): boolean {
  return key === "a" || key === "A";
}

/**
 * `A` toggles autopilot against the server's last echo, never against a local guess. With no `orders`
 * yet there is nothing to toggle — sending `enabled: true` on the assumption that the default is off
 * would flip a nation that already starts autopiloted (`sim/nation/bootstrap.ts` sets `autoPilot: true`).
 */
export function autoPilotCommandForKey(key: string, state: NationHudState): ClientMessage | null {
  if (!isAutoPilotKey(key)) return null;
  if (state.orders === null) return null;
  return setAutoPilotCommand(!state.orders.autoPilot);
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

/**
 * The whole server half of the key map, routed by owner rather than by first non-null answer.
 *
 * `A` is dispatched on the key, not on whether a command came back, so a key that autopilot owns can
 * never reach the speed handler. Chaining the two with `??` would send `A` on to `speedCommandForKey`
 * whenever no `orders` had arrived yet, where today it is stopped only by `Number("a")` being `NaN` —
 * safe by coincidence, and a coincidence no test could hold in place.
 */
export function nationKeyCommand(key: string, state: NationHudState): ClientMessage | null {
  if (isAutoPilotKey(key)) return autoPilotCommandForKey(key, state);
  return speedCommandForKey(key, state);
}
