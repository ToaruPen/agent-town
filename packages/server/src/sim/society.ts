import {
  type AgentId,
  type AgentState,
  COLLECTIVE_DISSOLUTION_COHESION,
  COLLECTIVE_DISSOLUTION_TICKS,
  COLLECTIVE_FORMATION_TICKS,
  COLLECTIVE_MIN_SUPPORTERS,
  type Collective,
  foodDaysRemaining,
  INSTITUTION_FOOD_PRESSURE_DAYS,
  INSTITUTION_KINDS,
  type InstitutionKind,
  type Provenance,
  SOCIETY_UPDATE_INTERVAL_TICKS,
  type WorldState,
} from "@agent-town/shared";

import { type InstitutionSupport, institutionSupportForAgent } from "./foodAnxiety.js";

type SupportRecords = Map<InstitutionKind, Map<AgentId, InstitutionSupport>>;

export interface SocietyMemory {
  supportTicks: Map<InstitutionKind, Map<AgentId, number>>;
  dissolutionTicks: Map<string, number>;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function stableAgents(world: WorldState): AgentState[] {
  return world.agents.toSorted((left, right) => left.id.localeCompare(right.id));
}

function supportRecords(world: WorldState, agents: AgentState[]): SupportRecords {
  const records: SupportRecords = new Map(
    INSTITUTION_KINDS.map((kind) => [kind, new Map<AgentId, InstitutionSupport>()]),
  );
  for (const agent of agents) {
    for (const support of institutionSupportForAgent(world, agent)) {
      records.get(support.kind)?.set(agent.id, support);
    }
  }
  return records;
}

function recordsFor(
  records: SupportRecords,
  kind: InstitutionKind,
): Map<AgentId, InstitutionSupport> {
  const kindRecords = records.get(kind);
  if (kindRecords === undefined) throw new Error(`missing support records for ${kind}`);
  return kindRecords;
}

function cleanSupportMemory(memory: SocietyMemory, livingIds: Set<AgentId>): void {
  for (const streaks of memory.supportTicks.values()) {
    for (const agentId of streaks.keys()) {
      if (!livingIds.has(agentId)) streaks.delete(agentId);
    }
  }
}

function cleanDissolutionMemory(memory: SocietyMemory, collectives: Collective[]): void {
  const collectiveIds = new Set(collectives.map(({ id }) => id));
  for (const collectiveId of memory.dissolutionTicks.keys()) {
    if (!collectiveIds.has(collectiveId)) memory.dissolutionTicks.delete(collectiveId);
  }
}

function updateSupportStreaks(
  memory: SocietyMemory,
  agents: AgentState[],
  records: SupportRecords,
): void {
  for (const kind of INSTITUTION_KINDS) {
    const streaks = memory.supportTicks.get(kind);
    if (streaks === undefined) throw new Error(`missing support memory for ${kind}`);
    const kindRecords = recordsFor(records, kind);
    for (const agent of agents) {
      const previous = streaks.get(agent.id) ?? 0;
      const next = kindRecords.get(agent.id)?.supports
        ? previous + SOCIETY_UPDATE_INTERVAL_TICKS
        : 0;
      streaks.set(agent.id, next);
    }
  }
}

function currentIds(
  agents: AgentState[],
  records: Map<AgentId, InstitutionSupport>,
  predicate: (support: InstitutionSupport) => boolean,
): AgentId[] {
  return agents
    .filter((agent) => {
      const support = records.get(agent.id);
      return support !== undefined && predicate(support);
    })
    .map(({ id }) => id);
}

function currentSupporterIds(
  agents: AgentState[],
  records: Map<AgentId, InstitutionSupport>,
): AgentId[] {
  return currentIds(agents, records, ({ supports }) => supports);
}

function currentOpponentIds(
  agents: AgentState[],
  records: Map<AgentId, InstitutionSupport>,
): AgentId[] {
  return currentIds(agents, records, ({ opposes }) => opposes);
}

function bestRepresentative(
  supporterIds: AgentId[],
  records: Map<AgentId, InstitutionSupport>,
): AgentId | undefined {
  return supporterIds.toSorted((leftId, rightId) => {
    const scoreDifference = (records.get(rightId)?.score ?? 0) - (records.get(leftId)?.score ?? 0);
    return scoreDifference || leftId.localeCompare(rightId);
  })[0];
}

function cohesion(supporterIds: AgentId[], records: Map<AgentId, InstitutionSupport>): number {
  if (supporterIds.length === 0) return 0;
  const total = supporterIds.reduce((sum, id) => sum + (records.get(id)?.score ?? 0), 0);
  return clampUnit(total / supporterIds.length);
}

function historyCauseIds(world: WorldState): string[] {
  const origin = world.history.settlementOrigin;
  if (origin === null) return [];
  const homeland = world.history.polities.find(({ id }) => id === origin.homelandPolityId);
  const existingIds = new Set(world.history.events.map(({ id }) => id));
  return sortedUnique([
    origin.departureEventId,
    ...(homeland?.formativeTraumaEventIds ?? []),
  ]).filter((id) => existingIds.has(id));
}

function buildProvenance(
  world: WorldState,
  proposerIds: AgentId[],
  supporterIds: AgentId[],
  opponentIds: AgentId[],
): Provenance {
  return {
    causedByEventIds: historyCauseIds(world),
    proposedByAgentIds: sortedUnique(proposerIds),
    supportedByAgentIds: sortedUnique(supporterIds),
    opposedByAgentIds: sortedUnique(opponentIds),
    decidedAtTick: world.tick,
  };
}

function formationSupporters(
  memory: SocietyMemory,
  kind: InstitutionKind,
  agents: AgentState[],
): AgentId[] {
  const streaks = memory.supportTicks.get(kind);
  if (streaks === undefined) throw new Error(`missing support memory for ${kind}`);
  return agents
    .filter(({ id }) => (streaks.get(id) ?? 0) >= COLLECTIVE_FORMATION_TICKS)
    .map(({ id }) => id);
}

function createCollective(
  world: WorldState,
  kind: InstitutionKind,
  supporterIds: AgentId[],
  agents: AgentState[],
  records: Map<AgentId, InstitutionSupport>,
): Collective {
  const representativeId = bestRepresentative(supporterIds, records);
  if (representativeId === undefined) throw new Error("collective requires a representative");
  return {
    id: `collective-${kind}-${world.tick}`,
    purpose: kind,
    supporterIds: sortedUnique(supporterIds),
    representativeId,
    cohesion: cohesion(supporterIds, records),
    formedAtTick: world.tick,
    provenance: buildProvenance(
      world,
      [representativeId],
      supporterIds,
      currentOpponentIds(agents, records),
    ),
  };
}

function formFirstEligibleCollective(
  world: WorldState,
  memory: SocietyMemory,
  agents: AgentState[],
  records: SupportRecords,
): void {
  for (const kind of INSTITUTION_KINDS) {
    if (world.collectives.some(({ purpose }) => purpose === kind)) continue;
    const supporterIds = formationSupporters(memory, kind, agents);
    if (supporterIds.length < COLLECTIVE_MIN_SUPPORTERS) continue;
    world.collectives.push(
      createCollective(world, kind, supporterIds, agents, recordsFor(records, kind)),
    );
    return;
  }
}

function refreshCollectives(
  world: WorldState,
  agents: AgentState[],
  records: SupportRecords,
): void {
  for (const collective of world.collectives) {
    const kindRecords = recordsFor(records, collective.purpose);
    const supporterIds = currentSupporterIds(agents, kindRecords);
    collective.supporterIds = sortedUnique(supporterIds);
    collective.representativeId =
      bestRepresentative(supporterIds, kindRecords) ?? collective.representativeId;
    collective.cohesion = cohesion(supporterIds, kindRecords);
  }
}

function isDissolving(collective: Collective): boolean {
  return (
    collective.supporterIds.length < COLLECTIVE_MIN_SUPPORTERS ||
    collective.cohesion < COLLECTIVE_DISSOLUTION_COHESION
  );
}

function dissolveLowSupportCollectives(world: WorldState, memory: SocietyMemory): void {
  for (const collective of world.collectives) {
    const previous = memory.dissolutionTicks.get(collective.id) ?? 0;
    memory.dissolutionTicks.set(
      collective.id,
      isDissolving(collective) ? previous + SOCIETY_UPDATE_INTERVAL_TICKS : 0,
    );
  }
  world.collectives = world.collectives.filter(
    ({ id }) => (memory.dissolutionTicks.get(id) ?? 0) < COLLECTIVE_DISSOLUTION_TICKS,
  );
  cleanDissolutionMemory(memory, world.collectives);
}

function hasMajority(collective: Collective, population: number): boolean {
  return collective.supporterIds.length > population / 2;
}

function establishInstitution(
  world: WorldState,
  collective: Collective,
  agents: AgentState[],
  records: Map<AgentId, InstitutionSupport>,
): void {
  const supporterIds = currentSupporterIds(agents, records);
  const opponentIds = currentOpponentIds(agents, records);
  world.institutions.push({
    id: `institution-${collective.purpose}-${world.tick}`,
    kind: collective.purpose,
    supporterIds: sortedUnique(supporterIds),
    opposedIds: sortedUnique(opponentIds),
    establishedAtTick: world.tick,
    provenance: buildProvenance(world, [collective.representativeId], supporterIds, opponentIds),
  });
}

function establishEligibleInstitutions(
  world: WorldState,
  agents: AgentState[],
  records: SupportRecords,
): void {
  if (foodDaysRemaining(world) >= INSTITUTION_FOOD_PRESSURE_DAYS) return;
  for (const kind of INSTITUTION_KINDS) {
    if (world.institutions.some((institution) => institution.kind === kind)) continue;
    const collective = world.collectives.find(({ purpose }) => purpose === kind);
    if (collective === undefined || !hasMajority(collective, agents.length)) continue;
    establishInstitution(world, collective, agents, recordsFor(records, kind));
  }
}

export function createSocietyMemory(): SocietyMemory {
  return {
    supportTicks: new Map(INSTITUTION_KINDS.map((kind) => [kind, new Map<AgentId, number>()])),
    dissolutionTicks: new Map(),
  };
}

export function advanceSociety(world: WorldState, memory: SocietyMemory): void {
  if (world.tick % SOCIETY_UPDATE_INTERVAL_TICKS !== 0) return;
  const agents = stableAgents(world);
  const livingIds = new Set(agents.map(({ id }) => id));
  cleanSupportMemory(memory, livingIds);
  cleanDissolutionMemory(memory, world.collectives);
  const records = supportRecords(world, agents);
  updateSupportStreaks(memory, agents, records);
  formFirstEligibleCollective(world, memory, agents, records);
  refreshCollectives(world, agents, records);
  dissolveLowSupportCollectives(world, memory);
  establishEligibleInstitutions(world, agents, records);
}
