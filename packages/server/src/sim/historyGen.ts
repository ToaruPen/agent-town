import {
  type CulturalValue,
  type CulturalValueWeight,
  type HistoricalLandmark,
  type HistoryEffect,
  type HistoryEvent,
  type HistoryEventKind,
  type LandmarkKind,
  type Polity,
  type Position,
  type SettlementOrigin,
  type Tile,
  WORLD_HISTORY_TURN_YEARS,
  WORLD_HISTORY_YEARS,
  WORLD_POLITY_COUNT,
  type WorldHistory,
} from "@agent-town/shared";

import { createRng } from "./rng.js";

interface PolityTemplate {
  name: string;
  adjective: string;
  color: number;
  primaryValue: CulturalValue;
  secondaryValue: CulturalValue;
  foundingMyth: string;
  taboo: string;
  ambition: string;
  governance: string;
}

interface MutableValue {
  weight: number;
  changedByEventIds: string[];
}

interface MutablePolity {
  id: string;
  name: string;
  adjective: string;
  color: number;
  population: number;
  relation: number;
  values: Map<CulturalValue, MutableValue>;
  foundingMyth: string;
  traumaIds: string[];
  taboo: string;
  ambition: string;
  governance: string;
  latestEventId: string;
}

interface HistoryMap {
  width: number;
  height: number;
  tiles: Tile[];
  stockpile: Position;
}

const POLITY_TEMPLATES: PolityTemplate[] = [
  {
    name: "The Sable March",
    adjective: "Sable",
    color: 0x6f7f88,
    primaryValue: "order",
    secondaryValue: "mutualAid",
    foundingMyth: "The first wardens shared one fire through a winter siege.",
    taboo: "Leaving a neighbor unburied beyond the border stones.",
    ambition: "Secure every western pass.",
    governance: "Wardens bargain with village moot speakers.",
  },
  {
    name: "The Auric League",
    adjective: "Auric",
    color: 0xc49a4b,
    primaryValue: "commerce",
    secondaryValue: "knowledge",
    foundingMyth: "Seven river markets sealed peace with a single set of weights.",
    taboo: "Breaking a witnessed contract.",
    ambition: "Reopen the old road to the eastern sea.",
    governance: "Chartered guilds elect a rotating speaker.",
  },
  {
    name: "The Mossward Holds",
    adjective: "Mossward",
    color: 0x708c5a,
    primaryValue: "stewardship",
    secondaryValue: "kinship",
    foundingMyth: "The hill clans survived by promising the forest a seventh share.",
    taboo: "Cutting a marked elder tree.",
    ambition: "Restore the watersheds above the old mines.",
    governance: "Clan elders meet beneath a neutral grove.",
  },
  {
    name: "The River Crown",
    adjective: "River",
    color: 0x5d8fa3,
    primaryValue: "order",
    secondaryValue: "commerce",
    foundingMyth: "A ferryman ended the flood wars by measuring the river fairly.",
    taboo: "Damming a common channel for private gain.",
    ambition: "Bind the inland rivers under one law.",
    governance: "Magistrates serve at the pleasure of the crowned ferryman.",
  },
  {
    name: "The Ivory Reach",
    adjective: "Ivory",
    color: 0xc6bfa2,
    primaryValue: "knowledge",
    secondaryValue: "faith",
    foundingMyth: "Keepers carried the last observatory tablets out of a burning city.",
    taboo: "Destroying a written testimony.",
    ambition: "Recover the instruments buried beneath the northern ruins.",
    governance: "Archivists nominate judges from tested households.",
  },
  {
    name: "The Cinder Abbeys",
    adjective: "Cinder",
    color: 0xa65f45,
    primaryValue: "faith",
    secondaryValue: "mutualAid",
    foundingMyth: "Three hospices kept their doors open during the ash plague.",
    taboo: "Refusing water to a traveler at dusk.",
    ambition: "Unite the scattered roadside sanctuaries.",
    governance: "Abbesses rule locally and gather for a yearly chapter.",
  },
  {
    name: "The Thorn Compact",
    adjective: "Thorn",
    color: 0x8b6b72,
    primaryValue: "valor",
    secondaryValue: "kinship",
    foundingMyth: "Border families swore that no farm would face raiders alone.",
    taboo: "Claiming another household's defense debt.",
    ambition: "Drive the steppe hosts beyond the red hills.",
    governance: "Household captains choose a war leader only in crisis.",
  },
  {
    name: "The Saltmere Clans",
    adjective: "Saltmere",
    color: 0x879a92,
    primaryValue: "kinship",
    secondaryValue: "commerce",
    foundingMyth: "Tide villages lashed their boats together during the black storm.",
    taboo: "Selling fresh water during a shipwreck.",
    ambition: "Control the salt road without surrendering clan rights.",
    governance: "Ship-owning families settle disputes through hostages and gifts.",
  },
];

