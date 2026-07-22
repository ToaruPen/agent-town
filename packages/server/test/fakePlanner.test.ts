import {
  type AgentState,
  DAYS_PER_SEASON,
  FOOD_PER_MEAL,
  HUNGER_EAT_THRESHOLD,
  STOCKPILE_TARGET_FOOD,
  STOCKPILE_TARGET_WOOD,
  type Tile,
  WOOD_BURN_PER_AGENT_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { FakePlanner } from "../src/sim/fakePlanner.js";

function createAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "agent-1",
    name: "Ash",
    pos: { x: 0, y: 0 },
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

function createWorld(agent: AgentState, tiles: Tile[]): WorldState {
  return {
    tick: 0,
    width: tiles.length,
    height: 1,
    tiles,
    agents: [agent],
    stockpile: { pos: { x: tiles.length - 1, y: 0 }, wood: 0, food: 0 },
    deaths: [],
  };
}

describe("FakePlanner", () => {
  it("plans to eat when the agent is hungry", () => {
    const agent = createAgent({ hunger: HUNGER_EAT_THRESHOLD - 1 });
    const world = createWorld(agent, [{ terrain: "plains", resource: null }]);

    const tasks = new FakePlanner(() => 0).plan(world, agent);

    expect(tasks).toEqual([{ kind: "eat" }]);
  });

  it("assigns moveTo and gather for the nearest wood when the stockpile is empty", () => {
    const agent = createAgent();
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "forest", resource: { kind: "wood", amount: 20 } },
      { terrain: "plains", resource: null },
    ]);

    const tasks = new FakePlanner(() => 0).plan(world, agent);

    expect(tasks).toEqual([
      { kind: "moveTo", dest: { x: 1, y: 0 } },
      { kind: "gather", resource: "wood", target: { x: 1, y: 0 } },
    ]);
  });

  it("assigns moveTo stockpile and deposit when carrying", () => {
    const agent = createAgent({ carrying: { kind: "wood", amount: 5 } });
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
    ]);

    const tasks = new FakePlanner(() => 0).plan(world, agent);

    expect(tasks).toEqual([{ kind: "moveTo", dest: world.stockpile.pos }, { kind: "deposit" }]);
  });

  it("prioritizes depositing carried food over eating when hungry", () => {
    const agent = createAgent({
      carrying: { kind: "food", amount: FOOD_PER_MEAL },
      hunger: HUNGER_EAT_THRESHOLD - 1,
    });
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
    ]);

    const tasks = new FakePlanner(() => 0).plan(world, agent);

    expect(tasks).toEqual([{ kind: "moveTo", dest: world.stockpile.pos }, { kind: "deposit" }]);
  });

  it("scales the food stockpile target with the current population", () => {
    const agent = createAgent();
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: { kind: "food", amount: 10 } },
    ]);
    world.agents.push(createAgent({ id: "agent-2", name: "Birch" }));
    world.stockpile.wood = STOCKPILE_TARGET_WOOD;
    world.stockpile.food = STOCKPILE_TARGET_FOOD;

    const tasks = new FakePlanner(() => 0).plan(world, agent);

    expect(tasks).toEqual([
      { kind: "moveTo", dest: { x: 1, y: 0 } },
      { kind: "gather", resource: "food", target: { x: 1, y: 0 } },
    ]);
  });

  it("gathers wood only below the current population's full-winter reserve", () => {
    const agent = createAgent();
    const woodTarget = { x: 1, y: 0 };
    const world = createWorld(agent, [
      { terrain: "plains", resource: null },
      { terrain: "forest", resource: { kind: "wood", amount: 10 } },
    ]);
    world.agents.push(createAgent({ id: "agent-2", name: "Birch" }));
    world.stockpile.food = STOCKPILE_TARGET_FOOD * world.agents.length;
    const winterReserve = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;
    const planner = new FakePlanner(() => 0);

    world.stockpile.wood = winterReserve - 1;
    expect(planner.plan(world, agent)).toEqual([
      { kind: "moveTo", dest: woodTarget },
      { kind: "gather", resource: "wood", target: woodTarget },
    ]);

    world.stockpile.wood = winterReserve;
    expect(planner.plan(world, agent)).not.toContainEqual({
      kind: "gather",
      resource: "wood",
      target: woodTarget,
    });
  });
});
