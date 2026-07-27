import {
  type AgentState,
  FACILITY_BUILD_TICKS,
  FACILITY_WOOD_COST,
  type Facility,
  type SpatialDemand,
  TICKS_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  buildFacilityViewModel,
  buildTrailViewModel,
  createSpatialMilestoneSchedule,
  updateSpatialMilestoneSchedule,
} from "../src/ui/spatialViewModel.js";
import { makeFacilityFixture, makeTrailCellsFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

function makeAgent(id: string, name: string): AgentState {
  return {
    id,
    name,
    pos: { x: 0, y: 0 },
    carrying: null,
    activity: { kind: "idle" },
    tasks: [],
    planSource: "fake",
    llmProvider: null,
    thinking: false,
    lastThought: null,
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
    rationStrain: 0,
    lastRationTick: null,
  };
}

const provenance = {
  causedByEventIds: ["event-scarcity"],
  proposedByAgentIds: ["agent-1"],
  supportedByAgentIds: ["agent-1", "agent-2"],
  opposedByAgentIds: ["agent-3"],
  decidedAtTick: 10,
};

function makeDemand(
  overrides: Partial<SpatialDemand> = {},
  kind: SpatialDemand["facilityKind"] = "communalGranary",
): SpatialDemand {
  return {
    id: `demand-${kind}`,
    facilityKind: kind,
    source: { kind: "institution", id: "institution-granary" },
    supporterIds: ["agent-1", "agent-2"],
    requiredWood: FACILITY_WOOD_COST[kind],
    requiredLabor: FACILITY_BUILD_TICKS[kind],
    status: "seekingSite",
    blockedReason: null,
    site: null,
    siteRationale: null,
    provenance,
    ...overrides,
  };
}

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    tick: 0,
    width: 2,
    height: 2,
    tiles: Array.from({ length: 4 }, () => ({
      terrain: "plains" as const,
      resource: null,
    })),
    agents: [
      makeAgent("agent-1", "トネリコ"),
      makeAgent("agent-2", "シラカバ"),
      makeAgent("agent-3", "スギ"),
    ],
    stockpile: { pos: { x: 0, y: 0 }, wood: 8, food: 25 },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [
      {
        id: "institution-granary",
        kind: "communalGranaryStore",
        supporterIds: ["agent-1", "agent-2"],
        opposedIds: ["agent-3"],
        establishedAtTick: 10,
        provenance,
      },
    ],
    spatialDemands: [],
    trailCells: makeTrailCellsFixture(2, 2),
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [
        {
          id: "event-scarcity",
          year: -1,
          kind: "scarcity",
          title: "大凶作",
          summary: "食料が尽きかけた。",
          polityIds: [],
          causeIds: [],
          effects: [],
        },
      ],
      landmarks: [],
      settlementOrigin: null,
      worldMap: makeWorldMapFixture(),
    },
    ...overrides,
  };
}

function makeGranary(): Facility {
  return {
    ...makeFacilityFixture("communalGranary", { x: 1, y: 0 }),
    id: "facility-granary",
    demandId: "demand-communalGranary",
    institutionId: "institution-granary",
    inventory: { wood: 2.4, food: 33.6 },
    maintenanceDue: 12.6,
    statsToday: {
      visits: 5.6,
      foodPreserved: 4.800000000000001,
      foodImported: 0,
      foodExported: 0,
      woodSpent: 0,
      woodReceived: 0,
      rationMeals: 0,
      maintenanceWork: 2.25,
    },
    lastUsedAtTick: TICKS_PER_DAY * 2,
    siteRationale: {
      score: 0.75,
      contributions: [
        { factor: "foodAccess", value: 0.8, weightedScore: 0.2 },
        { factor: "stockpileAccess", value: 0.6, weightedScore: 0.15 },
      ],
    },
    provenance,
  };
}

