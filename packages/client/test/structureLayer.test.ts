import {
  type Building,
  type CropStage,
  FACILITY_BUILD_TICKS,
  type FacilityKind,
} from "@agent-town/shared";
import { Container, Graphics, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";

import { TILE_SIZE } from "../src/render/mapLayer.js";
import { buildingSprites, objectDepth } from "../src/render/sprites.js";
import {
  CONSTRUCTION_ALPHA,
  FACILITY_OBJECT_LABEL,
  facilityProgressRatio,
  HOUSE_OBJECT_LABEL,
  renderStructureLayer,
} from "../src/render/structureLayer.js";
import { makeFacilityFixture } from "./spatialFixture.js";

const house: Building = { kind: "house", pos: { x: 0, y: 0 }, progress: 400, complete: true };
const FACILITY_KINDS = [
  "communalGranary",
  "grainMarket",
  "rationDepot",
] as const satisfies readonly FacilityKind[];

function worldWithCompleteField(stage: CropStage): Building[] {
  return [
    {
      kind: "field",
      pos: { x: 3, y: 3 },
      progress: 30,
      complete: true,
      stage,
    },
  ];
}

describe("buildingSprites", () => {
  it("gives all four buildings a distinct roof and wall pair", () => {
    const buildings: Building[] = [
      house,
      ...FACILITY_KINDS.map((kind, index) => makeFacilityFixture(kind, { x: index + 1, y: 0 })),
    ];
    const visuals = buildings.map((building) => {
      if (building.kind === "field") throw new Error("unexpected field in building sprite fixture");
      return buildingSprites(building);
    });

    expect(new Set(visuals.map(({ roof, wall }) => `${roof}|${wall}`))).toHaveLength(
      buildings.length,
    );
    expect(visuals[0]?.emblem).toBeNull();
    expect(visuals.slice(1).every(({ emblem }) => emblem !== null)).toBe(true);
  });
});

describe("renderStructureLayer", () => {
  it("renders a ripe field as soil plus a crop", () => {
    const layer = new Container();

    renderStructureLayer(layer, worldWithCompleteField("ripe"));

    expect(layer.children[0]?.children).toHaveLength(3);
  });

  it("leaves no crop behind when a field is harvested", () => {
    const layer = new Container();
    renderStructureLayer(layer, worldWithCompleteField("ripe"));

    renderStructureLayer(layer, worldWithCompleteField("fallow"));

    expect(layer.children[0]?.children).toHaveLength(2);
  });

  it("draws one marker per facility beside the houses", () => {
    const layer = new Container();
    const buildings: Building[] = [
      house,
      ...FACILITY_KINDS.map((kind, index) => makeFacilityFixture(kind, { x: index + 1, y: 0 })),
    ];

    renderStructureLayer(layer, buildings);

    expect(layer.children.filter(({ label }) => label === HOUSE_OBJECT_LABEL)).toHaveLength(1);
    expect(layer.children.filter(({ label }) => label === FACILITY_OBJECT_LABEL)).toHaveLength(
      FACILITY_KINDS.length,
    );
  });

  it("shows an unfinished site through the same construction alpha as an unfinished house", () => {
    const layer = new Container();
    const site = makeFacilityFixture("communalGranary", { x: 1, y: 0 });
    site.complete = false;
    site.progress = 10;

    renderStructureLayer(layer, [{ ...house, complete: false, progress: 10 }, site]);

    expect(layer.children).toHaveLength(2);
    expect(layer.children.every(({ children }) => children.length > 0)).toBe(true);
    expect(
      layer.children
        .flatMap(({ children }) => children)
        .every(({ alpha }) => {
          return alpha === CONSTRUCTION_ALPHA;
        }),
    ).toBe(true);
    const facility = layer.children.find(({ label }) => label === FACILITY_OBJECT_LABEL);
    expect(facility?.children.some(({ label }) => label === "facility-progress")).toBe(true);
  });

  it("clamps facility construction progress and hides it after completion", () => {
    const required = FACILITY_BUILD_TICKS.communalGranary;
    expect(facilityProgressRatio("communalGranary", 0)).toBe(0);
    expect(facilityProgressRatio("communalGranary", required / 2)).toBe(0.5);
    expect(facilityProgressRatio("communalGranary", required + 1)).toBe(1);

    const layer = new Container();
    const facility = makeFacilityFixture("communalGranary", { x: 1, y: 0 });
    facility.complete = true;
    facility.progress = required;
    renderStructureLayer(layer, [facility]);

    const rendered = layer.children.find(({ label }) => label === FACILITY_OBJECT_LABEL);
    expect(rendered?.children.some(({ label }) => label === "facility-progress")).toBe(false);
  });

  it("clears only structures it drew when the settlement is redrawn", () => {
    const layer = new Container();
    const foreign = new Graphics();
    foreign.label = "landmark-object";
    layer.addChild(foreign);

    renderStructureLayer(layer, [house, makeFacilityFixture("grainMarket", { x: 1, y: 0 })]);
    renderStructureLayer(layer, [house]);

    expect(layer.children.filter(({ label }) => label === FACILITY_OBJECT_LABEL)).toHaveLength(0);
    expect(layer.children.filter(({ label }) => label === HOUSE_OBJECT_LABEL)).toHaveLength(1);
    expect(layer.children).toContain(foreign);
    expect(foreign.destroyed).toBe(false);
  });

  it("does not leak roof or emblem children when structures are redrawn", () => {
    const layer = new Container();
    const buildings: Building[] = [house, makeFacilityFixture("communalGranary", { x: 1, y: 0 })];

    renderStructureLayer(layer, buildings);
    const firstChildCount = layer.children.reduce(
      (total, child) => total + child.children.length,
      0,
    );
    renderStructureLayer(layer, buildings);

    expect(layer.children).toHaveLength(buildings.length);
    expect(layer.children.reduce((total, child) => total + child.children.length, 0)).toBe(
      firstChildCount,
    );
  });

  it("sorts a southern roof on its own row so it occludes the row north of it", () => {
    const layer = new Container();
    const north = { ...house, pos: { x: 0, y: 0 } };
    const south = { ...house, pos: { x: 0, y: 1 } };

    renderStructureLayer(layer, [north, south]);

    const roofs = layer.children.map((building) =>
      building.children.find((child) => child instanceof Sprite && child.position.y === -TILE_SIZE),
    );
    expect(roofs[0]?.zIndex).toBe(objectDepth(north.pos.y, "house"));
    expect(roofs[1]?.zIndex).toBe(objectDepth(south.pos.y, "house"));
    expect(roofs[1]?.zIndex).toBeGreaterThan(roofs[0]?.zIndex ?? Number.POSITIVE_INFINITY);
  });
});