const EVENT_VALUE: Record<Exclude<HistoryEventKind, "founding" | "migration">, CulturalValue> = {
  anomaly: "faith",
  scarcity: "mutualAid",
  trade: "commerce",
  war: "valor",
};

function randomIndex(rng: () => number, length: number): number {
  return Math.floor(rng() * length);
}

function shuffled<T>(rng: () => number, values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIndex(rng, index + 1);
    const value = result[index];
    const replacement = result[other];
    if (value === undefined || replacement === undefined) continue;
    result[index] = replacement;
    result[other] = value;
  }
  return result;
}

function createValues(template: PolityTemplate): Map<CulturalValue, MutableValue> {
  return new Map([
    [template.primaryValue, { weight: 0.8, changedByEventIds: [] }],
    [template.secondaryValue, { weight: 0.65, changedByEventIds: [] }],
  ]);
}

function createPolities(rng: () => number): MutablePolity[] {
  return shuffled(rng, POLITY_TEMPLATES)
    .slice(0, WORLD_POLITY_COUNT)
    .map((template, index) => ({
      id: `polity-${index + 1}`,
      name: template.name,
      adjective: template.adjective,
      color: template.color,
      population: 80 + randomIndex(rng, 41),
      relation: randomIndex(rng, 41) - 20,
      values: createValues(template),
      foundingMyth: template.foundingMyth,
      traumaIds: [],
      taboo: template.taboo,
      ambition: template.ambition,
      governance: template.governance,
      latestEventId: "",
    }));
}

function eventId(events: HistoryEvent[]): string {
  return `history-${events.length + 1}`;
}

function foundingEvent(polity: MutablePolity, events: HistoryEvent[]): HistoryEvent {
  const id = eventId(events);
  polity.latestEventId = id;
  return {
    id,
    year: -WORLD_HISTORY_YEARS,
    kind: "founding",
    title: `Founding of ${polity.name}`,
    summary: polity.foundingMyth,
    polityIds: [polity.id],
    causeIds: [],
    effects: [{ kind: "population", targetId: polity.id, delta: polity.population }],
  };
}

function createFoundingEvents(polities: MutablePolity[]): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  for (const polity of polities) events.push(foundingEvent(polity, events));
  return events;
}

function neighborFor(
  rng: () => number,
  polities: MutablePolity[],
  actor: MutablePolity,
): MutablePolity {
  const others = polities.filter(({ id }) => id !== actor.id);
  const neighbor = others[randomIndex(rng, others.length)];
  if (neighbor === undefined) throw new Error("history generation requires neighboring polities");
  return neighbor;
}

function turnKind(
  rng: () => number,
  year: number,
  polityIndex: number,
  relation: number,
): Exclude<HistoryEventKind, "founding" | "migration"> {
  if (year === -100 && polityIndex === 0) return "anomaly";
  const pressure = rng();
  if (pressure < 0.28) return "scarcity";
  if (pressure > 0.74 && relation < 10) return "war";
  return "trade";
}

function eventTitle(
  kind: Exclude<HistoryEventKind, "founding" | "migration">,
  actor: MutablePolity,
  neighbor: MutablePolity,
): string {
  if (kind === "scarcity") return `The ${actor.adjective} Lean Years`;
  if (kind === "trade") return `The ${actor.adjective}-${neighbor.adjective} Compact`;
  if (kind === "war") return `The ${actor.adjective}-${neighbor.adjective} Border War`;
  return "The Violet Hollow";
}

function eventSummary(
  kind: Exclude<HistoryEventKind, "founding" | "migration">,
  actor: MutablePolity,
  neighbor: MutablePolity,
): string {
  if (kind === "scarcity") {
    return `Failed harvests forced ${actor.name} to ration seed grain and bind villages together.`;
  }
  if (kind === "trade") {
    return `${actor.name} and ${neighbor.name} exchanged safe passage for grain and worked iron.`;
  }
  if (kind === "war") {
    return `${actor.name} and ${neighbor.name} fought over farms and crossings along an uncertain border.`;
  }
  return `A violet seep yielded glassy ore, but those who worked it sickened and the hollow was sealed.`;
}

