import {
  dayOfTick,
  FACILITY_FOOD_CAPACITY,
  FACILITY_NAMES,
  type Facility,
  type FacilityBlockedReason,
  INSTITUTION_NAMES,
  isFacility,
  type MovementPurpose,
  type SiteFactor,
  SOCIAL_MILESTONE_DURATION_TICKS,
  type SpatialDemand,
  TRAIL_MOVE_TICK_MULTIPLIER,
  type TrailCell,
  type TrailLevel,
  type WorldState,
} from "@agent-town/shared";

const SITE_FACTOR_LABELS = {
  foodAccess: "食料採集地への近さ",
  residentAccess: "住民の暮らしへの近さ",
  stockpileAccess: "開拓時備蓄への近さ",
  existingTraffic: "既存の往来",
  settlementEdgeAccess: "集落入口への近さ",
  openSpace: "周囲の空地",
  accessEquality: "住民間の到達しやすさ",
} as const satisfies Readonly<Record<SiteFactor, string>>;

const PURPOSE_LABELS = {
  survival: "生存",
  gathering: "採集",
  construction: "建設",
  facilityService: "施設利用",
  wandering: "徘徊",
} as const satisfies Readonly<Record<MovementPurpose, string>>;

const TRAIL_LEVEL_LABELS = {
  none: "草地",
  trace: "踏み跡",
  trail: "小道",
  establishedTrail: "定着した小道",
} as const satisfies Readonly<Record<TrailLevel, string>>;

const BLOCKED_REASON_LABELS = {
  unreachable: "住民が到達できない",
  full: "在庫が満杯",
  noTradeRoute: "交易路がない",
  maintenanceOverdue: "維持作業が遅れている",
} as const satisfies Readonly<Record<FacilityBlockedReason, string>>;

const UNKNOWN_LABEL = "不明";

export interface FacilityInspectPanelViewModel {
  kind: "facility";
  name: string;
  status: string;
  blockReason: string | null;
  inventory: string;
  foundedBy: string;
  supporters: string[];
  opponents: string[];
  construction: string[];
  siteReasons: string[];
  effects: string[];
  costs: string[];
  visits: string;
  maintenance: string;
  provenanceEventTitles: string[];
  proposers: string[];
  linkedTrailCount: number;
}

export interface TrailInspectPanelViewModel {
  kind: "trail";
  name: string;
  level: string;
  wear: string;
  passages: string;
  purpose: string;
  linkedFacilities: string[];
  movement: string;
  lastUse: string;
}

export type SpatialMilestoneKind = "demand" | "construction" | "facility" | "blocked" | "trail";

export interface SpatialMilestone {
  id: string;
  kind: SpatialMilestoneKind;
  text: string;
  visibleFromTick: number;
  expiresAtTick: number;
}

export interface SpatialMilestoneSchedule {
  observedDemandIds: Set<string>;
  constructionStartedFacilityIds: Set<string>;
  completedFacilityIds: Set<string>;
  blockedDemandIds: Set<string>;
  blockedFacilityIds: Set<string>;
  observedTrailTileIndices: Set<number>;
  events: SpatialMilestone[];
}

function formatCount(value: number): string {
  return String(Math.round(Number.isFinite(value) ? value : 0));
}

function formatRate(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(1);
}

function agentNames(world: WorldState): ReadonlyMap<string, string> {
  return new Map(world.agents.map((agent) => [agent.id, agent.name]));
}

function resolveNames(ids: string[], names: ReadonlyMap<string, string>): string[] {
  return ids.map((id) => names.get(id) ?? UNKNOWN_LABEL);
}

function institutionFor(facility: Facility, world: WorldState) {
  return world.institutions.find(({ id }) => id === facility.institutionId);
}

function facilityStatus(facility: Facility): string {
  if (!facility.complete) return "建設中";
  if (facility.operation === "active") return "稼働中";
  if (facility.operation === "blocked") return "運用停止";
  return "停止中";
}

function siteReasons(facility: Facility): string[] {
  return facility.siteRationale.contributions
    .toSorted(
      (left, right) =>
        right.weightedScore - left.weightedScore || left.factor.localeCompare(right.factor),
    )
    .map(
      ({ factor, weightedScore }) =>
        `${SITE_FACTOR_LABELS[factor]}（寄与${formatRate(weightedScore)}）`,
    );
}

