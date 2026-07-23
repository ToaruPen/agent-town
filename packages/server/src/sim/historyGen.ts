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
  WORLD_LANDMARK_FALLBACK_DISTANCE,
  WORLD_LANDMARK_MIN_DISTANCE,
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

type PolityRelations = Map<string, number>;

const POLITY_TEMPLATES: PolityTemplate[] = [
  {
    name: "黒貂辺境国",
    adjective: "黒貂",
    color: 0x6f7f88,
    primaryValue: "order",
    secondaryValue: "mutualAid",
    foundingMyth: "冬の包囲戦で、最初の守人たちはひとつの火を分かち合った。",
    taboo: "境石の外に隣人の亡骸を葬らず放置すること。",
    ambition: "西の峠をすべて守り固める。",
    governance: "守人たちが村会の代表と合議する。",
  },
  {
    name: "金環盟約国",
    adjective: "金環",
    color: 0xc49a4b,
    primaryValue: "commerce",
    secondaryValue: "knowledge",
    foundingMyth: "七つの川市が、ひと組の分銅を共有して和平を結んだ。",
    taboo: "証人のいる契約を破ること。",
    ambition: "東の海へ続く古道を再び開く。",
    governance: "公認組合が持ち回りの代表を選ぶ。",
  },
  {
    name: "苔守諸領",
    adjective: "苔守",
    color: 0x708c5a,
    primaryValue: "stewardship",
    secondaryValue: "kinship",
    foundingMyth: "丘の氏族は、収穫の七分の一を森へ返す誓いによって生き延びた。",
    taboo: "印を刻まれた老木を切ること。",
    ambition: "古い鉱山の上流に水源をよみがえらせる。",
    governance: "氏族の長老たちが中立の森で評議する。",
  },
  {
    name: "河冠王国",
    adjective: "河冠",
    color: 0x5d8fa3,
    primaryValue: "order",
    secondaryValue: "commerce",
    foundingMyth: "ひとりの渡し守が公平に川を測り、洪水戦争を終わらせた。",
    taboo: "私益のために共同水路をせき止めること。",
    ambition: "内陸の川々をひとつの法で結ぶ。",
    governance: "冠を戴く渡し守が任命した判官たちが治める。",
  },
  {
    name: "象牙境国",
    adjective: "象牙",
    color: 0xc6bfa2,
    primaryValue: "knowledge",
    secondaryValue: "faith",
    foundingMyth: "守蔵人たちが、燃える都から最後の天文台石板を運び出した。",
    taboo: "書き残された証言を破棄すること。",
    ambition: "北の廃墟に埋もれた観測器を取り戻す。",
    governance: "記録官たちが試練を経た家々から判官を指名する。",
  },
  {
    name: "灰燼修道領",
    adjective: "灰燼",
    color: 0xa65f45,
    primaryValue: "faith",
    secondaryValue: "mutualAid",
    foundingMyth: "灰の疫病のさなか、三つの施療院は門を閉ざさなかった。",
    taboo: "夕暮れに旅人へ水を与えないこと。",
    ambition: "街道沿いに散らばる聖所をひとつに結ぶ。",
    governance: "各地を修道院長が治め、年に一度の宗会へ集う。",
  },
  {
    name: "茨盟約国",
    adjective: "茨",
    color: 0x8b6b72,
    primaryValue: "valor",
    secondaryValue: "kinship",
    foundingMyth: "辺境の家々は、どの農場も単独で略奪者に立ち向かわせないと誓った。",
    taboo: "他家の防衛の恩を自らのものとして取り立てること。",
    ambition: "草原の軍勢を赤い丘の彼方へ退ける。",
    governance: "危機の時に限り、家々の長が戦大将を選ぶ。",
  },
  {
    name: "塩湖諸族",
    adjective: "塩湖",
    color: 0x879a92,
    primaryValue: "kinship",
    secondaryValue: "commerce",
    foundingMyth: "黒い嵐の夜、潮辺の村々は舟を互いに結び合わせた。",
    taboo: "難破のさなかに真水を売ること。",
    ambition: "氏族の権利を守りながら塩の道を掌握する。",
    governance: "舟を持つ家々が人質と贈り物によって争いを収める。",
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
      values: createValues(template),
      foundingMyth: template.foundingMyth,
      traumaIds: [],
      taboo: template.taboo,
      ambition: template.ambition,
      governance: template.governance,
      latestEventId: "",
    }));
}

