import {
  type AgentState,
  FOOD_SECURITY_RECOGNITION_THRESHOLD,
  SOCIAL_MILESTONE_DURATION_TICKS,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  buildSocietyViewModel,
  createSocialMilestoneSchedule,
  currentSocialMilestone,
  updateSocialMilestoneSchedule,
} from "../src/ui/societyViewModel.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

function makeAgent(id: string, name: string, foodSecurity = 0): AgentState {
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
    desires: { foodSecurity },
    lastHungerInterruptTick: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
  };
}

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    tick: 0,
    width: 1,
    height: 1,
    tiles: [],
    agents: [
      makeAgent("agent-1", "トネリコ"),
      makeAgent("agent-2", "シラカバ"),
      makeAgent("agent-3", "スギ"),
    ],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
      worldMap: makeWorldMapFixture(),
    },
    ...overrides,
  };
}

const provenance = {
  causedByEventIds: [],
  proposedByAgentIds: ["agent-1"],
  supportedByAgentIds: ["agent-1", "agent-2"],
  opposedByAgentIds: ["agent-3"],
  decidedAtTick: 150,
};

const collective = {
  id: "collective-communalGranaryStore-150",
  purpose: "communalGranaryStore" as const,
  supporterIds: ["agent-1", "agent-2"],
  representativeId: "agent-1",
  cohesion: 0.78,
  formedAtTick: 150,
  provenance,
};

const institution = {
  id: "institution-communalGranaryStore-200",
  kind: "communalGranaryStore" as const,
  supporterIds: ["agent-1", "agent-2"],
  opposedIds: ["agent-3"],
  establishedAtTick: 200,
  provenance: { ...provenance, decidedAtTick: 200 },
};

describe("buildSocietyViewModel", () => {
  it("resolves authoritative social state to exact Japanese rows without raw agent IDs", () => {
    const viewModel = buildSocietyViewModel(
      makeWorld({
        tick: 200,
        collectives: [collective],
        institutions: [institution],
      }),
    );

    expect(viewModel).toEqual({
      collectives: [
        {
          id: "collective-communalGranaryStore-150",
          name: "共同備蓄を求める集団",
          representative: "トネリコ",
          supporters: ["トネリコ", "シラカバ"],
          cohesion: "78%",
        },
      ],
      institutions: [
        {
          id: "institution-communalGranaryStore-200",
          name: "共同備蓄",
          supporters: ["トネリコ", "シラカバ"],
          opponents: ["スギ"],
        },
      ],
    });
    expect(JSON.stringify(viewModel)).not.toContain("agent-");
  });

  it("returns empty rows when no social state exists", () => {
    expect(buildSocietyViewModel(makeWorld())).toEqual({
      collectives: [],
      institutions: [],
    });
  });

  it("uses a Japanese placeholder for unresolved agent IDs", () => {
    const viewModel = buildSocietyViewModel(
      makeWorld({
        collectives: [
          {
            ...collective,
            supporterIds: ["missing-supporter"],
            representativeId: "missing-representative",
          },
        ],
        institutions: [
          {
            ...institution,
            supporterIds: ["missing-supporter"],
            opposedIds: ["missing-opponent"],
          },
        ],
      }),
    );

    expect(viewModel.collectives[0]).toMatchObject({
      representative: "不明な住民",
      supporters: ["不明な住民"],
    });
    expect(viewModel.institutions[0]).toMatchObject({
      supporters: ["不明な住民"],
      opponents: ["不明な住民"],
    });
    expect(JSON.stringify(viewModel)).not.toContain("missing-");
  });
});