function facilityEffects(facility: Facility): string[] {
  const effects: string[] = [];
  const stats = facility.statsToday;
  if (stats.foodPreserved > 0) {
    effects.push(`食料${formatRate(stats.foodPreserved)}の腐敗を防いだ`);
  }
  if (stats.foodImported > 0) effects.push(`食料${formatRate(stats.foodImported)}を輸入した`);
  if (stats.woodReceived > 0) effects.push(`木材${formatRate(stats.woodReceived)}を受け取った`);
  if (stats.rationMeals > 0) effects.push(`${formatCount(stats.rationMeals)}食を配給した`);
  return effects.length === 0 ? ["本日の効果なし"] : effects;
}

function facilityCosts(facility: Facility): string[] {
  const costs: string[] = [];
  const stats = facility.statsToday;
  if (stats.woodSpent > 0) costs.push(`木材${formatRate(stats.woodSpent)}を消費した`);
  if (stats.foodExported > 0) costs.push(`食料${formatRate(stats.foodExported)}を輸出した`);
  if (stats.maintenanceWork > 0) {
    costs.push(`維持労働${formatRate(stats.maintenanceWork)}を負担した`);
  }
  if (facility.maintenanceDue > 0) {
    costs.push(`維持労働${formatCount(facility.maintenanceDue)}が未実施`);
  }
  return costs.length === 0 ? ["本日の負担なし"] : costs;
}

function provenanceEventTitles(facility: Facility, world: WorldState): string[] {
  const titles = new Map(world.history.events.map((event) => [event.id, event.title]));
  return facility.provenance.causedByEventIds.map((id) => titles.get(id) ?? UNKNOWN_LABEL);
}

function linkedTrailCount(facilityId: string, world: WorldState): number {
  return world.trailCells.filter(
    (cell) => cell.level !== "none" && cell.causedByFacilityIds.includes(facilityId),
  ).length;
}

function constructionProgress(
  facility: Facility,
  demand: SpatialDemand | undefined,
): [string, string] {
  const requiredWood = demand === undefined ? UNKNOWN_LABEL : formatCount(demand.requiredWood);
  const requiredLabor = demand === undefined ? UNKNOWN_LABEL : formatCount(demand.requiredLabor);
  return [
    `木材${formatCount(facility.woodDelivered)} / ${requiredWood}`,
    `労働${formatCount(facility.progress)} / ${requiredLabor}`,
  ];
}

export function buildFacilityViewModel(
  world: WorldState,
  facilityId: string,
): FacilityInspectPanelViewModel | null {
  const facility = world.buildings.filter(isFacility).find(({ id }) => id === facilityId);
  if (facility === undefined) return null;
  const institution = institutionFor(facility, world);
  const demand = world.spatialDemands.find(({ id }) => id === facility.demandId);
  const names = agentNames(world);
  return {
    kind: "facility",
    name: FACILITY_NAMES[facility.kind],
    status: facilityStatus(facility),
    blockReason:
      facility.blockedReason === null ? null : BLOCKED_REASON_LABELS[facility.blockedReason],
    inventory: `食料${formatCount(facility.inventory.food)} / ${FACILITY_FOOD_CAPACITY[facility.kind]}`,
    foundedBy: institution === undefined ? UNKNOWN_LABEL : INSTITUTION_NAMES[institution.kind],
    supporters: resolveNames(institution?.supporterIds ?? [], names),
    opponents: resolveNames(institution?.opposedIds ?? [], names),
    construction: constructionProgress(facility, demand),
    siteReasons: siteReasons(facility),
    effects: facilityEffects(facility),
    costs: facilityCosts(facility),
    visits: `本日の利用${formatCount(facility.statsToday.visits)}回`,
    maintenance:
      facility.maintenanceDue > 0
        ? `未実施の維持労働${formatCount(facility.maintenanceDue)}`
        : "維持作業済み",
    provenanceEventTitles: provenanceEventTitles(facility, world),
    proposers: resolveNames(facility.provenance.proposedByAgentIds, names),
    linkedTrailCount: linkedTrailCount(facility.id, world),
  };
}

function trailMovement(level: TrailLevel): string {
  const reduction = (1 - TRAIL_MOVE_TICK_MULTIPLIER[level]) * 100;
  return reduction <= 0 ? "移動時間の短縮なし" : `移動時間${formatRate(reduction)}%短縮`;
}