function relationKey(left: MutablePolity, right: MutablePolity): string {
  return left.id < right.id ? `${left.id}:${right.id}` : `${right.id}:${left.id}`;
}

function createRelations(rng: () => number, polities: MutablePolity[]): PolityRelations {
  const relations: PolityRelations = new Map();
  for (let left = 0; left < polities.length; left += 1) {
    for (let right = left + 1; right < polities.length; right += 1) {
      const leftPolity = polities[left];
      const rightPolity = polities[right];
      if (leftPolity === undefined || rightPolity === undefined) continue;
      relations.set(relationKey(leftPolity, rightPolity), randomIndex(rng, 41) - 20);
    }
  }
  return relations;
}

function relationBetween(
  relations: PolityRelations,
  left: MutablePolity,
  right: MutablePolity,
): number {
  const relation = relations.get(relationKey(left, right));
  if (relation === undefined) throw new Error("history generation requires a polity relation");
  return relation;
}

function changeRelation(
  relations: PolityRelations,
  left: MutablePolity,
  right: MutablePolity,
  delta: number,
): void {
  const current = relationBetween(relations, left, right);
  relations.set(relationKey(left, right), Math.max(-100, Math.min(100, current + delta)));
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
    title: `${polity.name}建国`,
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
  if (kind === "scarcity") return `${actor.adjective}凶作年`;
  if (kind === "trade") return `${actor.adjective}・${neighbor.adjective}盟約`;
  if (kind === "war") return `${actor.adjective}・${neighbor.adjective}国境戦争`;
  return "紫晶窪地";
}

