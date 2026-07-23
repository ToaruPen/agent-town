import {
  COLLECTIVE_DISSOLUTION_TICKS,
  COLLECTIVE_FORMATION_TICKS,
  FOOD_PER_MEAL,
  HUNGER_DECAY_PER_DAY,
  HUNGER_PER_MEAL,
  INSTITUTION_FOOD_PRESSURE_DAYS,
  SOCIETY_UPDATE_INTERVAL_TICKS,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { advanceSociety, createSocietyMemory, type SocietyMemory } from "../src/sim/society.js";
import { generateWorld } from "../src/sim/worldGen.js";

function setHomelandMutualAid(world: WorldState): void {
  const homelandId = world.history.settlementOrigin?.homelandPolityId;
  const homeland = world.history.polities.find(({ id }) => id === homelandId);
  if (homeland === undefined) throw new Error("missing homeland polity");
  homeland.values = [{ value: "mutualAid", weight: 1, changedByEventIds: [] }];
}

function supportedWorld(): WorldState {
  const world = generateWorld(42);
  setHomelandMutualAid(world);
  for (const agent of world.agents) agent.desires.foodSecurity = 1;
  return world;
}

function advanceFor(world: WorldState, memory: SocietyMemory, ticks: number): void {
  for (
    let elapsed = SOCIETY_UPDATE_INTERVAL_TICKS;
    elapsed <= ticks;
    elapsed += SOCIETY_UPDATE_INTERVAL_TICKS
  ) {
    world.tick += SOCIETY_UPDATE_INTERVAL_TICKS;
    advanceSociety(world, memory);
  }
}

function setFoodDays(world: WorldState, days: number): void {
  const dailyNeed =
    Math.max(world.agents.length, 1) * FOOD_PER_MEAL * (HUNGER_DECAY_PER_DAY / HUNGER_PER_MEAL);
  world.stockpile.food = dailyNeed * days;
}

function insertCollective(world: WorldState, supporterIds: string[]): void {
  const representativeId = supporterIds[0];
  const departureEventId = world.history.settlementOrigin?.departureEventId;
  if (representativeId === undefined || departureEventId === undefined) {
    throw new Error("missing collective fixture data");
  }
  world.collectives = [
    {
      id: "collective-communalGranaryStore-0",
      purpose: "communalGranaryStore",
      supporterIds,
      representativeId,
      cohesion: 1,
      formedAtTick: 0,
      provenance: {
        causedByEventIds: [departureEventId],
        proposedByAgentIds: [representativeId],
        supportedByAgentIds: supporterIds,
        opposedByAgentIds: world.agents
          .map(({ id }) => id)
          .filter((id) => !supporterIds.includes(id)),
        decidedAtTick: 0,
      },
    },
  ];
}

function institutionGateWorld(majoritySupport: boolean, foodPressure: boolean): WorldState {
  const world = generateWorld(42);
  const homelandId = world.history.settlementOrigin?.homelandPolityId;
  const homeland = world.history.polities.find(({ id }) => id === homelandId);
  if (homeland === undefined) throw new Error("missing homeland polity");
  homeland.values = [];

  for (const [index, agent] of world.agents.entries()) {
    agent.desires.foodSecurity = index === 0 || (majoritySupport && index === 1) ? 1 : 0;
  }
  const supporterIds = majoritySupport ? ["agent-1", "agent-2"] : ["agent-1"];
  insertCollective(world, supporterIds);
  setFoodDays(
    world,
    foodPressure ? INSTITUTION_FOOD_PRESSURE_DAYS - 0.1 : INSTITUTION_FOOD_PRESSURE_DAYS,
  );
  world.tick = SOCIETY_UPDATE_INTERVAL_TICKS;
  return world;
}

describe("collective lifecycle", () => {
  it("forms after sustained support and dissolves exactly at the low-support boundary", () => {
    const world = supportedWorld();
    const memory = createSocietyMemory();

    advanceFor(world, memory, COLLECTIVE_FORMATION_TICKS - SOCIETY_UPDATE_INTERVAL_TICKS);
    expect(world.collectives).toEqual([]);

    advanceFor(world, memory, SOCIETY_UPDATE_INTERVAL_TICKS);

    expect(world.collectives).toEqual([
      expect.objectContaining({
        id: `collective-communalGranaryStore-${world.tick}`,
        purpose: "communalGranaryStore",
        supporterIds: ["agent-1", "agent-2", "agent-3"],
        representativeId: "agent-1",
        formedAtTick: world.tick,
      }),
    ]);
    expect(world.collectives[0]?.cohesion).toBeGreaterThanOrEqual(0);
    expect(world.collectives[0]?.cohesion).toBeLessThanOrEqual(1);

    setFoodDays(world, 10);
    for (const agent of world.agents) agent.desires.foodSecurity = 0;
    advanceFor(world, memory, COLLECTIVE_DISSOLUTION_TICKS - SOCIETY_UPDATE_INTERVAL_TICKS);
    expect(world.collectives).toHaveLength(1);

    advanceFor(world, memory, SOCIETY_UPDATE_INTERVAL_TICKS);
    expect(world.collectives).toEqual([]);
  });

  it("resets formation progress after one interval without support", () => {
    const world = supportedWorld();
    const memory = createSocietyMemory();

    advanceFor(world, memory, COLLECTIVE_FORMATION_TICKS - SOCIETY_UPDATE_INTERVAL_TICKS);
    for (const agent of world.agents) agent.desires.foodSecurity = 0;
    advanceFor(world, memory, SOCIETY_UPDATE_INTERVAL_TICKS);
    for (const agent of world.agents) agent.desires.foodSecurity = 1;

    advanceFor(world, memory, COLLECTIVE_FORMATION_TICKS - SOCIETY_UPDATE_INTERVAL_TICKS);
    expect(world.collectives).toEqual([]);

    advanceFor(world, memory, SOCIETY_UPDATE_INTERVAL_TICKS);
    expect(world.collectives).toHaveLength(1);
  });
});

describe("institution establishment", () => {
  it.each([
    { majoritySupport: false, foodPressure: false, expectedCount: 0 },
    { majoritySupport: true, foodPressure: false, expectedCount: 0 },
    { majoritySupport: false, foodPressure: true, expectedCount: 0 },
    { majoritySupport: true, foodPressure: true, expectedCount: 1 },
  ])(
    "requires majority=$majoritySupport and food pressure=$foodPressure",
    ({ majoritySupport, foodPressure, expectedCount }) => {
      const world = institutionGateWorld(majoritySupport, foodPressure);

      advanceSociety(world, createSocietyMemory());

      expect(world.institutions).toHaveLength(expectedCount);
    },
  );

  it("records real history and the exact support partition without duplicates", () => {
    const world = institutionGateWorld(true, true);
    const collective = world.collectives[0];
    if (collective === undefined) throw new Error("missing collective");
    const departureEventId = world.history.settlementOrigin?.departureEventId;
    if (departureEventId === undefined) throw new Error("missing departure event");
    const memory = createSocietyMemory();

    advanceSociety(world, memory);

    const institution = world.institutions[0];
    expect(institution).toEqual({
      id: `institution-communalGranaryStore-${world.tick}`,
      kind: "communalGranaryStore",
      supporterIds: ["agent-1", "agent-2"],
      opposedIds: ["agent-3"],
      establishedAtTick: world.tick,
      provenance: {
        causedByEventIds: expect.arrayContaining([departureEventId]),
        proposedByAgentIds: [collective.representativeId],
        supportedByAgentIds: ["agent-1", "agent-2"],
        opposedByAgentIds: ["agent-3"],
        decidedAtTick: world.tick,
      },
    });
    for (const eventId of institution?.provenance.causedByEventIds ?? []) {
      expect(world.history.events.some(({ id }) => id === eventId)).toBe(true);
    }

    world.tick += SOCIETY_UPDATE_INTERVAL_TICKS;
    advanceSociety(world, memory);
    expect(world.institutions).toHaveLength(1);
  });
});
