import {
  FOOD_SECURITY_RECOGNITION_THRESHOLD,
  INSTITUTION_NAMES,
  SOCIAL_MILESTONE_DURATION_TICKS,
  type WorldState,
} from "@agent-town/shared";

export interface SocietyViewModel {
  collectives: {
    id: string;
    name: string;
    representative: string;
    supporters: string[];
    cohesion: string;
  }[];
  institutions: {
    id: string;
    name: string;
    supporters: string[];
    opponents: string[];
  }[];
}

export type SocialMilestoneKind = "recognition" | "collective" | "proposal" | "institution";

export interface SocialMilestone {
  id: string;
  kind: SocialMilestoneKind;
  text: string;
  visibleFromTick: number;
  expiresAtTick: number;
}

export interface SocialMilestoneSchedule {
  recognizedAgentIds: Set<string>;
  observedCollectiveIds: Set<string>;
  proposedCollectiveIds: Set<string>;
  observedInstitutionIds: Set<string>;
  events: SocialMilestone[];
}

const UNKNOWN_RESIDENT = "不明な住民";

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function buildSocietyViewModel(world: WorldState): SocietyViewModel {
  const names = new Map(world.agents.map((agent) => [agent.id, agent.name]));
  const resolveName = (id: string): string => names.get(id) ?? UNKNOWN_RESIDENT;

  return {
    collectives: world.collectives.map((collective) => ({
      id: collective.id,
      name: `${INSTITUTION_NAMES[collective.purpose]}を求める集団`,
      representative: resolveName(collective.representativeId),
      supporters: collective.supporterIds.map(resolveName),
      cohesion: `${Math.round(clampUnit(collective.cohesion) * 100)}%`,
    })),
    institutions: world.institutions.map((institution) => ({
      id: institution.id,
      name: INSTITUTION_NAMES[institution.kind],
      supporters: institution.supporterIds.map(resolveName),
      opponents: institution.opposedIds.map(resolveName),
    })),
  };
}

function hasStrictMajority(supporterCount: number, population: number): boolean {
  return supporterCount > population / 2;
}

export function createSocialMilestoneSchedule(state: WorldState): SocialMilestoneSchedule {
  return {
    recognizedAgentIds: new Set(
      state.agents
        .filter((agent) => agent.desires.foodSecurity >= FOOD_SECURITY_RECOGNITION_THRESHOLD)
        .map((agent) => agent.id),
    ),
    observedCollectiveIds: new Set(state.collectives.map((collective) => collective.id)),
    proposedCollectiveIds: new Set(
      state.collectives
        .filter((collective) =>
          hasStrictMajority(collective.supporterIds.length, state.agents.length),
        )
        .map((collective) => collective.id),
    ),
    observedInstitutionIds: new Set(state.institutions.map((institution) => institution.id)),
    events: [],
  };
}

function addMilestone(
  events: SocialMilestone[],
  tick: number,
  milestone: Pick<SocialMilestone, "id" | "kind" | "text">,
): void {
  const lastExpiry = events.at(-1)?.expiresAtTick ?? tick;
  const visibleFromTick = Math.max(tick, lastExpiry);
  events.push({
    ...milestone,
    visibleFromTick,
    expiresAtTick: visibleFromTick + SOCIAL_MILESTONE_DURATION_TICKS,
  });
}

function recognitionCrossings(
  schedule: SocialMilestoneSchedule,
  previous: WorldState,
  next: WorldState,
): string[] {
  const previousDesires = new Map(
    previous.agents.map((agent) => [agent.id, agent.desires.foodSecurity]),
  );
  return next.agents
    .filter(
      (agent) =>
        !schedule.recognizedAgentIds.has(agent.id) &&
        (previousDesires.get(agent.id) ?? 0) < FOOD_SECURITY_RECOGNITION_THRESHOLD &&
        agent.desires.foodSecurity >= FOOD_SECURITY_RECOGNITION_THRESHOLD,
    )
    .map((agent) => agent.id);
}

