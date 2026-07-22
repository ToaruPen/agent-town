import {
  type AgentState,
  MAX_PLAN_TASKS,
  STOCKPILE_TARGET_FOOD,
  STOCKPILE_TARGET_WOOD,
  type Tile,
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
    expect(prompt).toContain("position: (3,1)");
    expect(prompt).toContain("carrying: wood 2");
    expect(prompt).toContain("stockpile position: (3,3)");
    expect(prompt).toContain(`wood: 7 / target ${STOCKPILE_TARGET_WOOD}`);
    expect(prompt).toContain(`food: 4 / target ${STOCKPILE_TARGET_FOOD}`);
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
    expect(prompt).toContain(`1..${MAX_PLAN_TASKS} tasks`);
  });
});
