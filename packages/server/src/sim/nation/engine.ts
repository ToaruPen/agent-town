import {
  type ActiveDirective,
  type DirectiveId,
  type DirectiveKind,
  type DirectiveOption,
  NATION_TICKS_PER_SEASON,
  type NationId,
  type NationState,
  type Polity,
  type SeasonReport,
  type WorldHistory,
} from "@agent-town/shared";

import { chooseDirective } from "./chancellor.js";
import { listDirectiveOptions } from "./directives.js";
import { resolveSeason } from "./season.js";

export interface NationEngineState {
  tick: number;
  nations: NationState[];
}

export interface QueuedDirective {
  id: DirectiveId;
  nationId: NationId;
  kind: DirectiveKind;
  targetCityId: string | null;
  issuedAtTick: number;
}

export interface NationEngineStep {
  state: NationEngineState;
  reports: Map<NationId, SeasonReport>;
  consumedQueuedDirectiveIds: DirectiveId[];
}

interface DirectiveSelection {
  directive: ActiveDirective;
  consumedQueuedDirectiveId: DirectiveId | null;
}

function matchingOption(
  options: readonly DirectiveOption[],
  kind: DirectiveKind,
  targetCityId: string | null,
): DirectiveOption | undefined {
  return options.find(
    (option) =>
      option.kind === kind && option.targetCityId === targetCityId && option.blockedReason === null,
  );
}

function queuedSelection(
  nation: NationState,
  options: readonly DirectiveOption[],
  queuedDirectives: readonly QueuedDirective[],
): DirectiveSelection | null {
  const queued = queuedDirectives.find(({ nationId }) => nationId === nation.id);
  if (queued === undefined) return null;
  const option = matchingOption(options, queued.kind, queued.targetCityId);
  if (option === undefined) return null;
  return {
    directive: {
      id: queued.id,
      kind: option.kind,
      targetCityId: option.targetCityId,
      issuedAtTick: queued.issuedAtTick,
      seasonsRemaining: option.seasons,
      totalSeasons: option.seasons,
    },
    consumedQueuedDirectiveId: queued.id,
  };
}

function chancellorSelection(
  nation: NationState,
  polity: Polity,
  options: readonly DirectiveOption[],
  tick: number,
): DirectiveSelection | null {
  const option = chooseDirective(nation, polity, options, nation.lastReport);
  if (option === null) return null;
  return {
    directive: {
      id: `chancellor-${nation.id}-${tick}`,
      kind: option.kind,
      targetCityId: option.targetCityId,
      issuedAtTick: tick,
      seasonsRemaining: option.seasons,
      totalSeasons: option.seasons,
    },
    consumedQueuedDirectiveId: null,
  };
}

function selectDirective(
  nation: NationState,
  polity: Polity,
  history: WorldHistory,
  queuedDirectives: readonly QueuedDirective[],
  tick: number,
): DirectiveSelection | null {
  const options = listDirectiveOptions(nation, polity, history.worldMap);
  if (nation.controller === "agent" || nation.autoPilot) {
    return chancellorSelection(nation, polity, options, tick);
  }
  return queuedSelection(nation, options, queuedDirectives);
}

function activateBoundaryDirectives(
  nations: readonly NationState[],
  history: WorldHistory,
  queuedDirectives: readonly QueuedDirective[],
  tick: number,
): { nations: NationState[]; consumedQueuedDirectiveIds: DirectiveId[] } {
  const polityById = new Map(history.polities.map((polity) => [polity.id, polity]));
  const consumedQueuedDirectiveIds: DirectiveId[] = [];
  const activated = nations.map((nation) => {
    const polity = polityById.get(nation.id);
    if (polity === undefined) throw new Error(`missing polity for nation ${nation.id}`);
    const selection = selectDirective(nation, polity, history, queuedDirectives, tick);
    if (selection === null) return nation;
    if (selection.consumedQueuedDirectiveId !== null) {
      consumedQueuedDirectiveIds.push(selection.consumedQueuedDirectiveId);
    }
    return {
      ...nation,
      activeDirectives: [...nation.activeDirectives, selection.directive],
    };
  });
  return { nations: activated, consumedQueuedDirectiveIds };
}

export function advanceNationEngine(
  state: NationEngineState,
  history: WorldHistory,
  queuedDirectives: readonly QueuedDirective[],
): NationEngineStep {
  const tick = state.tick + 1;
  if (tick % NATION_TICKS_PER_SEASON !== 0) {
    return {
      state: { tick, nations: state.nations },
      reports: new Map(),
      consumedQueuedDirectiveIds: [],
    };
  }

  const activated = activateBoundaryDirectives(state.nations, history, queuedDirectives, tick);
  const resolved = resolveSeason(activated.nations, history.polities, history.worldMap, tick);
  return {
    state: { tick, nations: resolved.nations },
    reports: resolved.reports,
    consumedQueuedDirectiveIds: activated.consumedQueuedDirectiveIds,
  };
}