describe("spatial view models", () => {
  it("explains a completed facility from authoritative state with clean numeric formatting", () => {
    const granary = makeGranary();
    const world = makeWorld({
      tick: TICKS_PER_DAY * 2,
      buildings: [granary],
      spatialDemands: [
        makeDemand({
          status: "fulfilled",
          site: granary.pos,
          siteRationale: granary.siteRationale,
        }),
      ],
    });
    world.trailCells[2] = {
      ...world.trailCells[2],
      level: "trail",
      wear: 9.5,
      causedByFacilityIds: [granary.id],
    };

    expect(buildFacilityViewModel(world, granary.id)).toEqual(
      expect.objectContaining({
        kind: "facility",
        name: "共同穀倉",
        status: "稼働中",
        inventory: "食料34 / 120",
        woodInventory: "木材2",
        foundedBy: "共同備蓄",
        supporters: ["トネリコ", "シラカバ"],
        opponents: ["スギ"],
        construction: ["木材15 / 15", "労働240 / 240"],
        siteReasons: expect.arrayContaining([
          expect.stringContaining("食料採集地"),
          expect.stringContaining("開拓時備蓄"),
        ]),
        effects: expect.arrayContaining([
          expect.stringContaining("食料4.8"),
          expect.stringContaining("腐敗を防いだ"),
        ]),
        costs: expect.arrayContaining([
          expect.stringContaining("維持労働2.3"),
          expect.stringContaining("維持労働13"),
        ]),
        visits: "本日の利用6回",
        provenanceEventTitles: ["大凶作"],
        proposers: ["トネリコ"],
        linkedTrailCount: 1,
        linkedTrails: ["(0, 1) 小道・摩耗9.5"],
      }),
    );
    expect(JSON.stringify(buildFacilityViewModel(world, granary.id))).not.toContain("agent-");
  });

  it("explains a trail cell and hides unresolved raw IDs behind Japanese placeholders", () => {
    const granary = makeGranary();
    const world = makeWorld({
      tick: TICKS_PER_DAY * 3,
      buildings: [granary],
    });
    world.trailCells[3] = {
      wear: 9.5,
      level: "trail",
      passagesToday: 6.6,
      purposeWear: {
        survival: 0,
        gathering: 0,
        construction: 0,
        facilityService: 9.5,
        wandering: 0,
      },
      dominantPurpose: "facilityService",
      facilityWear: { [granary.id]: 8, "missing-facility": 1.5 },
      causedByFacilityIds: [granary.id, "missing-facility"],
      lastUsedAtTick: TICKS_PER_DAY * 2,
    };

    expect(buildTrailViewModel(world, 3)).toEqual({
      kind: "trail",
      name: "小道",
      level: "小道",
      wear: "摩耗9.5",
      passages: "本日の通行7回",
      purpose: "施設利用",
      linkedFacilities: ["共同穀倉", "不明"],
      movement: "移動時間20.0%短縮",
      lastUse: "3日目",
    });
    expect(JSON.stringify(buildTrailViewModel(world, 3))).not.toContain("missing-facility");
  });

  it("uses Japanese placeholders for missing facility provenance references", () => {
    const granary = {
      ...makeGranary(),
      demandId: "missing-demand",
      provenance: {
        ...provenance,
        causedByEventIds: ["missing-event"],
      },
    };
    const institution = makeWorld().institutions[0];
    if (institution === undefined) throw new Error("missing test institution");
    const world = makeWorld({
      buildings: [granary],
      institutions: [
        {
          ...institution,
          supporterIds: ["missing-supporter"],
          opposedIds: ["missing-opponent"],
        },
      ],
    });

    expect(buildFacilityViewModel(world, granary.id)).toEqual(
      expect.objectContaining({
        construction: ["木材15 / 不明", "労働240 / 不明"],
        supporters: ["不明"],
        opponents: ["不明"],
        provenanceEventTitles: ["不明"],
      }),
    );
    expect(JSON.stringify(buildFacilityViewModel(world, granary.id))).not.toContain("missing-");
  });
});

