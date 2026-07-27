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

/**
 * What the client remembers about a directive it has actually seen, for the season report's "完了した
 *施策" line (hud.md §4.5). The server never resends a completed directive's kind or issue date —
 * `completedDirectiveIds` on `SeasonReport` is ids only — so this is bookkeeping over facts already sent
 * (`ActiveDirective.kind`/`issuedAtTick`, or `orders.queued`), never a value invented client-side.
 */
export interface DirectiveLogEntry {
  kind: DirectiveKind;
  issuedAtTick: number;
}

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
  /**
   * Whether there is a socket to send on. False until the first `welcome` and again for the second between
   * a drop and the reconnect, during which every send is discarded — so the desk's controls must stop
   * offering to send rather than look live and do nothing.
   */
  connected: boolean;
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
  /**
   * Every directive this session has seen the kind and issue tick of, keyed by id. Populated from
   * `activeDirectives` as it arrives and from `orders.queued`, never overwritten once a key exists —
   * a directive's kind does not change after it is issued, so the first sighting is authoritative.
   *
   * Survives `welcome`, unlike `orders`: this is a record of what was observed, not an assertion about
   * the next boundary, so a reconnect gap does not invalidate it (measured against `sim/nation/engine.ts`
   * — a directive's id and kind are fixed at selection and untouched by anything a gap could have done).
   */
  directiveLog: ReadonlyMap<DirectiveId, DirectiveLogEntry>;
  /**
   * Ids the player themself queued, via `orders.queued`. This is what lets the season report attribute a
   * completed directive to "あなたの発令" rather than the chancellor — `completedDirectiveIds` carries no
   * such flag. Survives `welcome` for the same reason `directiveLog` does.
   */
  ownDirectiveIds: ReadonlySet<DirectiveId>;
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
    connected: false,
    speed: 0,
    lastNonZeroSpeed: DEFAULT_RESUME_SPEED,
    generation: 0,
    directiveLog: new Map(),
    ownDirectiveIds: new Set(),
  };
}

/**
 * Folds any directive not already logged into the map, from a fresh `nations` snapshot. Returns the same
 * reference when nothing is new, so the render-key dedupe two panels rely on is not defeated by a map
 * that is structurally identical but freshly allocated.
 */
function mergedDirectiveLog(
  log: ReadonlyMap<DirectiveId, DirectiveLogEntry>,
  nations: readonly NationState[],
): ReadonlyMap<DirectiveId, DirectiveLogEntry> {
  let next: Map<DirectiveId, DirectiveLogEntry> | null = null;
  for (const nation of nations) {
    for (const directive of nation.activeDirectives) {
      if (log.has(directive.id)) continue;
      next ??= new Map(log);
      next.set(directive.id, { kind: directive.kind, issuedAtTick: directive.issuedAtTick });
    }
  }
  return next ?? log;
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
 *
 * `directiveLog` survives for the same reason `options` does: it is a record of what was observed, not a
 * claim about what comes next, so a gap does not make it stale. `ownDirectiveIds` does not survive —
 * hud.md §3.6 states the rule directly: "Queued-order bookkeeping (the set of ids the player ordered) is
 * dropped, not replayed," with the consequence spelled out — "directives issued before the reconnect are
 * attributed to 宰相 in later reports." That consequence is only reachable if `directiveLog` keeps the
 * directive's kind while `ownDirectiveIds` forgets who queued it, which is why the two fields, both
 * populated from the same `orders.queued`, part company here.
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
    connected: true,
    speed: world.speed,
    lastNonZeroSpeed: rememberRunningSpeed(state.lastNonZeroSpeed, world.speed),
    generation: state.generation + 1,
    directiveLog: mergedDirectiveLog(state.directiveLog, world.nations),
    ownDirectiveIds: new Set(),
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
    directiveLog: mergedDirectiveLog(state.directiveLog, world.nations),
  };
}

/**
 * `queued.id`'s kind and issue tick, the moment they arrive — the one directive-log source that reaches a
 * one-season directive (`holdFestival`) before it completes. `engine.ts` `activateBoundaryDirectives`
 * adds a freshly selected directive and resolves the season in the same boundary, so a chancellor-picked
 * festival is never seen sitting in `activeDirectives` first; a player-queued one still passes through
 * here before that boundary runs. Never overwrites an existing key, so the *first* sighting's tick is
 * what is kept — `queued` can repeat across several `orders` messages while autopilot holds it.
 */
function observedFromOrders(
  log: ReadonlyMap<DirectiveId, DirectiveLogEntry>,
  ownIds: ReadonlySet<DirectiveId>,
  orders: NationOrders,
): {
  directiveLog: ReadonlyMap<DirectiveId, DirectiveLogEntry>;
  ownDirectiveIds: ReadonlySet<DirectiveId>;
} {
  const queued = orders.queued;
  if (queued === null) return { directiveLog: log, ownDirectiveIds: ownIds };
  const directiveLog = log.has(queued.id)
    ? log
    : new Map(log).set(queued.id, { kind: queued.kind, issuedAtTick: orders.tick });
  const ownDirectiveIds = ownIds.has(queued.id) ? ownIds : new Set(ownIds).add(queued.id);
  return { directiveLog, ownDirectiveIds };
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
  const observed = observedFromOrders(state.directiveLog, state.ownDirectiveIds, orders);
  return {
    ...state,
    playerNationId: orders.nationId,
    options: orders.options,
    orders,
    directiveLog: observed.directiveLog,
    ownDirectiveIds: observed.ownDirectiveIds,
  };
}

/**
 * The socket dropped. Only the send channel is touched: the last payload stays on screen, because it is
 * still the most recent thing the server said and blanking it would lose more than it clarified.
 */
export function applyDisconnected(state: NationHudState): NationHudState {
  return { ...state, connected: false };
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
