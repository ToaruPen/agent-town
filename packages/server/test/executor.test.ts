import {
  type AgentState,
  CARRY_CAPACITY,
  GATHER_TICKS,
  MOVE_TICKS_PER_TILE,
  type ResourceKind,
  type Terrain,
  type Tile,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { stepAgent } from "../src/sim/executor.js";

interface TileOverride {
  pos: { x: number; y: number };
  terrain: Terrain;
  resource?: { kind: ResourceKind; amount: number };
}

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

function createWorld(width: number, height: number, overrides: TileOverride[] = []): WorldState {
  const overrideByPosition = new Map(
    overrides.map((override) => [`${override.pos.x},${override.pos.y}`, override]),
  );
  const tiles: Tile[] = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const override = overrideByPosition.get(`${x},${y}`);
    return {
      terrain: override?.terrain ?? "plains",
      resource: override?.resource ?? null,
    };
  });

  return {
    tick: 0,
    width,
    height,
    tiles,
    agents: [],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    deaths: [],
  };
}

describe("stepAgent", () => {
  it("completes moveTo after distance times MOVE_TICKS_PER_TILE ticks", () => {
    const world = createWorld(3, 1);
    const agent = createAgent({ tasks: [{ kind: "moveTo", dest: { x: 2, y: 0 } }] });
    world.agents.push(agent);

    for (let tick = 1; tick < 2 * MOVE_TICKS_PER_TILE; tick += 1) {
      stepAgent(world, agent);
      expect(agent.tasks).toHaveLength(1);
    }
    stepAgent(world, agent);

    expect(agent.pos).toEqual({ x: 2, y: 0 });
    expect(agent.tasks).toEqual([]);
    expect(agent.activity).toEqual({ kind: "idle" });
  });

  it("gathers exactly CARRY_CAPACITY and removes a depleted resource", () => {
    const target = { x: 1, y: 0 };
    const world = createWorld(2, 1, [
      { pos: target, terrain: "forest", resource: { kind: "wood", amount: CARRY_CAPACITY } },
    ]);
    const agent = createAgent({ tasks: [{ kind: "gather", resource: "wood", target }] });
    world.agents.push(agent);

    for (let tick = 1; tick < GATHER_TICKS; tick += 1) {
      stepAgent(world, agent);
      expect(agent.carrying).toBeNull();
    }
    stepAgent(world, agent);

    expect(agent.carrying).toEqual({ kind: "wood", amount: CARRY_CAPACITY });
    expect(world.tiles[1]?.resource).toBeNull();
    expect(agent.tasks).toEqual([]);
    expect(agent.activity).toEqual({ kind: "idle" });
  });

  it("drops gather when the target resource is depleted", () => {
    const target = { x: 1, y: 0 };
    const world = createWorld(2, 1, [{ pos: target, terrain: "forest" }]);
    const agent = createAgent({
      activity: { kind: "gathering", target, ticksRemaining: 1 },
      tasks: [{ kind: "gather", resource: "wood", target }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(agent.tasks).toEqual([]);
    expect(agent.activity).toEqual({ kind: "idle" });
    expect(agent.carrying).toBeNull();
  });

  it.each([["wood", 3] as const, ["food", 4] as const])(
    "deposits carried %s into the matching stockpile field",
    (kind, amount) => {
      const world = createWorld(2, 1);
      world.stockpile.pos = { x: 1, y: 0 };
      const agent = createAgent({ carrying: { kind, amount }, tasks: [{ kind: "deposit" }] });
      world.agents.push(agent);

      stepAgent(world, agent);

      expect(world.stockpile[kind]).toBe(amount);
      expect(world.stockpile[kind === "wood" ? "food" : "wood"]).toBe(0);
      expect(agent.carrying).toBeNull();
      expect(agent.tasks).toEqual([]);
      expect(agent.activity).toEqual({ kind: "idle" });
    },
  );

  it("drops an unreachable moveTo task and leaves the agent idle", () => {
    const world = createWorld(3, 3, [
      { pos: { x: 1, y: 0 }, terrain: "water" },
      { pos: { x: 0, y: 1 }, terrain: "water" },
      { pos: { x: 2, y: 1 }, terrain: "water" },
      { pos: { x: 1, y: 2 }, terrain: "water" },
    ]);
    const agent = createAgent({ tasks: [{ kind: "moveTo", dest: { x: 1, y: 1 } }] });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(agent.tasks).toEqual([]);
    expect(agent.activity).toEqual({ kind: "idle" });
    expect(agent.pos).toEqual({ x: 0, y: 0 });
  });

  it("leaves an agent with an empty task queue idle", () => {
    const world = createWorld(1, 1);
    const agent = createAgent({ activity: { kind: "depositing" } });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(agent.activity).toEqual({ kind: "idle" });
  });
});