describe("spatial milestone schedule", () => {
  it("emits demand, construction, completion, and first trail formation once in causal order", () => {
    const initial = makeWorld({ tick: 0 });
    const demand = makeDemand();
    const seeking = makeWorld({ tick: 1, spatialDemands: [demand] });
    const buildingFacility = {
      ...makeGranary(),
      progress: 0,
      complete: false,
      woodDelivered: 1,
      operation: "inactive" as const,
    };
    const building = makeWorld({
      tick: 2,
      spatialDemands: [{ ...demand, status: "building", site: buildingFacility.pos }],
      buildings: [buildingFacility],
    });
    const completedFacility = {
      ...buildingFacility,
      progress: FACILITY_BUILD_TICKS.communalGranary,
      complete: true,
      operation: "active" as const,
    };
    const completed = makeWorld({
      tick: 3,
      spatialDemands: [{ ...demand, status: "fulfilled", site: completedFacility.pos }],
      buildings: [completedFacility],
    });
    const trailed = makeWorld({
      tick: 4,
      spatialDemands: completed.spatialDemands,
      buildings: [completedFacility],
    });
    trailed.trailCells[3] = {
      ...trailed.trailCells[3],
      level: "trace",
      wear: 2,
      passagesToday: 1,
      dominantPurpose: "facilityService",
      causedByFacilityIds: [completedFacility.id],
    };
    trailed.trailCells[2] = { ...trailed.trailCells[3] };

    let schedule = createSpatialMilestoneSchedule(initial);
    schedule = updateSpatialMilestoneSchedule(schedule, initial, seeking);
    schedule = updateSpatialMilestoneSchedule(schedule, seeking, building);
    schedule = updateSpatialMilestoneSchedule(schedule, building, completed);
    schedule = updateSpatialMilestoneSchedule(schedule, completed, trailed);
    const unchanged = updateSpatialMilestoneSchedule(schedule, trailed, {
      ...trailed,
      tick: 5,
    });

    expect(schedule.events.map(({ text }) => text)).toEqual([
      "施設需要：共同穀倉の建設地を探し始めた",
      "着工：共同穀倉へ木材が届いた",
      "完成：共同穀倉が稼働を始めた",
      "小道形成：共同穀倉への往来が地面に刻まれた",
    ]);
    expect(unchanged.events.map(({ id }) => id)).toEqual(schedule.events.map(({ id }) => id));
    expect(schedule.observedTrailTileIndices).toEqual(new Set([2, 3]));
  });

  it("announces blocked demand and operation states without noisy daily events", () => {
    const initial = makeWorld({ tick: 0 });
    const blockedDemand = makeDemand({
      status: "blocked",
      blockedReason: "noValidSite",
    });
    const demandBlocked = makeWorld({ tick: 1, spatialDemands: [blockedDemand] });
    const market = {
      ...makeFacilityFixture("grainMarket", { x: 1, y: 0 }),
      id: "facility-market",
      operation: "active" as const,
    };
    const active = makeWorld({ tick: 2, buildings: [market] });
    const blockedMarket = {
      ...market,
      operation: "blocked" as const,
      blockedReason: "noTradeRoute" as const,
    };
    const operationBlocked = makeWorld({
      tick: 3,
      buildings: [blockedMarket],
    });
    active.trailCells[2] = {
      ...active.trailCells[2],
      level: "trace",
      wear: 3,
      passagesToday: 1,
    };
    operationBlocked.trailCells[2] = { ...active.trailCells[2] };
    const noisyDailyUpdate = makeWorld({
      tick: 4,
      buildings: [
        {
          ...blockedMarket,
          statsToday: {
            ...market.statsToday,
            visits: 3,
            foodImported: 10,
          },
        },
      ],
    });
    noisyDailyUpdate.trailCells[2] = {
      ...noisyDailyUpdate.trailCells[2],
      level: "trail",
      wear: 12,
      passagesToday: 5,
    };

    const blockedSchedule = updateSpatialMilestoneSchedule(
      createSpatialMilestoneSchedule(initial),
      initial,
      demandBlocked,
    );
    const activeSchedule = createSpatialMilestoneSchedule(active);
    const stoppedSchedule = updateSpatialMilestoneSchedule(
      activeSchedule,
      active,
      operationBlocked,
    );
    const quietSchedule = updateSpatialMilestoneSchedule(
      stoppedSchedule,
      operationBlocked,
      noisyDailyUpdate,
    );

    expect(blockedSchedule.events.map(({ text }) => text)).toEqual([
      "建設停滞：共同穀倉を建てられる土地がない",
    ]);
    expect(stoppedSchedule.events.map(({ text }) => text)).toEqual([
      "運用停止：穀物市場につながる交易路がない",
    ]);
    expect(quietSchedule.events).toEqual(stoppedSchedule.events);
  });
});