function eventSummary(
  kind: Exclude<HistoryEventKind, "founding" | "migration">,
  actor: MutablePolity,
  neighbor: MutablePolity,
): string {
  if (kind === "scarcity") {
    return `不作に見舞われた${actor.name}は種籾を配給制とし、村々を結束させた。`;
  }
  if (kind === "trade") {
    return `${actor.name}と${neighbor.name}は、安全な通行と引き換えに穀物と鍛鉄を融通した。`;
  }
  if (kind === "war") {
    return `${actor.name}と${neighbor.name}は、曖昧な国境沿いの農地と渡河地をめぐって争った。`;
  }
  return "紫色の湧出地から玻璃のような鉱石が採れたが、作業者が病に倒れ、窪地は封印された。";
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
  const effects: HistoryEffect[] = [];
  for (const polity of affectedPolities(kind, actor, neighbor)) {
    effects.push(
      { kind: "population", targetId: polity.id, delta: populationDelta(kind) },
      { kind: "culture", targetId: polity.id, value: EVENT_VALUE[kind], delta: 0.08 },
    );
  }
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

function affectedPolities(
  kind: Exclude<HistoryEventKind, "founding" | "migration">,
  actor: MutablePolity,
  neighbor: MutablePolity,
): MutablePolity[] {
  return kind === "trade" || kind === "war" ? [actor, neighbor] : [actor];
}

function causalEventIds(polities: MutablePolity[]): string[] {
  return [...new Set(polities.map(({ latestEventId }) => latestEventId).filter(Boolean))];
}

function simulatePolityTurn(
  rng: () => number,
  year: number,
  polityIndex: number,
  polities: MutablePolity[],
  relations: PolityRelations,
  events: HistoryEvent[],
): void {
  const actor = polities[polityIndex];
  if (actor === undefined) return;
  const neighbor = neighborFor(rng, polities, actor);
  const kind = turnKind(rng, year, polityIndex, relationBetween(relations, actor, neighbor));
  const affected = affectedPolities(kind, actor, neighbor);
  const id = eventId(events);
  const event: HistoryEvent = {
    id,
    year,
    kind,
    title: eventTitle(kind, actor, neighbor),
    summary: eventSummary(kind, actor, neighbor),
    polityIds: affected.map(({ id: polityId }) => polityId),
    causeIds: causalEventIds(affected),
    effects: turnEffects(kind, actor, neighbor),
  };

  for (const polity of affected) {
    polity.population = Math.max(10, polity.population + populationDelta(kind));
    polity.latestEventId = id;
    updateValue(polity, EVENT_VALUE[kind], id);
    recordTrauma(polity, kind, id);
  }
  changeRelation(relations, actor, neighbor, relationDelta(kind));
  events.push(event);
}

function simulateTurns(
  rng: () => number,
  polities: MutablePolity[],
  relations: PolityRelations,
  events: HistoryEvent[],
): void {
  for (
    let year = -WORLD_HISTORY_YEARS + WORLD_HISTORY_TURN_YEARS;
    year < 0;
    year += WORLD_HISTORY_TURN_YEARS
  ) {
    for (let polityIndex = 0; polityIndex < polities.length; polityIndex += 1) {
      simulatePolityTurn(rng, year, polityIndex, polities, relations, events);
    }
  }
}

function pressureForDeparture(homeland: MutablePolity, events: HistoryEvent[]): HistoryEvent {
  const traumaId = homeland.traumaIds.at(-1);
  const trauma = events.find(({ id }) => id === traumaId);
  if (trauma !== undefined) return trauma;

  const id = eventId(events);
  const populationChange = populationDelta("scarcity");
  const pressure: HistoryEvent = {
    id,
    year: -2,
    kind: "scarcity",
    title: `${homeland.adjective}最後の収穫`,
    summary: `最後の凶作によって、${homeland.name}の蓄えは尽きた。`,
    polityIds: [homeland.id],
    causeIds: [homeland.latestEventId],
    effects: [
      { kind: "population", targetId: homeland.id, delta: populationChange },
      { kind: "culture", targetId: homeland.id, value: "mutualAid", delta: 0.08 },
    ],
  };
  homeland.population = Math.max(10, homeland.population + populationChange);
  updateValue(homeland, "mutualAid", id);
  homeland.latestEventId = id;
  homeland.traumaIds.push(id);
  events.push(pressure);
  return pressure;
}

function departureReason(pressure: HistoryEvent): string {
  if (pressure.kind === "war") return "国境戦争が、次代へ継ぐはずの農地を呑み込んだ。";
  if (pressure.kind === "anomaly") {
    return "封じられた窪地が井戸を汚し、古い境界は住めない土地になった。";
  }
  return "幾年もの凶作の末、最後の穀倉が尽きた。";
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
    title: `${homeland.adjective}の旅立ち`,
    summary: `いくつかの家族が${homeland.name}を離れ、古道の彼方に集落を築こうと旅立った。`,
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

function walkableLandmarkPositions(map: HistoryMap, minDistance: number): Position[] {
  const positions: Position[] = [];
  for (const [index, tile] of map.tiles.entries()) {
    if (tile.resource !== null || (tile.terrain !== "plains" && tile.terrain !== "forest"))
      continue;
    const pos = { x: index % map.width, y: Math.floor(index / map.width) };
    if (manhattanDistance(pos, map.stockpile) >= minDistance) positions.push(pos);
  }
  return positions;
}

function landmarkPositions(rng: () => number, map: HistoryMap, required: number): Position[] {
  const preferred = shuffled(rng, walkableLandmarkPositions(map, WORLD_LANDMARK_MIN_DISTANCE));
  if (preferred.length >= required) return preferred;
  const fallback = shuffled(
    rng,
    walkableLandmarkPositions(map, WORLD_LANDMARK_FALLBACK_DISTANCE).filter(
      (pos) => manhattanDistance(pos, map.stockpile) < WORLD_LANDMARK_MIN_DISTANCE,
    ),
  );
  return [...preferred, ...fallback];
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
  if (kind === "standingStone") return "封じられた紫晶石";
  if (kind === "borderFort") return `古き${adjective}国境砦`;
  return `崩れた${adjective}見張り台`;
}

function createLandmarks(
  rng: () => number,
  map: HistoryMap | undefined,
  polities: MutablePolity[],
  events: HistoryEvent[],
): HistoricalLandmark[] {
  if (map === undefined) return [];
  const sources = landmarkSourceEvents(events);
  const positions = landmarkPositions(rng, map, sources.length);
  return sources.flatMap((event, index) => {
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
  const relations = createRelations(rng, polities);
  const events = createFoundingEvents(polities);
  simulateTurns(rng, polities, relations, events);
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