function linkedFacilityNames(cell: TrailCell, world: WorldState): string[] {
  const facilities = new Map(
    world.buildings
      .filter(isFacility)
      .map((facility) => [facility.id, FACILITY_NAMES[facility.kind]]),
  );
  return cell.causedByFacilityIds.map((id) => facilities.get(id) ?? UNKNOWN_LABEL);
}

export function buildTrailViewModel(
  world: WorldState,
  tileIndex: number,
): TrailInspectPanelViewModel | null {
  const cell = world.trailCells[tileIndex];
  if (cell === undefined) return null;
  const level = TRAIL_LEVEL_LABELS[cell.level];
  return {
    kind: "trail",
    name: level,
    level,
    wear: `摩耗${formatRate(cell.wear)}`,
    passages: `本日の通行${formatCount(cell.passagesToday)}回`,
    purpose: cell.dominantPurpose === null ? UNKNOWN_LABEL : PURPOSE_LABELS[cell.dominantPurpose],
    linkedFacilities: linkedFacilityNames(cell, world),
    movement: trailMovement(cell.level),
    lastUse:
      cell.lastUsedAtTick === null ? "利用記録なし" : `${dayOfTick(cell.lastUsedAtTick)}日目`,
  };
}

function visibleTrailIndices(state: WorldState): number[] {
  return state.trailCells.flatMap((cell, index) => (cell.level === "none" ? [] : [index]));
}

export function createSpatialMilestoneSchedule(state: WorldState): SpatialMilestoneSchedule {
  const facilities = state.buildings.filter(isFacility);
  return {
    observedDemandIds: new Set(state.spatialDemands.map(({ id }) => id)),
    constructionStartedFacilityIds: new Set(
      facilities.filter(({ woodDelivered }) => woodDelivered > 0).map(({ id }) => id),
    ),
    completedFacilityIds: new Set(
      facilities.filter(({ complete }) => complete).map(({ id }) => id),
    ),
    blockedDemandIds: new Set(
      state.spatialDemands.filter(({ status }) => status === "blocked").map(({ id }) => id),
    ),
    blockedFacilityIds: new Set(
      facilities.filter(({ operation }) => operation === "blocked").map(({ id }) => id),
    ),
    observedTrailTileIndices: new Set(visibleTrailIndices(state)),
    events: [],
  };
}

function addMilestone(
  events: SpatialMilestone[],
  tick: number,
  milestone: Pick<SpatialMilestone, "id" | "kind" | "text">,
): void {
  const lastExpiry = events.at(-1)?.expiresAtTick ?? tick;
  const visibleFromTick = Math.max(tick, lastExpiry);
  events.push({
    ...milestone,
    visibleFromTick,
    expiresAtTick: visibleFromTick + SOCIAL_MILESTONE_DURATION_TICKS,
  });
}

function addDemandMilestones(
  demands: SpatialDemand[],
  observed: Set<string>,
  blocked: Set<string>,
  events: SpatialMilestone[],
  tick: number,
): void {
  for (const demand of demands) {
    if (observed.has(demand.id)) continue;
    observed.add(demand.id);
    if (demand.status === "blocked") {
      blocked.add(demand.id);
      addMilestone(events, tick, {
        id: `blocked-demand:${demand.id}`,
        kind: "blocked",
        text: `建設停滞：${FACILITY_NAMES[demand.facilityKind]}を建てられる土地がない`,
      });
      continue;
    }
    addMilestone(events, tick, {
      id: `demand:${demand.id}`,
      kind: "demand",
      text: `施設需要：${FACILITY_NAMES[demand.facilityKind]}の建設地を探し始めた`,
    });
  }
}

function addNewlyBlockedDemands(
  demands: SpatialDemand[],
  blocked: Set<string>,
  events: SpatialMilestone[],
  tick: number,
): void {
  for (const demand of demands) {
    if (demand.status !== "blocked" || blocked.has(demand.id)) continue;
    blocked.add(demand.id);
    addMilestone(events, tick, {
      id: `blocked-demand:${demand.id}`,
      kind: "blocked",
      text: `建設停滞：${FACILITY_NAMES[demand.facilityKind]}を建てられる土地がない`,
    });
  }
}

