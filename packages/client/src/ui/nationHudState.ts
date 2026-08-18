import {
  type ActiveDirective,
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
 * (`ActiveDirective.kind`/`issuedAtTick`, `orders.queued`, or `orders.chancellorChoice`), never a value
 * invented client-side.
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
   * `activeDirectives` as it arrives, from `orders.queued`, and from `orders.chancellorChoice` (see
   * `observedFromOrders` for why the last of those is logged before it is known to commit) — first
   * sighting is authoritative for `queued` and for an already-confirmed id, but a chancellor's preview
   * keeps updating in place until `activeDirectives` confirms it; see `previewDirectiveIds`.
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
  /**
   * Ids in `directiveLog` whose current value is a chancellor's `chancellorChoice` preview that has not
   * yet been confirmed by `activeDirectives` — `chooseDirective` re-runs on every `orders` message, so
   * the projected kind can change mid-season under the same id (`chancellorDirectiveId` embeds only the
   * boundary tick, not the kind). While an id is here, a later preview for it overwrites the log entry
   * in place. The first `activeDirectives` sighting for that id is the actual commit, which always
   * outranks any preview: it overwrites the entry regardless of what was there and retires the id from
   * this set, after which no preview can touch that entry again — matching how `chancellorDirectiveId`'s
   * boundary tick only advances, so the server never re-sends a preview for an id whose boundary has
   * already passed. Survives `welcome` for the same reason `directiveLog` does: dropping it would let a
   * still-revisable preview freeze at whatever the reconnect happened to catch.
   */
  previewDirectiveIds: ReadonlySet<DirectiveId>;
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
    previewDirectiveIds: new Set(),
  };
}

/**
 * One `activeDirectives` sighting folded in: added if not already logged, or — if it was logged as a
 * still-revisable chancellor preview — overwritten regardless of what the preview said, retiring the id
 * from `previewIds` so no later preview can touch it again. Every other id keeps first-sighting-wins,
 * unchanged. An unchanged directive returns the same references, so a snapshot that adds nothing to the
 * log leaves both fields identically as they were.
 */
function mergedDirectiveLogEntry(
  log: ReadonlyMap<DirectiveId, DirectiveLogEntry>,
  previewIds: ReadonlySet<DirectiveId>,
  directive: ActiveDirective,
): {
  directiveLog: ReadonlyMap<DirectiveId, DirectiveLogEntry>;
  previewDirectiveIds: ReadonlySet<DirectiveId>;
} {
  const isUnconfirmedPreview = previewIds.has(directive.id);
  if (log.has(directive.id) && !isUnconfirmedPreview) {
    return { directiveLog: log, previewDirectiveIds: previewIds };
  }
  const directiveLog = new Map(log).set(directive.id, {
    kind: directive.kind,
    issuedAtTick: directive.issuedAtTick,
  });
  let previewDirectiveIds: ReadonlySet<DirectiveId> = previewIds;
  if (isUnconfirmedPreview) {
    const retired = new Set(previewIds);
    retired.delete(directive.id);
    previewDirectiveIds = retired;
  }
  return { directiveLog, previewDirectiveIds };
}

/** Folds every directive across a fresh `nations` snapshot into the log, one sighting at a time. */
function mergedDirectiveLog(
  log: ReadonlyMap<DirectiveId, DirectiveLogEntry>,
  previewIds: ReadonlySet<DirectiveId>,
  nations: readonly NationState[],
): {
  directiveLog: ReadonlyMap<DirectiveId, DirectiveLogEntry>;
  previewDirectiveIds: ReadonlySet<DirectiveId>;
} {
  let result = { directiveLog: log, previewDirectiveIds: previewIds };
  for (const directive of nations.flatMap((nation) => nation.activeDirectives)) {
    result = mergedDirectiveLogEntry(result.directiveLog, result.previewDirectiveIds, directive);
  }
  return result;
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
  const merged = mergedDirectiveLog(state.directiveLog, state.previewDirectiveIds, world.nations);
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
    directiveLog: merged.directiveLog,
    ownDirectiveIds: new Set(),
    previewDirectiveIds: merged.previewDirectiveIds,
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
  const merged = mergedDirectiveLog(state.directiveLog, state.previewDirectiveIds, world.nations);
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
    directiveLog: merged.directiveLog,
    previewDirectiveIds: merged.previewDirectiveIds,
  };
}

