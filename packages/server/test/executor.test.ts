import {
  type AgentState,
  CARRY_CAPACITY,
  EAT_TICKS,
  FATIGUE_MAX,
  FATIGUE_REST_RECOVERY_PER_DAY,
  FOOD_PER_MEAL,
  FORAGE_TICKS,
  GATHER_TICKS,
  HOUSE_BUILD_TICKS,
  HOUSE_WOOD_COST,
  MOVE_TICKS_PER_TILE,
  type ResourceKind,
  type Terrain,
  TICKS_PER_DAY,
  type Tile,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { stepAgent } from "../src/sim/executor.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

interface TileOverride {
  pos: { x: number; y: number };
  terrain: Terrain;
  resource?: { kind: ResourceKind; amount: number };
  resourceOrigin?: ResourceKind;
}

function createAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "agent-1",
    name: "トネリコ",
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
      ...(override?.resourceOrigin === undefined
        ? {}
        : { resourceOrigin: override.resourceOrigin }),
    };
  });

  return {
    tick: 0,
    width,
    height,
    tiles,
    agents: [],
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
  };
}

describe("stepAgent", () => {
  it("eats one meal from the stockpile after 10 ticks", () => {
    const world = createWorld(1, 1);
    world.stockpile.food = 10;
    const agent = createAgent({ hunger: 20, tasks: [{ kind: "eat" }] });
    world.agents.push(agent);

    for (let tick = 1; tick < EAT_TICKS; tick += 1) {
      stepAgent(world, agent);
      expect(agent.hunger).toBe(20);
      expect(world.stockpile.food).toBe(10);
    }
    stepAgent(world, agent);

    expect(agent.hunger).toBe(80);
    expect(world.stockpile.food).toBe(5);
    expect(agent.tasks).toEqual([]);
    expect(agent.activity).toEqual({ kind: "idle" });
  });

  it("caps hunger at the maximum after eating", () => {
    const world = createWorld(1, 1);
    world.stockpile.food = 5;
    const agent = createAgent({ hunger: 70, tasks: [{ kind: "eat" }] });
    world.agents.push(agent);

    for (let tick = 0; tick < EAT_TICKS; tick += 1) stepAgent(world, agent);

    expect(agent.hunger).toBe(100);
  });

  it("moves within reach of the stockpile before eating", () => {
    const world = createWorld(3, 1);
    world.stockpile = { pos: { x: 2, y: 0 }, wood: 0, food: 5 };
    const agent = createAgent({ hunger: 20, tasks: [{ kind: "eat" }] });
    world.agents.push(agent);

    for (let tick = 1; tick < MOVE_TICKS_PER_TILE + EAT_TICKS; tick += 1) {
      stepAgent(world, agent);
    }
    expect(agent.hunger).toBe(20);
    stepAgent(world, agent);

    expect(agent.pos).toEqual({ x: 1, y: 0 });
    expect(agent.hunger).toBe(80);
    expect(world.stockpile.food).toBe(0);
  });

  it("forages one meal directly from a food tile after 30 ticks", () => {
    const target = { x: 0, y: 0 };
    const world = createWorld(1, 1, [
      { pos: target, terrain: "plains", resource: { kind: "food", amount: 7 } },
    ]);
    const agent = createAgent({ hunger: 20, tasks: [{ kind: "forage", target }] });
    world.agents.push(agent);

    for (let tick = 1; tick < FORAGE_TICKS; tick += 1) {
      stepAgent(world, agent);
      expect(agent.hunger).toBe(20);
      expect(world.tiles[0]?.resource).toEqual({ kind: "food", amount: 7 });
    }
    stepAgent(world, agent);

    expect(agent.hunger).toBe(80);
    expect(world.tiles[0]?.resource).toEqual({ kind: "food", amount: 2 });
    expect(agent.tasks).toEqual([]);
    expect(agent.activity).toEqual({ kind: "idle" });
  });

  it("caps hunger at the maximum after foraging", () => {
    const target = { x: 0, y: 0 };
    const world = createWorld(1, 1, [
      { pos: target, terrain: "plains", resource: { kind: "food", amount: 5 } },
    ]);
    const agent = createAgent({ hunger: 70, tasks: [{ kind: "forage", target }] });
    world.agents.push(agent);

    for (let tick = 0; tick < FORAGE_TICKS; tick += 1) stepAgent(world, agent);

    expect(agent.hunger).toBe(100);
  });

  it("depletes a sparse food tile without making its amount negative", () => {
    const target = { x: 0, y: 0 };
    const world = createWorld(1, 1, [
      { pos: target, terrain: "plains", resource: { kind: "food", amount: 3 } },
    ]);
    const agent = createAgent({ hunger: 20, tasks: [{ kind: "forage", target }] });
    world.agents.push(agent);

    for (let tick = 0; tick < FORAGE_TICKS; tick += 1) stepAgent(world, agent);

    expect(world.tiles[0]?.resource).toBeNull();
  });

  it("moves onto a food tile before foraging", () => {
    const target = { x: 2, y: 0 };
    const world = createWorld(3, 1, [
      { pos: target, terrain: "plains", resource: { kind: "food", amount: 5 } },
    ]);
    const agent = createAgent({ hunger: 20, tasks: [{ kind: "forage", target }] });
    world.agents.push(agent);

    for (let tick = 1; tick < 2 * MOVE_TICKS_PER_TILE + FORAGE_TICKS; tick += 1) {
      stepAgent(world, agent);
    }
    expect(agent.hunger).toBe(20);
    stepAgent(world, agent);

    expect(agent.pos).toEqual(target);
    expect(agent.hunger).toBe(80);
    expect(world.tiles[2]?.resource).toBeNull();
  });

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
      {
        pos: target,
        terrain: "forest",
        resource: { kind: "wood", amount: CARRY_CAPACITY },
        resourceOrigin: "wood",
      },
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
    expect(world.tiles[1]?.resourceOrigin).toBe("wood");
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

  it("moves to a valid build site, charges once, and completes after 400 action ticks", () => {
    const site = { x: 2, y: 0 };
    const world = createWorld(3, 1);
    world.stockpile.wood = HOUSE_WOOD_COST;
    const agent = createAgent({ tasks: [{ kind: "build", pos: site }] });
    world.agents.push(agent);

    for (let tick = 0; tick < MOVE_TICKS_PER_TILE; tick += 1) stepAgent(world, agent);
    expect(agent.pos).toEqual({ x: 1, y: 0 });
    expect(world.buildings).toEqual([]);

    for (let tick = 1; tick < HOUSE_BUILD_TICKS; tick += 1) stepAgent(world, agent);
    expect(world.stockpile.wood).toBe(0);
    expect(world.buildings).toEqual([
      { kind: "house", pos: site, progress: HOUSE_BUILD_TICKS - 1, complete: false },
    ]);

    stepAgent(world, agent);
    expect(world.buildings).toEqual([
      { kind: "house", pos: site, progress: HOUSE_BUILD_TICKS, complete: true },
    ]);
    expect(agent.tasks).toEqual([]);
  });

  it("resumes and cooperatively caps an incomplete house without another charge", () => {
    const site = { x: 0, y: 0 };
    const world = createWorld(1, 1);
    world.stockpile.wood = 99;
    world.buildings = [
      { kind: "house", pos: site, progress: HOUSE_BUILD_TICKS - 1, complete: false },
    ];
    const first = createAgent({ id: "agent-1", tasks: [{ kind: "build", pos: site }] });
    const second = createAgent({ id: "agent-2", tasks: [{ kind: "build", pos: site }] });
    world.agents.push(first, second);

    stepAgent(world, first);
    stepAgent(world, second);

    expect(world.stockpile.wood).toBe(99);
    expect(world.buildings).toEqual([
      { kind: "house", pos: site, progress: HOUSE_BUILD_TICKS, complete: true },
    ]);
    expect(first.tasks).toEqual([]);
    expect(second.tasks).toEqual([]);
  });

  it("drops unaffordable, invalid, and unreachable build tasks without mutation", () => {
    const invalidWorld = createWorld(1, 1);
    invalidWorld.stockpile.wood = HOUSE_WOOD_COST;
    const unreachableWorld = createWorld(3, 1, [{ pos: { x: 1, y: 0 }, terrain: "water" }]);
    unreachableWorld.stockpile.wood = HOUSE_WOOD_COST;
    const cases = [
      { world: createWorld(1, 1), pos: { x: 0, y: 0 } },
      { world: invalidWorld, pos: { x: 1, y: 0 } },
      { world: unreachableWorld, pos: { x: 2, y: 0 } },
    ];

    for (const { world, pos } of cases) {
      const woodBefore = world.stockpile.wood;
      const agent = createAgent({ tasks: [{ kind: "build", pos }] });
      world.agents.push(agent);
      stepAgent(world, agent);
      expect(agent.tasks).toEqual([]);
      expect(world.stockpile.wood).toBe(woodBefore);
      expect(world.buildings).toEqual([]);
    }
  });

  it("rejects a distant unaffordable build before moving", () => {
    const world = createWorld(3, 1);
    const agent = createAgent({ tasks: [{ kind: "build", pos: { x: 2, y: 0 } }] });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(agent.pos).toEqual({ x: 0, y: 0 });
    expect(agent.tasks).toEqual([]);
    expect(world.buildings).toEqual([]);
  });

  it("drops a new build without charging when a resource appears during travel", () => {
    const site = { x: 3, y: 0 };
    const world = createWorld(4, 1);
    world.stockpile.wood = HOUSE_WOOD_COST;
    const agent = createAgent({ tasks: [{ kind: "build", pos: site }] });
    world.agents.push(agent);

    stepAgent(world, agent);
    world.tiles[3] = {
      terrain: "plains",
      resource: { kind: "food", amount: 1 },
    };
    stepAgent(world, agent);

    expect(agent.tasks).toEqual([]);
    expect(world.stockpile.wood).toBe(HOUSE_WOOD_COST);
    expect(world.buildings).toEqual([]);
  });

  it("drops a new build without charging when another agent occupies the site", () => {
    const site = { x: 3, y: 0 };
    const world = createWorld(4, 1);
    world.stockpile.wood = HOUSE_WOOD_COST;
    const builder = createAgent({ tasks: [{ kind: "build", pos: site }] });
    const occupant = createAgent({ id: "agent-2", name: "シラカバ", pos: { x: 2, y: 0 } });
    world.agents.push(builder, occupant);

    stepAgent(world, builder);
    occupant.pos = site;
    stepAgent(world, builder);

    expect(builder.tasks).toEqual([]);
    expect(world.stockpile.wood).toBe(HOUSE_WOOD_COST);
    expect(world.buildings).toEqual([]);
  });

  it("rejects direct new builds on the stockpile, a resource, or the builder's tile", () => {
    const stockpileWorld = createWorld(2, 1);
    stockpileWorld.stockpile.wood = HOUSE_WOOD_COST;
    const stockpileBuilder = createAgent({
      pos: { x: 1, y: 0 },
      tasks: [{ kind: "build", pos: stockpileWorld.stockpile.pos }],
    });
    stockpileWorld.agents.push(stockpileBuilder);

    const resourceWorld = createWorld(2, 1, [
      {
        pos: { x: 1, y: 0 },
        terrain: "plains",
        resource: { kind: "food", amount: 1 },
      },
    ]);
    resourceWorld.stockpile.wood = HOUSE_WOOD_COST;
    const resourceBuilder = createAgent({ tasks: [{ kind: "build", pos: { x: 1, y: 0 } }] });
    resourceWorld.agents.push(resourceBuilder);

    const occupiedWorld = createWorld(2, 1);
    occupiedWorld.stockpile.wood = HOUSE_WOOD_COST;
    const occupyingBuilder = createAgent({
      pos: { x: 1, y: 0 },
      tasks: [{ kind: "build", pos: { x: 1, y: 0 } }],
    });
    occupiedWorld.agents.push(occupyingBuilder);

    stepAgent(stockpileWorld, stockpileBuilder);
    stepAgent(resourceWorld, resourceBuilder);
    stepAgent(occupiedWorld, occupyingBuilder);

    for (const world of [stockpileWorld, resourceWorld, occupiedWorld]) {
      expect(world.stockpile.wood).toBe(HOUSE_WOOD_COST);
      expect(world.buildings).toEqual([]);
    }
  });

  it("finishes an already complete house task without creating a duplicate", () => {
    const site = { x: 1, y: 0 };
    const world = createWorld(2, 1);
    world.buildings = [{ kind: "house", pos: site, progress: HOUSE_BUILD_TICKS, complete: true }];
    const agent = createAgent({ tasks: [{ kind: "build", pos: site }] });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(agent.tasks).toEqual([]);
    expect(world.buildings).toHaveLength(1);
  });

  it("rests at the nearest reachable complete house and restores gross fatigue per tick", () => {
    const world = createWorld(5, 1);
    world.stockpile.pos = { x: 0, y: 0 };
    world.buildings = [
      { kind: "house", pos: { x: 4, y: 0 }, progress: HOUSE_BUILD_TICKS, complete: true },
      { kind: "house", pos: { x: 2, y: 0 }, progress: HOUSE_BUILD_TICKS, complete: true },
    ];
    const agent = createAgent({ fatigue: 10, tasks: [{ kind: "rest" }] });
    world.agents.push(agent);

    for (let tick = 0; tick < 2 * MOVE_TICKS_PER_TILE; tick += 1) stepAgent(world, agent);
    expect(agent.pos).toEqual({ x: 2, y: 0 });
    stepAgent(world, agent);

    expect(agent.activity).toEqual({ kind: "resting", target: { x: 2, y: 0 } });
    expect(agent.fatigue).toBeCloseTo(10 + FATIGUE_REST_RECOVERY_PER_DAY / TICKS_PER_DAY, 10);
  });

  it("falls back to the stockpile when no complete reachable house exists", () => {
    const world = createWorld(3, 1, [{ pos: { x: 1, y: 0 }, terrain: "water" }]);
    world.buildings = [
      { kind: "house", pos: { x: 2, y: 0 }, progress: HOUSE_BUILD_TICKS, complete: true },
      { kind: "house", pos: { x: 0, y: 0 }, progress: 1, complete: false },
    ];
    const agent = createAgent({ fatigue: 10, tasks: [{ kind: "rest" }] });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(agent.activity).toEqual({ kind: "resting", target: world.stockpile.pos });
    expect(agent.fatigue).toBeGreaterThan(10);
  });

  it("caps rest at full fatigue and finishes the task", () => {
    const world = createWorld(1, 1);
    const agent = createAgent({
      fatigue: FATIGUE_MAX - FATIGUE_REST_RECOVERY_PER_DAY / TICKS_PER_DAY / 2,
      tasks: [{ kind: "rest" }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(agent.fatigue).toBe(FATIGUE_MAX);
    expect(agent.tasks).toEqual([]);
    expect(agent.activity).toEqual({ kind: "idle" });
  });

  it("takes exactly twice as long to move and gather at half speed", () => {
    const moveWorld = createWorld(2, 1);
    const mover = createAgent({ tasks: [{ kind: "moveTo", dest: { x: 1, y: 0 } }] });
    moveWorld.agents.push(mover);
    for (let tick = 1; tick < 2 * MOVE_TICKS_PER_TILE; tick += 1) stepAgent(moveWorld, mover, 0.5);
    expect(mover.pos).toEqual({ x: 0, y: 0 });
    stepAgent(moveWorld, mover, 0.5);
    expect(mover.pos).toEqual({ x: 1, y: 0 });

    const target = { x: 1, y: 0 };
    const gatherWorld = createWorld(2, 1, [
      { pos: target, terrain: "forest", resource: { kind: "wood", amount: CARRY_CAPACITY } },
    ]);
    const gatherer = createAgent({ tasks: [{ kind: "gather", resource: "wood", target }] });
    gatherWorld.agents.push(gatherer);
    for (let tick = 1; tick < 2 * GATHER_TICKS; tick += 1) stepAgent(gatherWorld, gatherer, 0.5);
    expect(gatherer.carrying).toBeNull();
    stepAgent(gatherWorld, gatherer, 0.5);
    expect(gatherer.carrying).toEqual({ kind: "wood", amount: CARRY_CAPACITY });
  });

  it("does not slow eat, forage, build, or rest action progress", () => {
    const eatWorld = createWorld(1, 1);
    eatWorld.stockpile.food = FOOD_PER_MEAL;
    const eater = createAgent({ hunger: 0, tasks: [{ kind: "eat" }] });
    eatWorld.agents.push(eater);
    for (let tick = 0; tick < EAT_TICKS; tick += 1) stepAgent(eatWorld, eater, 0.5);
    expect(eater.tasks).toEqual([]);

    const forageWorld = createWorld(1, 1, [
      { pos: { x: 0, y: 0 }, terrain: "plains", resource: { kind: "food", amount: 5 } },
    ]);
    const forager = createAgent({ hunger: 0, tasks: [{ kind: "forage", target: { x: 0, y: 0 } }] });
    forageWorld.agents.push(forager);
    for (let tick = 0; tick < FORAGE_TICKS; tick += 1) stepAgent(forageWorld, forager, 0.5);
    expect(forager.tasks).toEqual([]);

    const buildWorld = createWorld(2, 1);
    buildWorld.stockpile.wood = HOUSE_WOOD_COST;
    const builder = createAgent({ tasks: [{ kind: "build", pos: { x: 1, y: 0 } }] });
    buildWorld.agents.push(builder);
    stepAgent(buildWorld, builder, 0.5);
    expect(buildWorld.buildings[0]?.progress).toBe(1);

    const restWorld = createWorld(1, 1);
    const rester = createAgent({ fatigue: 0, tasks: [{ kind: "rest" }] });
    restWorld.agents.push(rester);
    stepAgent(restWorld, rester, 0.5);
    expect(rester.fatigue).toBeCloseTo(FATIGUE_REST_RECOVERY_PER_DAY / TICKS_PER_DAY, 10);
  });
});
