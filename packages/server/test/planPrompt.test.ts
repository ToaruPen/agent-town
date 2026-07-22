import {
  type AgentState,
  DAYS_PER_SEASON,
  FOOD_PER_MEAL,
  HOUSE_CAPACITY,
  HOUSE_WOOD_COST,
  MAX_PLAN_TASKS,
  STOCKPILE_TARGET_FOOD,
  STOCKPILE_TARGET_WOOD,
  TICKS_PER_DAY,
  type Tile,
  WOOD_BURN_PER_AGENT_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { buildPlanPrompt } from "../src/llm/planPrompt.js";

function createAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "agent-1",
    name: "Ash",
    pos: { x: 3, y: 1 },
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

function createWorld(agent: AgentState): WorldState {
  const width = 7;
  const height = 4;
  const tiles: Tile[] = Array.from({ length: width * height }, () => ({
    terrain: "plains",
    resource: null,
  }));
  const resources = [
    { x: 3, y: 0, tile: { terrain: "forest", resource: { kind: "wood", amount: 11 } } },
    { x: 2, y: 1, tile: { terrain: "forest", resource: { kind: "wood", amount: 12 } } },
    { x: 4, y: 1, tile: { terrain: "forest", resource: { kind: "wood", amount: 13 } } },
    { x: 3, y: 2, tile: { terrain: "forest", resource: { kind: "wood", amount: 14 } } },
    { x: 1, y: 1, tile: { terrain: "forest", resource: { kind: "wood", amount: 15 } } },
    { x: 5, y: 1, tile: { terrain: "forest", resource: { kind: "wood", amount: 16 } } },
    { x: 2, y: 0, tile: { terrain: "plains", resource: { kind: "food", amount: 21 } } },
    { x: 4, y: 0, tile: { terrain: "plains", resource: { kind: "food", amount: 22 } } },
    { x: 1, y: 0, tile: { terrain: "plains", resource: { kind: "food", amount: 23 } } },
    { x: 5, y: 0, tile: { terrain: "plains", resource: { kind: "food", amount: 24 } } },
    { x: 0, y: 1, tile: { terrain: "plains", resource: { kind: "food", amount: 25 } } },
    { x: 6, y: 1, tile: { terrain: "plains", resource: { kind: "food", amount: 26 } } },
  ] as const;

  for (const { x, y, tile } of resources) tiles[y * width + x] = tile;

  return {
    tick: 17,
    width,
    height,
    tiles,
    agents: [agent],
    stockpile: { pos: { x: 3, y: 3 }, wood: 7, food: 4 },
    buildings: [],
    deaths: [],
  };
}

describe("buildPlanPrompt", () => {
  it("includes the agent persona, position, carrying, and stockpile context", () => {
    const agent = createAgent({ carrying: { kind: "wood", amount: 2 } });

    const prompt = buildPlanPrompt(createWorld(agent), agent);

    expect(prompt).toContain("Ash, a diligent forester who worries about winter");
    expect(prompt).toContain("you must survive the winter");
    expect(prompt).toContain("position: (3,1)");
    expect(prompt).toContain("carrying: wood 2");
    expect(prompt).toContain("stockpile position: (3,3)");
    expect(prompt).toContain(`wood: 7 / target ${STOCKPILE_TARGET_WOOD}`);
    expect(prompt).toContain(`food: 4 / target ${STOCKPILE_TARGET_FOOD}`);
  });

  it("includes calendar, survival forecasts, needs, and completed housing capacity", () => {
    const agent = createAgent({ hunger: 39, fatigue: 24, health: 75 });
    const world = createWorld(agent);
    const secondAgent = createAgent({ id: "agent-2", name: "Birch" });
    world.agents.push(secondAgent);
    world.tick = 4 * TICKS_PER_DAY;
    world.stockpile.food = FOOD_PER_MEAL * 2;
    world.stockpile.wood = 3;
    world.buildings = [
      { kind: "house", pos: { x: 0, y: 3 }, progress: 400, complete: true },
      { kind: "house", pos: { x: 1, y: 3 }, progress: 20, complete: false },
    ];

    const prompt = buildPlanPrompt(world, agent);
    const winterWoodNeed = world.agents.length * WOOD_BURN_PER_AGENT_PER_DAY * DAYS_PER_SEASON;

    expect(prompt).toContain("calendar: day 5, season autumn, 2 days until winter");
    expect(prompt).toContain("food: 10 stored, 1.20 days remaining");
    expect(prompt).toContain(
      `wood: 3 stored / ${winterWoodNeed} needed for remaining winter (2 future burn days)`,
    );
    expect(prompt).toContain("needs: hunger=39, fatigue=24, health=75");
    expect(prompt).toContain(`population: 2 / completed-house capacity ${HOUSE_CAPACITY}`);
  });

  it("reduces remaining winter wood need after each winter day-start burn", () => {
    const agent = createAgent();
    const world = createWorld(agent);
    const winterStart = 3 * DAYS_PER_SEASON * TICKS_PER_DAY;
    const nextSpring = 4 * DAYS_PER_SEASON * TICKS_PER_DAY;
    const woodPerDay = WOOD_BURN_PER_AGENT_PER_DAY;

    world.tick = winterStart;
    expect(buildPlanPrompt(world, agent)).toContain(
      `wood: 7 stored / ${woodPerDay} needed for remaining winter (1 future burn day)`,
    );

    world.tick = winterStart + TICKS_PER_DAY;
    expect(buildPlanPrompt(world, agent)).toContain(
      "wood: 7 stored / 0 needed for remaining winter (0 future burn days)",
    );

    world.tick = nextSpring;
    expect(buildPlanPrompt(world, agent)).toContain(
      `wood: 7 stored / ${woodPerDay * DAYS_PER_SEASON} needed for remaining winter (2 future burn days)`,
    );
  });

  it("lists the five Manhattan-nearest resource tiles with index tie-breaking", () => {
    const agent = createAgent();

    const prompt = buildPlanPrompt(createWorld(agent), agent);

    expect(prompt).toContain(
      [
        "nearest wood tiles:",
        "- (3,0) amount=11",
        "- (2,1) amount=12",
        "- (4,1) amount=13",
        "- (3,2) amount=14",
        "- (1,1) amount=15",
      ].join("\n"),
    );
    expect(prompt).not.toContain("(5,1) amount=16");
    expect(prompt).toContain(
      [
        "nearest food tiles:",
        "- (2,0) amount=21",
        "- (4,0) amount=22",
        "- (1,0) amount=23",
        "- (5,0) amount=24",
        "- (0,1) amount=25",
      ].join("\n"),
    );
    expect(prompt).not.toContain("(6,1) amount=26");
  });

  it("requires only the strict JSON object with one through MAX_PLAN_TASKS tasks", () => {
    const agent = createAgent();

    const prompt = buildPlanPrompt(createWorld(agent), agent);

    expect(prompt).toContain("Reply with ONLY a JSON object");
    expect(prompt).toContain('"reasoning": "<one short sentence>"');
    expect(prompt).toContain('"kind":"moveTo","dest":{"x":0,"y":0}');
    expect(prompt).toContain('"kind":"gather","resource":"wood"|"food"');
    expect(prompt).toContain('{"kind":"deposit"}');
    expect(prompt).toContain('{"kind":"eat"}');
    expect(prompt).toContain('{"kind":"forage","target":{"x":0,"y":0}}');
    expect(prompt).toContain('{"kind":"build","pos":{"x":0,"y":0}}');
    expect(prompt).toContain('{"kind":"rest"}');
    expect(prompt).toContain("eat: when hunger is low");
    expect(prompt).toContain("forage: when hungry and stored food cannot provide a meal");
    expect(prompt).toContain("build: choose the house site only; this action navigates adjacent");
    expect(prompt).toContain(`costs ${HOUSE_WOOD_COST} wood for a new house`);
    expect(prompt).toContain("never add moveTo onto a build site");
    expect(prompt).toContain("rest: when fatigue is low");
    expect(prompt).toContain("deposit: use an explicit moveTo to the stockpile first");
    expect(prompt).toContain(`1..${MAX_PLAN_TASKS} tasks`);
  });
});