function populationDelta(kind: Exclude<HistoryEventKind, "founding" | "migration">): number {
  if (kind === "trade") return 6;
  if (kind === "scarcity") return -7;
  if (kind === "war") return -11;
  return -5;
}

function relationDelta(kind: Exclude<HistoryEventKind, "founding" | "migration">): number {
  if (kind === "trade") return 8;
  if (kind === "war") return -12;
  return 0;
}

function updateValue(polity: MutablePolity, value: CulturalValue, id: string): void {
  const current = polity.values.get(value) ?? { weight: 0.35, changedByEventIds: [] };
  current.weight = Math.min(1, current.weight + 0.08);
  current.changedByEventIds.push(id);
  polity.values.set(value, current);
}

function recordTrauma(
  polity: MutablePolity,
  kind: Exclude<HistoryEventKind, "founding" | "migration">,
  id: string,
): void {
  if (kind !== "trade") polity.traumaIds.push(id);
}

function turnEffects(
  kind: Exclude<HistoryEventKind, "founding" | "migration">,
  actor: MutablePolity,
  neighbor: MutablePolity,
): HistoryEffect[] {
  const effects: HistoryEffect[] = [
    { kind: "population", targetId: actor.id, delta: populationDelta(kind) },
    { kind: "culture", targetId: actor.id, value: EVENT_VALUE[kind], delta: 0.08 },
  ];
  const relation = relationDelta(kind);
  if (relation !== 0) {
    effects.push({
      kind: "relation",
      targetId: actor.id,
      otherPolityId: neighbor.id,
      delta: relation,
    });
  }
  return effects;
}

function simulatePolityTurn(
  rng: () => number,
  year: number,
  polityIndex: number,
  polities: MutablePolity[],
  events: HistoryEvent[],
): void {
  const actor = polities[polityIndex];
  if (actor === undefined) return;
  const neighbor = neighborFor(rng, polities, actor);
  const kind = turnKind(rng, year, polityIndex, actor.relation);
  const id = eventId(events);
  const event: HistoryEvent = {
    id,
    year,
    kind,
    title: eventTitle(kind, actor, neighbor),
    summary: eventSummary(kind, actor, neighbor),
    polityIds: kind === "trade" || kind === "war" ? [actor.id, neighbor.id] : [actor.id],
    causeIds: [actor.latestEventId],
    effects: turnEffects(kind, actor, neighbor),
  };

  actor.population = Math.max(10, actor.population + populationDelta(kind));
  actor.relation = Math.max(-100, Math.min(100, actor.relation + relationDelta(kind)));
  actor.latestEventId = id;
  updateValue(actor, EVENT_VALUE[kind], id);
  recordTrauma(actor, kind, id);
  events.push(event);
}

function simulateTurns(rng: () => number, polities: MutablePolity[], events: HistoryEvent[]): void {
  for (
    let year = -WORLD_HISTORY_YEARS + WORLD_HISTORY_TURN_YEARS;
    year < 0;
    year += WORLD_HISTORY_TURN_YEARS
  ) {
    for (let polityIndex = 0; polityIndex < polities.length; polityIndex += 1) {
      simulatePolityTurn(rng, year, polityIndex, polities, events);
    }
  }
}

function pressureForDeparture(homeland: MutablePolity, events: HistoryEvent[]): HistoryEvent {
  const traumaId = homeland.traumaIds.at(-1);
  const trauma = events.find(({ id }) => id === traumaId);
  if (trauma !== undefined) return trauma;

  const id = eventId(events);
  const pressure: HistoryEvent = {
    id,
    year: -2,
    kind: "scarcity",
    title: `The Last ${homeland.adjective} Harvest`,
    summary: `A final crop failure exhausted the reserves of ${homeland.name}.`,
    polityIds: [homeland.id],
    causeIds: [homeland.latestEventId],
    effects: [
      { kind: "population", targetId: homeland.id, delta: -7 },
      { kind: "culture", targetId: homeland.id, value: "mutualAid", delta: 0.08 },
    ],
  };
  homeland.latestEventId = id;
  homeland.traumaIds.push(id);
  events.push(pressure);
  return pressure;
}

function departureReason(pressure: HistoryEvent): string {
  if (pressure.kind === "war") return "Border war consumed the farms meant for a new generation.";
  if (pressure.kind === "anomaly") {
    return "The sealed hollow poisoned wells and made the old boundary unsafe.";
  }
  return "The last granaries failed after years of scarcity.";
}

function strongestValues(polity: MutablePolity): CulturalValue[] {
  return [...polity.values.entries()]
    .toSorted((left, right) => right[1].weight - left[1].weight)
    .slice(0, 2)
    .map(([value]) => value);
}

