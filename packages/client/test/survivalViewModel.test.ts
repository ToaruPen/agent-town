import {
  type AgentState,
  DAYS_PER_SEASON,
  SEASONS,
  TICKS_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  buildNeedsViewModel,
  buildSurvivalHudViewModel,
  createDeathEventSchedule,
  latestDeathEvent,
  updateDeathEventSchedule,
} from "../src/ui/survivalViewModel.js";

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "ash",
    name: "Ash",
    pos: { x: 2, y: 3 },
    carrying: null,
    activity: { kind: "idle" },
    tasks: [],
    planSource: "fake",
    thinking: false,
    lastThought: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
    ...overrides,
  };
}

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    tick: 0,
    width: 8,
    height: 8,
    tiles: [],
    agents: [makeAgent(), makeAgent({ id: "birch", name: "Birch", pos: { x: 3, y: 3 } })],
    stockpile: { pos: { x: 4, y: 4 }, wood: 8, food: 25 },
    buildings: [],
    deaths: [],
    ...overrides,
  };
}

describe("buildSurvivalHudViewModel", () => {
  it("formats the calendar, population, stores, and pre-winter forecasts", () => {
    expect(buildSurvivalHudViewModel(makeWorld())).toEqual({
      day: 1,
      season: "spring",
      population: 2,
      foodStored: 25,
      foodDays: "3.0",
      woodStored: 8,
      woodForecast: "winter-ok",
    });
  });

  it("counts only future winter burns and resets the forecast next spring", () => {
    const winterStartDay = DAYS_PER_SEASON * (SEASONS.length - 1);
    const winterDayOne = winterStartDay * TICKS_PER_DAY;
    const winterDayTwo = (winterStartDay + 1) * TICKS_PER_DAY;
    const nextSpring = DAYS_PER_SEASON * SEASONS.length * TICKS_PER_DAY;
    const short = makeWorld({
      tick: winterDayOne,
      stockpile: { pos: { x: 4, y: 4 }, wood: 3, food: 25 },
    });
    const finalBurnAlreadyApplied = makeWorld({
      tick: winterDayTwo,
      stockpile: { pos: { x: 4, y: 4 }, wood: 0, food: 25 },
    });
    const newYear = makeWorld({
      tick: nextSpring,
      stockpile: { pos: { x: 4, y: 4 }, wood: 7, food: 25 },
    });

    expect(buildSurvivalHudViewModel(short).woodForecast).toBe("short");
    expect(buildSurvivalHudViewModel(finalBurnAlreadyApplied).woodForecast).toBe("winter-ok");
    expect(buildSurvivalHudViewModel(newYear).woodForecast).toBe("short");
  });

  it("uses a stable placeholder for a non-finite food forecast", () => {
    const world = makeWorld({
      stockpile: { pos: { x: 4, y: 4 }, wood: 8, food: Number.POSITIVE_INFINITY },
    });

    expect(buildSurvivalHudViewModel(world).foodDays).toBe("—");
  });
});

describe("buildNeedsViewModel", () => {
  it("clamps each gauge and includes a numeric label", () => {
    expect(buildNeedsViewModel(makeAgent({ hunger: -2.4, fatigue: 43.6, health: 120 }))).toEqual([
      { kind: "hunger", label: "Hunger", value: 0, max: 100, valueLabel: "0" },
      { kind: "fatigue", label: "Fatigue", value: 43.6, max: 100, valueLabel: "44" },
      { kind: "health", label: "Health", value: 100, max: 100, valueLabel: "100" },
    ]);
  });
});

describe("death event schedule", () => {
  it("observes welcome history without replaying events", () => {
    const welcome = makeWorld({
      deaths: [{ name: "Old Ash", tick: 10, cause: "cold" }],
    });

    expect(createDeathEventSchedule(welcome)).toEqual({ observedDeaths: 1, events: [] });
  });

  it("captures the previous position, formats the event, and expires it after one day", () => {
    const deathTick = 6 * TICKS_PER_DAY;
    const previous = makeWorld({ tick: deathTick - 1 });
    const next = makeWorld({
      tick: deathTick,
      agents: previous.agents.filter((agent) => agent.name !== "Ash"),
      deaths: [{ name: "Ash", tick: deathTick, cause: "starvation" }],
    });
    const scheduled = updateDeathEventSchedule(createDeathEventSchedule(previous), previous, next);

    expect(scheduled.events).toEqual([
      {
        id: "0:14400:Ash",
        name: "Ash",
        pos: { x: 2, y: 3 },
        cause: "starvation",
        deathTick,
        expiresAtTick: deathTick + TICKS_PER_DAY,
        text: "Ash starved, day 7",
      },
    ]);
    expect(latestDeathEvent(scheduled)?.text).toBe("Ash starved, day 7");

    const beforeExpiry = updateDeathEventSchedule(scheduled, next, {
      ...next,
      tick: deathTick + TICKS_PER_DAY - 1,
    });
    const expired = updateDeathEventSchedule(
      beforeExpiry,
      { ...next, tick: deathTick + TICKS_PER_DAY - 1 },
      { ...next, tick: deathTick + TICKS_PER_DAY },
    );
    expect(beforeExpiry.events).toHaveLength(1);
    expect(expired.events).toHaveLength(0);
  });

  it("keeps same-step deaths distinct and can later schedule a reused name", () => {
    const dahlia = makeAgent({ id: "dahlia", name: "Dahlia", pos: { x: 5, y: 6 } });
    const previous = makeWorld({ agents: [makeAgent(), dahlia] });
    const next = makeWorld({
      tick: 100,
      agents: [],
      deaths: [
        { name: "Ash", tick: 100, cause: "cold" },
        { name: "Dahlia", tick: 100, cause: "starvation" },
      ],
    });
    const first = updateDeathEventSchedule(createDeathEventSchedule(previous), previous, next);
    expect(first.events.map((event) => event.id)).toEqual(["0:100:Ash", "1:100:Dahlia"]);
    expect(latestDeathEvent(first)?.text).toBe("Dahlia starved, day 1");
    expect(first.events[0]?.text).toBe("Ash died from cold, day 1");

    const reusedPrevious = {
      ...next,
      tick: 200,
      agents: [makeAgent({ id: "immigrant-8", name: "Dahlia", pos: { x: 7, y: 1 } })],
    };
    const reusedNext = {
      ...reusedPrevious,
      tick: 201,
      agents: [],
      deaths: [...next.deaths, { name: "Dahlia", tick: 201, cause: "cold" as const }],
    };
    const reused = updateDeathEventSchedule(first, reusedPrevious, reusedNext);
    expect(reused.events.at(-1)?.id).toBe("2:201:Dahlia");
    expect(reused.events.at(-1)?.pos).toEqual({ x: 7, y: 1 });
  });
});