describe("social milestone schedule", () => {
  it("observes welcome state without replaying old milestones", () => {
    const welcome = makeWorld({
      tick: 200,
      agents: [
        makeAgent("agent-1", "トネリコ", FOOD_SECURITY_RECOGNITION_THRESHOLD),
        makeAgent("agent-2", "シラカバ"),
        makeAgent("agent-3", "スギ"),
      ],
      collectives: [collective],
      institutions: [institution],
    });
    const schedule = createSocialMilestoneSchedule(welcome);
    const unchanged = updateSocialMilestoneSchedule(schedule, welcome, {
      ...welcome,
      tick: 210,
    });

    expect(schedule.events).toEqual([]);
    expect(unchanged.events).toEqual([]);
  });

  it("queues simultaneous transitions in causal order with non-overlapping windows", () => {
    const previous = makeWorld({
      tick: 9,
      agents: [
        makeAgent("agent-1", "トネリコ", FOOD_SECURITY_RECOGNITION_THRESHOLD - 0.01),
        makeAgent("agent-2", "シラカバ"),
        makeAgent("agent-3", "スギ"),
      ],
    });
    const next = makeWorld({
      tick: 10,
      agents: [
        makeAgent("agent-1", "トネリコ", FOOD_SECURITY_RECOGNITION_THRESHOLD),
        makeAgent("agent-2", "シラカバ"),
        makeAgent("agent-3", "スギ"),
      ],
      collectives: [collective],
      institutions: [institution],
    });

    const schedule = updateSocialMilestoneSchedule(
      createSocialMilestoneSchedule(previous),
      previous,
      next,
    );

    expect(schedule.events.map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: "recognition", text: "危機認識：食料不安が共有され始めた" },
      { kind: "collective", text: "集団結成：共同備蓄を求める集団" },
      { kind: "proposal", text: "制度提案：共同備蓄" },
      { kind: "institution", text: "制度成立：共同備蓄" },
    ]);
    expect(
      schedule.events.map(({ visibleFromTick, expiresAtTick }) => ({
        visibleFromTick,
        expiresAtTick,
      })),
    ).toEqual([
      { visibleFromTick: 10, expiresAtTick: 10 + SOCIAL_MILESTONE_DURATION_TICKS },
      {
        visibleFromTick: 10 + SOCIAL_MILESTONE_DURATION_TICKS,
        expiresAtTick: 10 + SOCIAL_MILESTONE_DURATION_TICKS * 2,
      },
      {
        visibleFromTick: 10 + SOCIAL_MILESTONE_DURATION_TICKS * 2,
        expiresAtTick: 10 + SOCIAL_MILESTONE_DURATION_TICKS * 3,
      },
      {
        visibleFromTick: 10 + SOCIAL_MILESTONE_DURATION_TICKS * 3,
        expiresAtTick: 10 + SOCIAL_MILESTONE_DURATION_TICKS * 4,
      },
    ]);
  });

  it("fires a proposal once per collective and removes expired events", () => {
    const previous = makeWorld({ tick: 9 });
    const formed = makeWorld({
      tick: 10,
      collectives: [collective],
    });
    const first = updateSocialMilestoneSchedule(
      createSocialMilestoneSchedule(previous),
      previous,
      formed,
    );
    const unchanged = updateSocialMilestoneSchedule(first, formed, {
      ...formed,
      tick: 11,
    });
    const expired = updateSocialMilestoneSchedule(
      unchanged,
      { ...formed, tick: 11 },
      { ...formed, tick: 10 + SOCIAL_MILESTONE_DURATION_TICKS * 2 },
    );

    expect(first.events.filter((event) => event.kind === "proposal")).toHaveLength(1);
    expect(unchanged.events.filter((event) => event.kind === "proposal")).toHaveLength(1);
    expect(expired.events).toEqual([]);
  });

  it("returns only the milestone active at the authoritative tick", () => {
    const previous = makeWorld({ tick: 9 });
    const formed = makeWorld({ tick: 10, collectives: [collective] });
    const schedule = updateSocialMilestoneSchedule(
      createSocialMilestoneSchedule(previous),
      previous,
      formed,
    );

    expect(currentSocialMilestone(schedule, 9)).toBeNull();
    expect(currentSocialMilestone(schedule, 10)?.kind).toBe("collective");
    expect(currentSocialMilestone(schedule, 10 + SOCIAL_MILESTONE_DURATION_TICKS)?.kind).toBe(
      "proposal",
    );
    expect(currentSocialMilestone(schedule, 10 + SOCIAL_MILESTONE_DURATION_TICKS * 2)).toBeNull();
  });
});
