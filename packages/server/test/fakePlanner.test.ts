import type { AgentState, Tile, WorldState } from "@agent-town/shared";
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
  };
}

describe("FakePlanner", () => {
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
});