function createDeparture(
  rng: () => number,
  polities: MutablePolity[],
  events: HistoryEvent[],
): SettlementOrigin {
  const homeland = polities[randomIndex(rng, polities.length)];
  if (homeland === undefined) throw new Error("history generation requires a homeland");
  const pressure = pressureForDeparture(homeland, events);
  const id = eventId(events);
  events.push({
    id,
    year: -1,
    kind: "migration",
    title: `The ${homeland.adjective} Departure`,
    summary: `Several households left ${homeland.name} to found a settlement beyond the old roads.`,
    polityIds: [homeland.id],
    causeIds: [pressure.id],
    effects: [{ kind: "population", targetId: homeland.id, delta: -3 }],
  });
  return {
    homelandPolityId: homeland.id,
    departureEventId: id,
    reason: departureReason(pressure),
    inheritedValues: strongestValues(homeland),
  };
}

function publicValues(values: Map<CulturalValue, MutableValue>): CulturalValueWeight[] {
  return [...values.entries()]
    .map(([value, state]) => ({
      value,
      weight: state.weight,
      changedByEventIds: [...state.changedByEventIds],
    }))
    .toSorted((left, right) => right.weight - left.weight || left.value.localeCompare(right.value));
}

function publicPolity(polity: MutablePolity): Polity {
  return {
    id: polity.id,
    name: polity.name,
    adjective: polity.adjective,
    color: polity.color,
    values: publicValues(polity.values),
    foundingMyth: polity.foundingMyth,
    formativeTraumaEventIds: [...polity.traumaIds],
    taboo: polity.taboo,
    ambition: polity.ambition,
    governance: polity.governance,
  };
}

function manhattanDistance(left: Position, right: Position): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function walkableLandmarkPositions(map: HistoryMap): Position[] {
  const positions: Position[] = [];
  for (const [index, tile] of map.tiles.entries()) {
    if (tile.resource !== null || (tile.terrain !== "plains" && tile.terrain !== "forest"))
      continue;
    const pos = { x: index % map.width, y: Math.floor(index / map.width) };
    if (manhattanDistance(pos, map.stockpile) >= 12) positions.push(pos);
  }
  return positions;
}

function landmarkSourceEvents(events: HistoryEvent[]): HistoryEvent[] {
  const anomaly = events.find(({ kind }) => kind === "anomaly");
  const wars = events.filter(({ kind }) => kind === "war").slice(-2);
  return anomaly === undefined ? wars : [anomaly, ...wars];
}

function landmarkKind(event: HistoryEvent, index: number): LandmarkKind {
  if (event.kind === "anomaly") return "standingStone";
  return index % 2 === 0 ? "borderFort" : "ruin";
}

function landmarkName(kind: LandmarkKind, adjective: string): string {
  if (kind === "standingStone") return "The Sealed Violet Stone";
  if (kind === "borderFort") return `Old ${adjective} Border Keep`;
  return `The Fallen ${adjective} Watch`;
}

function createLandmarks(
  rng: () => number,
  map: HistoryMap | undefined,
  polities: MutablePolity[],
  events: HistoryEvent[],
): HistoricalLandmark[] {
  if (map === undefined) return [];
  const positions = shuffled(rng, walkableLandmarkPositions(map));
  return landmarkSourceEvents(events).flatMap((event, index) => {
    const pos = positions[index];
    const polityId = event.polityIds[0];
    if (pos === undefined || polityId === undefined) return [];
    const polity = polities.find(({ id }) => id === polityId);
    if (polity === undefined) return [];
    const kind = landmarkKind(event, index);
    const landmark: HistoricalLandmark = {
      id: `landmark-${index + 1}`,
      kind,
      name: landmarkName(kind, polity.adjective),
      pos,
      polityId,
      foundedByEventId: event.id,
    };
    event.effects.push({ kind: "landmark", targetId: landmark.id, landmarkKind: kind });
    return [landmark];
  });
}

export function generateWorldHistory(seed: number, map?: HistoryMap): WorldHistory {
  const rng = createRng(seed ^ 0x5f3759df);
  const polities = createPolities(rng);
  const events = createFoundingEvents(polities);
  simulateTurns(rng, polities, events);
  const settlementOrigin = createDeparture(rng, polities, events);
  const landmarks = createLandmarks(rng, map, polities, events);

  return {
    startYear: -WORLD_HISTORY_YEARS,
    currentYear: 0,
    polities: polities.map(publicPolity),
    events,
    landmarks,
    settlementOrigin,
  };
}
