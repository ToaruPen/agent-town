export type AgentId = string;
export type EventId = string;

export interface AgentDesires extends Record<string, number> {
  foodSecurity: number;
}

export type InstitutionKind = "communalGranaryStore" | "grainMarket" | "rationControl";

export interface Provenance {
  causedByEventIds: EventId[];
  proposedByAgentIds: AgentId[];
  supportedByAgentIds: AgentId[];
  opposedByAgentIds: AgentId[];
  decidedAtTick: number;
}

export interface Collective {
  id: string;
  purpose: InstitutionKind;
  supporterIds: AgentId[];
  representativeId: AgentId;
  cohesion: number;
  formedAtTick: number;
  provenance: Provenance;
}

export interface Institution {
  id: string;
  kind: InstitutionKind;
  supporterIds: AgentId[];
  opposedIds: AgentId[];
  establishedAtTick: number;
  provenance: Provenance;
}