/**
 * `queued.id`'s kind and issue tick, the moment they arrive, plus `chancellorChoice.id`'s — between the
 * two, every directive-log source that reaches a one-season directive (`holdFestival`) before it
 * completes. `engine.ts` `activateBoundaryDirectives` adds a freshly selected directive and resolves the
 * season in the same boundary, so a chancellor-picked festival is never seen sitting in
 * `activeDirectives` first; a player-queued one still passes through `queued` before that boundary runs,
 * and the chancellor's own preview passes through `chancellorChoice` regardless of whether it ever
 * commits. Neither ever populates `ownDirectiveIds` for the chancellor's pick — it is never the player's
 * own — which is what lets `attributionFor` read a logged-but-not-owned id as 宰相の決定.
 *
 * `queued` keeps first-sighting-wins: it never overwrites an existing key, since `queued` can repeat
 * across several `orders` messages within the same season right up to the boundary that consumes it, and
 * what it names is already exactly what will commit if it does. `chancellorChoice` is different —
 * `chooseDirective` re-runs on every `orders` message and can project a different kind for the *same* id
 * across the season (`chancellorDirectiveId` embeds only the boundary tick, not the kind) — so a preview
 * keeps overwriting in place until `mergedDirectiveLog` confirms it from `activeDirectives`, tracked via
 * `previewDirectiveIds`. An id already confirmed there, or belonging to `queued` (a disjoint id space —
 * `chancellor-` prefixed versus server-assigned), is left alone.
 */
function observedFromOrders(
  log: ReadonlyMap<DirectiveId, DirectiveLogEntry>,
  ownIds: ReadonlySet<DirectiveId>,
  previewIds: ReadonlySet<DirectiveId>,
  orders: NationOrders,
): {
  directiveLog: ReadonlyMap<DirectiveId, DirectiveLogEntry>;
  ownDirectiveIds: ReadonlySet<DirectiveId>;
  previewDirectiveIds: ReadonlySet<DirectiveId>;
} {
  const queued = orders.queued;
  const directiveLog =
    queued === null || log.has(queued.id)
      ? log
      : new Map(log).set(queued.id, { kind: queued.kind, issuedAtTick: orders.tick });
  const ownDirectiveIds =
    queued === null || ownIds.has(queued.id) ? ownIds : new Set(ownIds).add(queued.id);
  const choice = orders.chancellorChoice;
  const choiceAlreadySettled =
    choice !== null && directiveLog.has(choice.id) && !previewIds.has(choice.id);
  const withChancellorChoice =
    choice === null || choiceAlreadySettled
      ? directiveLog
      : new Map(directiveLog).set(choice.id, {
          kind: choice.kind,
          issuedAtTick: choice.issuedAtTick,
        });
  const previewDirectiveIds =
    choice === null || choiceAlreadySettled || previewIds.has(choice.id)
      ? previewIds
      : new Set(previewIds).add(choice.id);
  return { directiveLog: withChancellorChoice, ownDirectiveIds, previewDirectiveIds };
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
  const observed = observedFromOrders(
    state.directiveLog,
    state.ownDirectiveIds,
    state.previewDirectiveIds,
    orders,
  );
  return {
    ...state,
    playerNationId: orders.nationId,
    options: orders.options,
    orders,
    directiveLog: observed.directiveLog,
    ownDirectiveIds: observed.ownDirectiveIds,
    previewDirectiveIds: observed.previewDirectiveIds,
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
