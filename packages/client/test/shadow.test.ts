import type { AgentState, Building, WorldState } from "@agent-town/shared";
import { Container, Graphics, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";

import { renderAgentLayer } from "../src/render/agentLayer.js";
import { renderMapLayer } from "../src/render/mapLayer.js";
import { shadowGraphic } from "../src/render/shadow.js";
import { objectDepth } from "../src/render/sprites.js";
import { renderStructureLayer } from "../src/render/structureLayer.js";
import { makeTrailCellsFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

function makeAgent(): AgentState {
  return {
    id: "resident-1",
    name: "Ada",
    pos: { x: 1, y: 1 },
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
    rationStrain: 0,
    lastRationTick: null,
  };
}

function makeTreeWorld(): WorldState {
  return {
    tick: 0,
    width: 1,
    height: 1,
    tiles: [{ terrain: "forest", resource: { kind: "wood", amount: 1 } }],
    agents: [],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    spatialDemands: [],
    trailCells: makeTrailCellsFixture(1, 1),
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

describe("shadowGraphic", () => {
  it("draws one soft ellipse that cannot become a hit target", () => {
    const shadow = shadowGraphic(0.75);
    const fillInstructions = shadow.context.instructions.filter(
      (instruction) => instruction.action === "fill",
    );
    const fill = fillInstructions[0];

    expect(fillInstructions).toHaveLength(1);
    expect(fill?.data.style.alpha).toBeGreaterThan(0);
    expect(fill?.data.style.alpha).toBeLessThan(0.3);
    expect(shadow.eventMode).toBe("none");
  });

  it("keeps a resident shadow inside the resident container lifecycle", () => {
    const layer = new Container();

    renderAgentLayer(layer, [makeAgent()], new Map(), {
      selectedAgentId: null,
      hoveredAgentId: null,
    });

    const resident = layer.children[0];
    const shadow = resident?.children[0];
    expect(shadow).toBeInstanceOf(Graphics);
    expect(shadow?.eventMode).toBe("none");

    renderAgentLayer(layer, [], new Map(), {
      selectedAgentId: null,
      hoveredAgentId: null,
    });
    expect(shadow?.destroyed).toBe(true);
  });

  it("keeps a building shadow inside the building container lifecycle", () => {
    const layer = new Container();
    const house: Building = {
      kind: "house",
      pos: { x: 1, y: 1 },
      progress: 400,
      complete: true,
    };

    renderStructureLayer(layer, [house]);

    const building = layer.children[0];
    const shadow = building?.children[0];
    expect(shadow).toBeInstanceOf(Graphics);
    expect(shadow?.eventMode).toBe("none");

    renderStructureLayer(layer, []);
    expect(shadow?.destroyed).toBe(true);
  });

  it("sorts a containerless tree shadow less than one depth step below its tree", () => {
    const groundLayer = new Container();
    const objectLayer = new Container();
    const world = makeTreeWorld();

    renderMapLayer(groundLayer, objectLayer, world);

    const shadow = objectLayer.children.find((child) => child instanceof Graphics);
    const tree = objectLayer.children.find(
      (child) => child instanceof Sprite && child.zIndex === objectDepth(0, "resource"),
    );
    expect(shadow).toBeInstanceOf(Graphics);
    expect(tree).toBeInstanceOf(Sprite);
    expect(shadow?.zIndex).toBeLessThan(tree?.zIndex ?? Number.NEGATIVE_INFINITY);
    expect((tree?.zIndex ?? 0) - (shadow?.zIndex ?? 0)).toBeLessThan(1);

    renderMapLayer(groundLayer, objectLayer, {
      ...world,
      tiles: [{ terrain: "forest", resource: null }],
    });
    expect(shadow?.destroyed).toBe(true);
  });
});
