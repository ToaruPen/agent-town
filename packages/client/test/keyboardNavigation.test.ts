import { TICKS_PER_DAY, type WorldState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  keyboardActivationAction,
  moveTileCursor,
  resolveKeyboardTarget,
} from "../src/ui/keyboardNavigation.js";
import type { DeathEvent } from "../src/ui/survivalViewModel.js";

function makeWorld(): WorldState {
  return {
    tick: 0,
    width: 2,
    height: 2,
    tiles: [
      { terrain: "plains", resource: { kind: "food", amount: 4 }, resourceOrigin: "food" },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
      { terrain: "plains", resource: null },
    ],
    agents: [
      {
        id: "ash",
        name: "Ash",
        pos: { x: 0, y: 0 },
        carrying: null,
        activity: { kind: "idle" },
        tasks: [],
        planSource: "llm",
        thinking: false,
        lastThought: null,
        hunger: 100,
        fatigue: 100,
        health: 100,
      },
    ],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [{ kind: "house", pos: { x: 0, y: 0 }, progress: 0, complete: false }],
    deaths: [],
  };
}

const death: DeathEvent = {
  id: "death",
  name: "Birch",
  pos: { x: 0, y: 0 },
  cause: "starvation",
  deathTick: TICKS_PER_DAY,
  expiresAtTick: TICKS_PER_DAY * 2,
  text: "Birch starved",
};

describe("moveTileCursor", () => {
  it("moves with arrow keys and clamps to world bounds", () => {
    expect(moveTileCursor({ x: 0, y: 0 }, "ArrowLeft", 2, 2)).toEqual({ x: 0, y: 0 });
    expect(moveTileCursor({ x: 0, y: 0 }, "ArrowUp", 2, 2)).toEqual({ x: 0, y: 0 });
    expect(moveTileCursor({ x: 0, y: 0 }, "ArrowRight", 2, 2)).toEqual({ x: 1, y: 0 });
    expect(moveTileCursor({ x: 1, y: 0 }, "ArrowDown", 2, 2)).toEqual({ x: 1, y: 1 });
    expect(moveTileCursor({ x: 1, y: 1 }, "ArrowDown", 2, 2)).toEqual({ x: 1, y: 1 });
  });
});

describe("resolveKeyboardTarget", () => {
  it("reaches every object kind through the same hit-priority contract", () => {
    const world = makeWorld();
    const cursor = { x: 0, y: 0 };

    expect(resolveKeyboardTarget(world, [death], new Map(), cursor)?.kind).toBe("agent");
    world.agents = [];
    expect(resolveKeyboardTarget(world, [death], new Map(), cursor)?.kind).toBe("tombstone");
    expect(resolveKeyboardTarget(world, [], new Map(), cursor)?.kind).toBe("house");
    world.buildings = [];
    expect(resolveKeyboardTarget(world, [], new Map(), cursor)?.kind).toBe("stockpile");
    world.stockpile.pos = { x: 1, y: 1 };
    expect(resolveKeyboardTarget(world, [], new Map(), cursor)?.kind).toBe("resource");
    world.tiles[0] = { terrain: "plains", resource: null };
    expect(resolveKeyboardTarget(world, [], new Map(), cursor)?.kind).toBe("terrain");
  });

  it("opens the full panel only when the active agent is activated again", () => {
    const agent = { kind: "agent", agentId: "ash" } as const;

    expect(keyboardActivationAction(null, agent)).toBe("show-bubble");
    expect(keyboardActivationAction(agent, agent)).toBe("open-agent");
    expect(keyboardActivationAction({ kind: "terrain", tileIndex: 0 }, agent)).toBe("show-bubble");
  });
});
