import { type Building, FACILITY_BUILD_TICKS, type FacilityKind } from "@agent-town/shared";
import { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";

import { FACILITY_COLORS } from "../src/render/colors.js";
import {
  CONSTRUCTION_ALPHA,
  FACILITY_OBJECT_LABEL,
  facilityProgressRatio,
  facilityVisual,
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

describe("facilityVisual", () => {
  it("gives each institution its own body, roof, and emblem", () => {
    expect(facilityVisual("communalGranary")).toEqual({
      bodyColor: FACILITY_COLORS.communalGranary,
      roofColor: 0x5f4626,
      emblem: "grain",
    });
    expect(facilityVisual("grainMarket")).toEqual({
      bodyColor: FACILITY_COLORS.grainMarket,
      roofColor: 0x7a3527,
      emblem: "awning",
    });
    expect(facilityVisual("rationDepot")).toEqual({
      bodyColor: FACILITY_COLORS.rationDepot,
      roofColor: 0x3d4a50,
      emblem: "scales",
    });
  });

  it("never repeats a body colour or an emblem across the three institutions", () => {
    const visuals = FACILITY_KINDS.map(facilityVisual);

    expect(new Set(visuals.map(({ bodyColor }) => bodyColor)).size).toBe(FACILITY_KINDS.length);
    expect(new Set(visuals.map(({ emblem }) => emblem)).size).toBe(FACILITY_KINDS.length);
  });
});

describe("renderStructureLayer", () => {
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

    expect(layer.children.map(({ alpha }) => alpha)).toEqual([
      CONSTRUCTION_ALPHA,
      CONSTRUCTION_ALPHA,
    ]);
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
});