function addRecognitionMilestones(
  schedule: SocialMilestoneSchedule,
  previous: WorldState,
  next: WorldState,
  recognizedAgentIds: Set<string>,
  events: SocialMilestone[],
): void {
  const crossings = recognitionCrossings(schedule, previous, next);
  if (crossings.length === 0) return;
  addMilestone(events, next.tick, {
    id: `recognition:${next.tick}:${crossings.join(",")}`,
    kind: "recognition",
    text: "危機認識：食料不安が共有され始めた",
  });
  for (const id of crossings) recognizedAgentIds.add(id);
}

function addCollectiveMilestones(
  next: WorldState,
  observedCollectiveIds: Set<string>,
  events: SocialMilestone[],
): void {
  for (const collective of next.collectives) {
    if (observedCollectiveIds.has(collective.id)) continue;
    addMilestone(events, next.tick, {
      id: `collective:${collective.id}`,
      kind: "collective",
      text: `集団結成：${INSTITUTION_NAMES[collective.purpose]}を求める集団`,
    });
    observedCollectiveIds.add(collective.id);
  }
}

function addProposalMilestones(
  previous: WorldState,
  next: WorldState,
  proposedCollectiveIds: Set<string>,
  events: SocialMilestone[],
): void {
  const previousCollectives = new Map(
    previous.collectives.map((collective) => [collective.id, collective]),
  );
  for (const collective of next.collectives) {
    const previousSupporters = previousCollectives.get(collective.id)?.supporterIds.length ?? 0;
    const crossedMajority =
      !hasStrictMajority(previousSupporters, previous.agents.length) &&
      hasStrictMajority(collective.supporterIds.length, next.agents.length);
    if (proposedCollectiveIds.has(collective.id) || !crossedMajority) continue;
    addMilestone(events, next.tick, {
      id: `proposal:${collective.id}`,
      kind: "proposal",
      text: `制度提案：${INSTITUTION_NAMES[collective.purpose]}`,
    });
    proposedCollectiveIds.add(collective.id);
  }
}

function addInstitutionMilestones(
  next: WorldState,
  observedInstitutionIds: Set<string>,
  events: SocialMilestone[],
): void {
  for (const institution of next.institutions) {
    if (observedInstitutionIds.has(institution.id)) continue;
    addMilestone(events, next.tick, {
      id: `institution:${institution.id}`,
      kind: "institution",
      text: `制度成立：${INSTITUTION_NAMES[institution.kind]}`,
    });
    observedInstitutionIds.add(institution.id);
  }
}

export function updateSocialMilestoneSchedule(
  schedule: SocialMilestoneSchedule,
  previous: WorldState,
  next: WorldState,
): SocialMilestoneSchedule {
  const recognizedAgentIds = new Set(schedule.recognizedAgentIds);
  const observedCollectiveIds = new Set(schedule.observedCollectiveIds);
  const proposedCollectiveIds = new Set(schedule.proposedCollectiveIds);
  const observedInstitutionIds = new Set(schedule.observedInstitutionIds);
  const events = schedule.events.filter((event) => event.expiresAtTick > next.tick);

  addRecognitionMilestones(schedule, previous, next, recognizedAgentIds, events);
  addCollectiveMilestones(next, observedCollectiveIds, events);
  addProposalMilestones(previous, next, proposedCollectiveIds, events);
  addInstitutionMilestones(next, observedInstitutionIds, events);

  return {
    recognizedAgentIds,
    observedCollectiveIds,
    proposedCollectiveIds,
    observedInstitutionIds,
    events,
  };
}

export function currentSocialMilestone(
  schedule: SocialMilestoneSchedule,
  tick: number,
): SocialMilestone | null {
  return (
    schedule.events.find((event) => event.visibleFromTick <= tick && tick < event.expiresAtTick) ??
    null
  );
}