function addConstructionMilestones(
  facilities: Facility[],
  started: Set<string>,
  events: SpatialMilestone[],
  tick: number,
): void {
  for (const facility of facilities) {
    if (facility.woodDelivered <= 0 || started.has(facility.id)) continue;
    started.add(facility.id);
    addMilestone(events, tick, {
      id: `construction:${facility.id}`,
      kind: "construction",
      text: `着工：${FACILITY_NAMES[facility.kind]}へ木材が届いた`,
    });
  }
}

function addCompletionMilestones(
  facilities: Facility[],
  completed: Set<string>,
  events: SpatialMilestone[],
  tick: number,
): void {
  for (const facility of facilities) {
    if (!facility.complete || completed.has(facility.id)) continue;
    completed.add(facility.id);
    addMilestone(events, tick, {
      id: `facility:${facility.id}`,
      kind: "facility",
      text: `完成：${FACILITY_NAMES[facility.kind]}が稼働を始めた`,
    });
  }
}

function blockedOperationText(facility: Facility): string {
  if (facility.blockedReason === "noTradeRoute") {
    return `運用停止：${FACILITY_NAMES[facility.kind]}につながる交易路がない`;
  }
  const reason =
    facility.blockedReason === null ? UNKNOWN_LABEL : BLOCKED_REASON_LABELS[facility.blockedReason];
  return `運用停止：${FACILITY_NAMES[facility.kind]} — ${reason}`;
}

function addBlockedFacilityMilestones(
  facilities: Facility[],
  blocked: Set<string>,
  events: SpatialMilestone[],
  tick: number,
): void {
  for (const facility of facilities) {
    if (facility.operation !== "blocked" || blocked.has(facility.id)) continue;
    blocked.add(facility.id);
    addMilestone(events, tick, {
      id: `blocked-facility:${facility.id}`,
      kind: "blocked",
      text: blockedOperationText(facility),
    });
  }
}

function trailCauseName(cell: TrailCell, state: WorldState): string {
  const causeId = cell.causedByFacilityIds[0];
  if (causeId === undefined) return UNKNOWN_LABEL;
  const facility = state.buildings.filter(isFacility).find(({ id }) => id === causeId);
  return facility === undefined ? UNKNOWN_LABEL : FACILITY_NAMES[facility.kind];
}

function addTrailMilestones(
  state: WorldState,
  observed: Set<number>,
  events: SpatialMilestone[],
): void {
  for (const index of visibleTrailIndices(state)) {
    if (observed.has(index)) continue;
    observed.add(index);
    const cell = state.trailCells[index];
    if (cell === undefined) continue;
    addMilestone(events, state.tick, {
      id: `trail:${index}`,
      kind: "trail",
      text: `小道形成：${trailCauseName(cell, state)}への往来が地面に刻まれた`,
    });
  }
}

export function updateSpatialMilestoneSchedule(
  schedule: SpatialMilestoneSchedule,
  _previous: WorldState,
  next: WorldState,
): SpatialMilestoneSchedule {
  const observedDemandIds = new Set(schedule.observedDemandIds);
  const constructionStartedFacilityIds = new Set(schedule.constructionStartedFacilityIds);
  const completedFacilityIds = new Set(schedule.completedFacilityIds);
  const blockedDemandIds = new Set(schedule.blockedDemandIds);
  const blockedFacilityIds = new Set(schedule.blockedFacilityIds);
  const observedTrailTileIndices = new Set(schedule.observedTrailTileIndices);
  const events = schedule.events.filter((event) => event.expiresAtTick > next.tick);
  const facilities = next.buildings.filter(isFacility);

  addDemandMilestones(next.spatialDemands, observedDemandIds, blockedDemandIds, events, next.tick);
  addNewlyBlockedDemands(next.spatialDemands, blockedDemandIds, events, next.tick);
  addConstructionMilestones(facilities, constructionStartedFacilityIds, events, next.tick);
  addCompletionMilestones(facilities, completedFacilityIds, events, next.tick);
  addBlockedFacilityMilestones(facilities, blockedFacilityIds, events, next.tick);
  addTrailMilestones(next, observedTrailTileIndices, events);

  return {
    observedDemandIds,
    constructionStartedFacilityIds,
    completedFacilityIds,
    blockedDemandIds,
    blockedFacilityIds,
    observedTrailTileIndices,
    events,
  };
}
