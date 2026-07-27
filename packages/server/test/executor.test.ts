import {
  type AgentState,
  CARRY_CAPACITY,
  type CropStage,
  DAYS_PER_SEASON,
  EAT_TICKS,
  FACILITY_BUILD_TICKS,
  FACILITY_MAINTENANCE_PER_DAY,
  FACILITY_WOOD_COST,
  FATIGUE_MAX,
  FATIGUE_REST_RECOVERY_PER_DAY,
  type Facility,
  type FacilityKind,
  FIELD_TILL_WORK,
  FIELD_YIELD,
  type Field,
  FOOD_PER_MEAL,
  FORAGE_TICKS,
  GATHER_TICKS,
  HOUSE_BUILD_TICKS,
  HOUSE_WOOD_COST,
  HUNGER_PER_MEAL,
  isField,
  MOVE_TICKS_PER_TILE,
  type Position,
  RATION_FOOD_PER_MEAL,
  RATION_HUNGER_PER_MEAL,
  RATION_STRAIN_PER_MEAL,
  type ResourceKind,
  type Terrain,
  TICKS_PER_DAY,
  type Tile,
  TRAIL_LEVEL_WEAR,
  TRAIL_PURPOSE_WEAR,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { stepAgent } from "../src/sim/executor.js";
import { moveTicksForTrail, recordTraversal, type Traversal } from "../src/sim/traffic.js";
import { makeAgentFixture as createAgent } from "./agentFixture.js";
import { makeDemandFixture, makeFacilityFixture, makeTrailCellsFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

interface TileOverride {
  pos: { x: number; y: number };
  terrain: Terrain;
  resource?: { kind: ResourceKind; amount: number };
  resourceOrigin?: ResourceKind;
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
    spatialDemands: [],
    trailCells: makeTrailCellsFixture(width, height),
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

function worldWithAgentAt(pos: Position): WorldState {
  const world = createWorld(pos.x + 1, pos.y + 1);
  world.agents.push(createAgent({ pos }));
  return world;
}

function springTick(): number {
  return 0;
}

function summerTick(): number {
  return DAYS_PER_SEASON * TICKS_PER_DAY;
}

function autumnTick(): number {
  return 2 * DAYS_PER_SEASON * TICKS_PER_DAY;
}

function winterTick(): number {
  return 3 * DAYS_PER_SEASON * TICKS_PER_DAY;
}

function worldWithCompleteField(stage: CropStage, tick: number): WorldState {
  const world = worldWithAgentAt({ x: 3, y: 3 });
  world.tick = tick;
  world.buildings = [
    {
      kind: "field",
      pos: { x: 3, y: 3 },
      progress: FIELD_TILL_WORK,
      complete: true,
      stage,
    },
  ];
  return world;
}

function fieldOf(world: WorldState): Field {
  const field = world.buildings.find(isField);
  if (field === undefined) throw new Error("missing test field");
  return field;
}

function runFieldTask(world: WorldState, task: "sow" | "harvest", pos: Position): void {
  const agent = world.agents[0];
  if (agent === undefined) throw new Error("missing test agent");
  agent.tasks = task === "sow" ? [{ kind: "sow", pos }] : [{ kind: "harvest", pos }];
  stepAgent(world, agent);
}

function sowAt(world: WorldState, pos: Position): void {
  runFieldTask(world, "sow", pos);
}

function harvestAt(world: WorldState, pos: Position): void {
  runFieldTask(world, "harvest", pos);
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

  it("raises a field from bare ground and completes it", () => {
    const world = worldWithAgentAt({ x: 3, y: 3 });
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    agent.tasks = [{ kind: "till", pos: { x: 3, y: 3 } }];

    for (let tick = 0; tick < FIELD_TILL_WORK + 5; tick += 1) stepAgent(world, agent);

    const field = world.buildings.filter(isField)[0];
    expect(field?.complete).toBe(true);
    expect(field?.stage).toBe("fallow");
  });

  it("sows a fallow field in spring and refuses outside spring", () => {
    const spring = worldWithCompleteField("fallow", springTick());
    sowAt(spring, { x: 3, y: 3 });
    expect(fieldOf(spring).stage).toBe("sown");

    for (const tick of [summerTick(), autumnTick(), winterTick()]) {
      const outsideSpring = worldWithCompleteField("fallow", tick);
      sowAt(outsideSpring, { x: 3, y: 3 });
      expect(fieldOf(outsideSpring).stage).toBe("fallow");
    }
  });

  it("harvests a ripe field into the stockpile and leaves it fallow", () => {
    const world = worldWithCompleteField("ripe", autumnTick());
    const before = world.stockpile.food;

    harvestAt(world, { x: 3, y: 3 });

    expect(world.stockpile.food).toBe(before + FIELD_YIELD);
    expect(fieldOf(world).stage).toBe("fallow");
  });

  it("walks to a distant ripe field before harvesting it", () => {
    const world = worldWithCompleteField("ripe", autumnTick());
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    agent.pos = { x: 0, y: 3 };
    agent.tasks = [{ kind: "harvest", pos: { x: 3, y: 3 } }];
    const before = world.stockpile.food;

    for (let tick = 0; tick < 2 * MOVE_TICKS_PER_TILE + 1; tick += 1) {
      stepAgent(world, agent);
    }

    expect(world.stockpile.food).toBe(before + FIELD_YIELD);
    expect(fieldOf(world).stage).toBe("fallow");
  });

  it("walks to a distant fallow field before sowing it", () => {
    const world = worldWithCompleteField("fallow", springTick());
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    agent.pos = { x: 0, y: 3 };
    agent.tasks = [{ kind: "sow", pos: { x: 3, y: 3 } }];

    for (let tick = 0; tick < 2 * MOVE_TICKS_PER_TILE + 1; tick += 1) {
      stepAgent(world, agent);
    }

    expect(fieldOf(world).stage).toBe("sown");
  });

  it("refuses to harvest a field that is not ripe", () => {
    for (const stage of ["fallow", "sown", "growing"] as const) {
      const world = worldWithCompleteField(stage, autumnTick());
      const before = world.stockpile.food;

      harvestAt(world, { x: 3, y: 3 });

      expect(world.stockpile.food).toBe(before);
    }
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

describe("stepAgent traversal recording", () => {
  function recorder() {
    const traversals: Traversal[] = [];
    return { traversals, record: (traversal: Traversal) => traversals.push(traversal) };
  }

  it("stays silent until a tile step actually completes", () => {
    const world = createWorld(3, 1);
    const agent = createAgent({ tasks: [{ kind: "moveTo", dest: { x: 2, y: 0 } }] });
    world.agents.push(agent);
    const { traversals, record } = recorder();

    for (let tick = 0; tick < MOVE_TICKS_PER_TILE - 1; tick += 1) {
      stepAgent(world, agent, 1, record);
    }
    expect(traversals).toEqual([]);
    expect(agent.pos).toEqual({ x: 0, y: 0 });

    stepAgent(world, agent, 1, record);
    expect(traversals).toEqual([{ pos: { x: 1, y: 0 }, purpose: "wandering", facilityId: null }]);
    expect(agent.pos).toEqual({ x: 1, y: 0 });
  });

  it("records no traversal when the path is blocked", () => {
    const world = createWorld(3, 1, [{ pos: { x: 1, y: 0 }, terrain: "water" }]);
    const agent = createAgent({ tasks: [{ kind: "moveTo", dest: { x: 2, y: 0 } }] });
    world.agents.push(agent);
    const { traversals, record } = recorder();

    for (let tick = 0; tick < MOVE_TICKS_PER_TILE * 2; tick += 1) {
      stepAgent(world, agent, 1, record);
    }

    expect(traversals).toEqual([]);
  });

  it("records no traversal when the resident is already at the destination", () => {
    const world = createWorld(2, 1);
    const agent = createAgent({ tasks: [{ kind: "moveTo", dest: { x: 0, y: 0 } }] });
    world.agents.push(agent);
    const { traversals, record } = recorder();

    stepAgent(world, agent, 1, record);

    expect(traversals).toEqual([]);
    expect(agent.tasks).toEqual([]);
  });

  it.each([
    ["gather", { kind: "gather", target: { x: 2, y: 0 }, resource: "wood" }, "gathering"],
    ["build", { kind: "build", pos: { x: 2, y: 0 } }, "construction"],
    ["forage", { kind: "forage", target: { x: 2, y: 0 } }, "survival"],
  ] as const)("derives the %s purpose from the task the move serves", (_label, task, purpose) => {
    const world = createWorld(3, 1, [
      { pos: { x: 2, y: 0 }, terrain: "forest", resource: { kind: "wood", amount: 10 } },
    ]);
    world.stockpile.wood = HOUSE_WOOD_COST;
    const agent = createAgent({ tasks: [{ kind: "moveTo", dest: { x: 1, y: 0 } }, task] });
    world.agents.push(agent);
    const { traversals, record } = recorder();

    for (let tick = 0; tick < MOVE_TICKS_PER_TILE; tick += 1) stepAgent(world, agent, 1, record);

    expect(traversals).toEqual([{ pos: { x: 1, y: 0 }, purpose, facilityId: null }]);
  });

  it("wears the approach to a house but never the house tile itself", () => {
    const world = createWorld(3, 1);
    world.buildings.push({ kind: "house", pos: { x: 2, y: 0 }, progress: 1, complete: true });
    const agent = createAgent({ fatigue: 0, tasks: [{ kind: "rest" }] });
    world.agents.push(agent);

    for (let tick = 0; tick < MOVE_TICKS_PER_TILE * 2; tick += 1) {
      stepAgent(world, agent, 1, (traversal) => {
        recordTraversal(world, traversal);
      });
    }

    expect(agent.pos).toEqual({ x: 2, y: 0 });
    expect(world.trailCells[1]?.wear).toBe(TRAIL_PURPOSE_WEAR.survival);
    expect(world.trailCells[1]?.dominantPurpose).toBe("survival");
    expect(world.trailCells[2]?.wear).toBe(0);
  });

  it("crosses a worn tile faster than untrodden ground", () => {
    const world = createWorld(2, 1);
    const worn = world.trailCells[1];
    if (worn !== undefined) {
      worn.wear = TRAIL_LEVEL_WEAR.establishedTrail;
      worn.level = "establishedTrail";
    }
    const agent = createAgent({ tasks: [{ kind: "moveTo", dest: { x: 1, y: 0 } }] });
    world.agents.push(agent);

    for (let tick = 0; tick < Math.ceil(moveTicksForTrail("establishedTrail")); tick += 1) {
      stepAgent(world, agent, 1);
    }

    expect(agent.pos).toEqual({ x: 1, y: 0 });
    expect(Math.ceil(moveTicksForTrail("establishedTrail"))).toBeLessThan(MOVE_TICKS_PER_TILE);
  });

  it("carries fractional trail progress into the next tile", () => {
    const world = createWorld(3, 1);
    for (const cell of world.trailCells.slice(1)) {
      cell.wear = TRAIL_LEVEL_WEAR.trail;
      cell.level = "trail";
    }
    const agent = createAgent({ tasks: [{ kind: "moveTo", dest: { x: 2, y: 0 } }] });
    world.agents.push(agent);

    for (let tick = 0; tick < 5; tick += 1) stepAgent(world, agent, 1);

    expect(agent.pos).toEqual({ x: 2, y: 0 });
  });
});

describe("stepAgent facility actions", () => {
  function createSite(): { world: WorldState; facility: Facility } {
    const world = createWorld(4, 1);
    world.stockpile.wood = 20;
    const facility = makeFacilityFixture("communalGranary", { x: 3, y: 0 });
    world.buildings.push(facility);
    world.spatialDemands.push(makeDemandFixture("communalGranary", { x: 3, y: 0 }));
    return { world, facility };
  }

  function run(world: WorldState, agent: AgentState, ticks: number): void {
    for (let tick = 0; tick < ticks; tick += 1) stepAgent(world, agent);
  }

  it("hauls exactly one carry load from the stockpile into the site", () => {
    const { world, facility } = createSite();
    const agent = createAgent({
      pos: { x: 0, y: 0 },
      tasks: [{ kind: "transferToFacility", facilityId: facility.id, resource: "wood" }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);
    expect(agent.carrying).toEqual({ kind: "wood", amount: CARRY_CAPACITY });
    expect(world.stockpile.wood).toBe(20 - CARRY_CAPACITY);
    expect(agent.tasks).toHaveLength(1);

    run(world, agent, MOVE_TICKS_PER_TILE * 3);

    expect(agent.pos).toEqual({ x: 2, y: 0 });
    expect(facility.woodDelivered).toBe(CARRY_CAPACITY);
    expect(agent.carrying).toBeNull();
    expect(agent.tasks).toEqual([]);
    expect(world.stockpile.wood + facility.woodDelivered).toBe(20);
  });

  it("keeps the overflow it could not hand over", () => {
    const { world, facility } = createSite();
    facility.woodDelivered = FACILITY_WOOD_COST.communalGranary - 2;
    const agent = createAgent({
      pos: { x: 2, y: 0 },
      carrying: { kind: "wood", amount: CARRY_CAPACITY },
      tasks: [{ kind: "transferToFacility", facilityId: facility.id, resource: "wood" }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(facility.woodDelivered).toBe(FACILITY_WOOD_COST.communalGranary);
    expect(agent.carrying).toEqual({ kind: "wood", amount: CARRY_CAPACITY - 2 });
    expect(agent.tasks).toEqual([]);
  });

  it("drops a transfer whose facility no longer exists", () => {
    const { world } = createSite();
    const agent = createAgent({
      tasks: [{ kind: "transferToFacility", facilityId: "facility-missing", resource: "wood" }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(agent.tasks).toEqual([]);
    expect(world.stockpile.wood).toBe(20);
  });

  it("drops a transfer when the resident is carrying the wrong resource", () => {
    const { world, facility } = createSite();
    const agent = createAgent({
      pos: { x: 2, y: 0 },
      carrying: { kind: "food", amount: 3 },
      tasks: [{ kind: "transferToFacility", facilityId: facility.id, resource: "wood" }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(agent.tasks).toEqual([]);
    expect(agent.carrying).toEqual({ kind: "food", amount: 3 });
    expect(facility.woodDelivered).toBe(0);
  });

  it("drops a transfer whose facility cannot be reached", () => {
    const { world, facility } = createSite();
    world.tiles[2] = { terrain: "water", resource: null };
    const agent = createAgent({
      pos: { x: 0, y: 0 },
      carrying: { kind: "wood", amount: CARRY_CAPACITY },
      tasks: [{ kind: "transferToFacility", facilityId: facility.id, resource: "wood" }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(agent.tasks).toEqual([]);
    expect(facility.woodDelivered).toBe(0);
  });

  it("raises the frame one tick at a time once all the wood has arrived", () => {
    const { world, facility } = createSite();
    facility.woodDelivered = FACILITY_WOOD_COST.communalGranary;
    const agent = createAgent({
      pos: { x: 2, y: 0 },
      tasks: [{ kind: "buildFacility", facilityId: facility.id }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(facility.progress).toBe(1);
    expect(agent.activity).toEqual({ kind: "building", target: { x: 3, y: 0 } });
    expect(world.spatialDemands[0]?.status).toBe("building");
  });

  it("finishes the build task and activates the facility on the last tick", () => {
    const { world, facility } = createSite();
    facility.woodDelivered = FACILITY_WOOD_COST.communalGranary;
    facility.progress = FACILITY_BUILD_TICKS.communalGranary - 1;
    const agent = createAgent({
      pos: { x: 2, y: 0 },
      tasks: [{ kind: "buildFacility", facilityId: facility.id }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(facility).toMatchObject({ complete: true, operation: "active" });
    expect(agent.tasks).toEqual([]);
    expect(world.spatialDemands[0]?.status).toBe("fulfilled");
  });

  it("drops a build task while the site is still short of wood", () => {
    const { world, facility } = createSite();
    const agent = createAgent({
      pos: { x: 2, y: 0 },
      tasks: [{ kind: "buildFacility", facilityId: facility.id }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);

    expect(facility.progress).toBe(0);
    expect(agent.tasks).toEqual([]);
  });

  it("keeps a standing facility in repair", () => {
    const { world, facility } = createSite();
    facility.complete = true;
    facility.maintenanceDue = 2;
    const agent = createAgent({
      pos: { x: 2, y: 0 },
      tasks: [{ kind: "maintainFacility", facilityId: facility.id }],
    });
    world.agents.push(agent);

    stepAgent(world, agent);
    expect(facility.maintenanceDue).toBe(1);
    expect(agent.activity).toEqual({ kind: "maintaining", facilityId: facility.id });

    stepAgent(world, agent);
    stepAgent(world, agent);
    expect(facility.maintenanceDue).toBe(0);
    expect(agent.tasks).toEqual([]);
  });

  it("wears the ground on the way to a facility as facility service", () => {
    const { world, facility } = createSite();
    const agent = createAgent({
      pos: { x: 0, y: 0 },
      carrying: { kind: "wood", amount: CARRY_CAPACITY },
      tasks: [{ kind: "transferToFacility", facilityId: facility.id, resource: "wood" }],
    });
    world.agents.push(agent);

    for (let tick = 0; tick < MOVE_TICKS_PER_TILE * 2; tick += 1) {
      stepAgent(world, agent, 1, (traversal) => {
        recordTraversal(world, traversal);
      });
    }

    expect(world.trailCells[1]?.dominantPurpose).toBe("facilityService");
    expect(world.trailCells[1]?.causedByFacilityIds).toEqual([facility.id]);
  });
});

describe("stepAgent meal routing", () => {
  /** A finished, working store the resident has to walk to. */
  function addStore(world: WorldState, kind: FacilityKind, x: number, food: number): Facility {
    const facility = makeFacilityFixture(kind, { x, y: 0 });
    facility.complete = true;
    facility.operation = "active";
    facility.inventory.food = food;
    world.buildings.push(facility);
    return facility;
  }

  function eatUntilDone(world: WorldState, agent: AgentState): void {
    for (let tick = 0; tick < 200 && agent.tasks.length > 0; tick += 1) {
      stepAgent(world, agent, 1);
    }
  }

  it("walks to the ration depot while the settlement is short", () => {
    const world = createWorld(8, 1);
    world.stockpile.food = 5;
    const depot = addStore(world, "rationDepot", 5, 10);
    const agent = createAgent({ hunger: 10, tasks: [{ kind: "eat" }] });
    world.agents.push(agent);

    eatUntilDone(world, agent);

    expect(agent.pos).toEqual({ x: 4, y: 0 });
    expect(depot.inventory.food).toBe(10 - RATION_FOOD_PER_MEAL);
    expect(agent.hunger).toBe(10 + RATION_HUNGER_PER_MEAL);
    expect(agent.rationStrain).toBeCloseTo(RATION_STRAIN_PER_MEAL);
    expect(world.stockpile.food).toBe(5);
  });

  it("opens the granary when the stockpile is empty and the reserve may be released", () => {
    const world = createWorld(8, 1);
    const granary = addStore(world, "communalGranary", 5, 100);
    const agent = createAgent({ hunger: 10, tasks: [{ kind: "eat" }] });
    world.agents.push(agent);

    eatUntilDone(world, agent);

    expect(agent.pos).toEqual({ x: 4, y: 0 });
    expect(granary.inventory.food).toBe(100 - FOOD_PER_MEAL);
    expect(agent.hunger).toBe(10 + HUNGER_PER_MEAL);
    expect(granary.statsToday.visits).toBe(1);
  });

  it("attributes travel to a selected food facility", () => {
    const world = createWorld(8, 1);
    const granary = addStore(world, "communalGranary", 5, 100);
    const agent = createAgent({ hunger: 10, tasks: [{ kind: "eat" }] });
    const traversals: Traversal[] = [];
    world.agents.push(agent);

    for (let tick = 0; tick < MOVE_TICKS_PER_TILE; tick += 1) {
      stepAgent(world, agent, 1, (traversal) => traversals.push(traversal));
    }

    expect(traversals[0]).toMatchObject({
      purpose: "survival",
      facilityId: granary.id,
    });
  });

  it("eats from the stockpile while the reserve stays shut", () => {
    const world = createWorld(8, 1);
    world.stockpile.food = 40;
    const granary = addStore(world, "communalGranary", 5, 100);
    const agent = createAgent({ pos: { x: 4, y: 0 }, hunger: 10, tasks: [{ kind: "eat" }] });
    world.agents.push(agent);

    eatUntilDone(world, agent);

    expect(agent.pos).toEqual({ x: 1, y: 0 });
    expect(world.stockpile.food).toBe(40 - FOOD_PER_MEAL);
    expect(granary.inventory.food).toBe(100);
  });

  it("passes over a nearer blocked store for a reachable one", () => {
    const world = createWorld(8, 1);
    world.stockpile.food = 40;
    const depot = addStore(world, "rationDepot", 5, 40);
    depot.maintenanceDue = FACILITY_MAINTENANCE_PER_DAY.rationDepot + 1;
    const agent = createAgent({ pos: { x: 4, y: 0 }, hunger: 10, tasks: [{ kind: "eat" }] });
    world.agents.push(agent);

    eatUntilDone(world, agent);

    expect(depot.inventory.food).toBe(40);
    expect(world.stockpile.food).toBe(40 - FOOD_PER_MEAL);
    expect(agent.hunger).toBe(10 + HUNGER_PER_MEAL);
  });

  it("replans movement when the selected food store changes", () => {
    const world = createWorld(8, 1);
    world.stockpile.food = FOOD_PER_MEAL;
    const depot = addStore(world, "rationDepot", 7, RATION_FOOD_PER_MEAL);
    const agent = createAgent({ pos: { x: 3, y: 0 }, hunger: 10, tasks: [{ kind: "eat" }] });
    world.agents.push(agent);

    for (let tick = 0; tick < MOVE_TICKS_PER_TILE; tick += 1) stepAgent(world, agent, 1);
    expect(agent.pos).toEqual({ x: 4, y: 0 });
    depot.inventory.food = 0;
    eatUntilDone(world, agent);

    expect(agent.pos).toEqual({ x: 1, y: 0 });
    expect(world.stockpile.food).toBe(0);
    expect(agent.hunger).toBe(10 + HUNGER_PER_MEAL);
  });

  it("drops the meal when no store holds one", () => {
    const world = createWorld(4, 1);
    world.stockpile.food = FOOD_PER_MEAL - 1;
    const agent = createAgent({ hunger: 10, tasks: [{ kind: "eat" }] });
    world.agents.push(agent);

    stepAgent(world, agent, 1);

    expect(agent.tasks).toEqual([]);
    expect(agent.hunger).toBe(10);
  });
});
