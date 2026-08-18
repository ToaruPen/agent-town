// @vitest-environment happy-dom

import {
  type ActiveDirective,
  NATION_TICKS_PER_SEASON,
  type NationCityState,
  type NationState,
  type Polity,
  type Position,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_WIDTH,
  type WorldCity,
  type WorldMap,
} from "@agent-town/shared";
import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

import type { CitySceneInput } from "../src/local/cityScene.js";
import {
  type CityViewApp,
  type CityViewPanelInput,
  createCityViewPanel,
} from "../src/local/cityViewPanel.js";
import { DIRECTIVE_OBJECT_LABEL } from "../src/render/directiveLayer.js";
import { HOUSE_OBJECT_LABEL } from "../src/render/structureLayer.js";

function makeWorldMap(): WorldMap {
  return {
    width: WORLD_MAP_WIDTH,
    height: WORLD_MAP_HEIGHT,
    cells: Array.from({ length: WORLD_MAP_WIDTH * WORLD_MAP_HEIGHT }, () => ({
      terrain: "plains" as const,
      polityId: "polity-1",
    })),
    cities: [],
    tradeRoutes: [],
    borderChanges: [],
    settlementFrontierPos: { x: 1, y: 1 },
  };
}

function makeCity(pos: Position, isCapital = true): WorldCity {
  return {
    id: "city-polity-1-1",
    name: "石帯府",
    pos,
    polityId: "polity-1",
    isCapital,
    foundedByEventId: "event-1",
  };
}

function makePolity(overrides: Partial<Polity> = {}): Polity {
  return {
    id: "polity-1",
    name: "石帯連合",
    adjective: "石帯の",
    color: 0x6f9f91,
    values: [],
    foundingMyth: "石を数えた者たちの盟約。",
    formativeTraumaEventIds: [],
    taboo: "森を焼くこと",
    ambition: "石の道を伸ばすこと",
    governance: "長老評議",
    ...overrides,
  };
}

function makeNation(
  cityState: NationCityState,
  activeDirectives: ActiveDirective[] = [],
): NationState {
  return {
    id: "polity-1",
    controller: "player",
    autoPilot: false,
    stocks: { food: 600, materials: 400, wealth: 300 },
    cities: [cityState],
    territoryCellCount: 180,
    population: 9000,
    stability: 62,
    culture: 40,
    foodProduction: 220,
    materialProduction: 140,
    activeDirectives,
    prosperity: {
      population: 0.4,
      production: 0.5,
      wealth: 0.3,
      stability: 0.62,
      culture: 0.2,
      total: 412,
    },
    lastReport: null,
  };
}

interface InputOptions {
  tick: number;
  population: number;
  developmentLevel: number;
  bannerColor: string;
  activeDirectives: ActiveDirective[];
  isCapital: boolean;
}

const DEFAULT_INPUT: InputOptions = {
  tick: 0,
  population: 4000,
  developmentLevel: 3,
  bannerColor: "#a1b2c3",
  activeDirectives: [],
  isCapital: true,
};

function makeInput(overrides: Partial<InputOptions> = {}): CityViewPanelInput {
  const options: InputOptions = { ...DEFAULT_INPUT, ...overrides };
  const cityState: NationCityState = {
    cityId: "city-polity-1-1",
    population: options.population,
    developmentLevel: options.developmentLevel,
  };
  const scene: CitySceneInput = {
    city: makeCity({ x: 40, y: 30 }, options.isCapital),
    cityState,
    nation: makeNation(cityState, options.activeDirectives),
    polity: makePolity(),
    worldMap: makeWorldMap(),
    tick: options.tick,
  };
  return { scene, bannerColor: options.bannerColor };
}

function makeApp(): CityViewApp {
  return { stage: new Container(), canvas: document.createElement("canvas"), resize: vi.fn() };
}

/** Depth-first search by label, so the test does not depend on the exact `addChild` order. */
function findByLabel(root: Container, label: string): Container | null {
  for (const child of root.children) {
    if (child.label === label) return child as Container;
    if (child instanceof Container) {
      const found = findByLabel(child, label);
      if (found !== null) return found;
    }
  }
  return null;
}

function groundLayerOf(app: CityViewApp): Container {
  const layer = findByLabel(app.stage as Container, "city-view-ground");
  if (layer === null) throw new Error("no mounted ground layer");
  return layer;
}

function objectLayerOf(app: CityViewApp): Container {
  const layer = findByLabel(app.stage as Container, "city-view-object");
  if (layer === null) throw new Error("no mounted object layer");
  return layer;
}

function houseCount(app: CityViewApp): number {
  return objectLayerOf(app).children.filter((child) => child.label === HOUSE_OBJECT_LABEL).length;
}

function directiveObjectCount(app: CityViewApp): number {
  return objectLayerOf(app).children.filter((child) => child.label === DIRECTIVE_OBJECT_LABEL)
    .length;
}

function makeDirective(overrides: Partial<ActiveDirective> = {}): ActiveDirective {
  return {
    id: "directive-1",
    kind: "openMine",
    targetCityId: null,
    issuedAtTick: 0,
    seasonsRemaining: 1,
    totalSeasons: 3,
    ...overrides,
  };
}

/** happy-dom provides no global `ResizeObserver`, so `mountScene`'s `typeof ResizeObserver !==
 *  "undefined"` guard takes the no-observer branch in every other test in this file — a real, valid
 *  path in its own right, and left alone elsewhere on purpose. This stub exercises the other branch
 *  specifically, so `teardown()` calling `disconnect()` on the observer it created is actually proven
 *  rather than merely never falsified by an environment that never builds one. */
function stubResizeObserver(): { disconnect: ReturnType<typeof vi.fn>; restore(): void } {
  const disconnect = vi.fn();
  class FakeResizeObserver {
    disconnect = disconnect;
    observe = vi.fn();
    unobserve = vi.fn();
  }
  const globals = globalThis as { ResizeObserver?: unknown };
  const original = globals.ResizeObserver;
  globals.ResizeObserver = FakeResizeObserver;
  return {
    disconnect,
    restore(): void {
      globals.ResizeObserver = original;
    },
  };
}

describe("createCityViewPanel", () => {
  it("mounts nothing and hides its host before the first open", () => {
    const app = makeApp();
    const host = document.createElement("div");

    createCityViewPanel(host, app);

    expect(app.stage.children.length).toBe(0);
    expect(host.hidden).toBe(true);
  });

  it("open mounts one subtree under the app's stage and shows the host", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);

    panel.open(makeInput());

    expect(app.stage.children.length).toBe(1);
    expect(host.hidden).toBe(false);
    expect(panel.isOpen()).toBe(true);
  });

  it("close destroys the mounted subtree — containers, listeners and the resize observer — across repeated cycles", () => {
    const observer = stubResizeObserver();
    try {
      const app = makeApp();
      const host = document.createElement("div");
      const panel = createCityViewPanel(host, app);

      panel.open(makeInput());
      const firstRoot = app.stage.children[0];
      if (firstRoot === undefined) throw new Error("nothing mounted");
      // The plan names "no orphaned containers or listeners": `createWorldViewport` attaches its
      // pointer/wheel handlers to this exact container (`cityViewPanel.ts`'s own comment on why
      // `Container.destroy` reclaims them). Asserting a nonzero count first is what makes the
      // post-close zero below proof of removal, rather than proof there was never anything to remove.
      expect(firstRoot.eventNames().length).toBeGreaterThan(0);
      panel.close();

      expect(app.stage.children.length).toBe(0);
      expect(firstRoot.destroyed).toBe(true);
      expect(firstRoot.eventNames()).toHaveLength(0);
      expect(host.hidden).toBe(true);
      expect(panel.isOpen()).toBe(false);
      expect(observer.disconnect).toHaveBeenCalledTimes(1);

      // A second cycle would reveal an orphan left behind by the first — one pass alone cannot.
      panel.open(makeInput());
      const secondRoot = app.stage.children[0];
      if (secondRoot === undefined) throw new Error("nothing mounted");
      expect(app.stage.children.length).toBe(1);
      expect(secondRoot.eventNames().length).toBeGreaterThan(0);
      panel.close();

      expect(app.stage.children.length).toBe(0);
      expect(secondRoot.destroyed).toBe(true);
      expect(secondRoot.eventNames()).toHaveLength(0);
      expect(observer.disconnect).toHaveBeenCalledTimes(2);
    } finally {
      observer.restore();
    }
  });

  it("closes the previous city before mounting a new one when opened again directly", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const onClose = vi.fn();
    const panel = createCityViewPanel(host, app, { onClose });

    panel.open(makeInput());
    const firstRoot = app.stage.children[0];
    if (firstRoot === undefined) throw new Error("nothing mounted");

    panel.open(makeInput()); // no explicit close() in between

    expect(firstRoot.destroyed).toBe(true);
    expect(app.stage.children.length).toBe(1);
    expect(app.stage.children[0]).not.toBe(firstRoot);
    expect(panel.isOpen()).toBe(true);
    // Switching cities never leaves the local view, so this must not fire the world-view locate pulse.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resizes the app after unhiding the host, so a host that was measured while hidden is not stuck at 0x0", () => {
    // Pixi's `resizeTo` re-measures on its own setter and on `window.resize` — nothing re-triggers it
    // when an element merely toggles `hidden`. Without an explicit `app.resize()` here, a host that was
    // last measured while `display: none` (e.g. the browser was resized while the panel was closed)
    // would stay pinned at 0x0 forever, since `open()` unhiding it does not itself fire either trigger.
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);

    panel.open(makeInput());

    expect(app.resize).toHaveBeenCalledTimes(1);
  });

  it("does nothing when closed without ever having been opened", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);

    expect(() => panel.close()).not.toThrow();
    expect(app.stage.children.length).toBe(0);
  });

  it("rebuilds the ground layer on open, but not again on an intra-season update", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);

    panel.open(makeInput({ tick: 0 }));
    const openedGround = groundLayerOf(app).children[0];

    // Same season ("spring" at nation tick 0..299), population unchanged.
    panel.update(makeInput({ tick: 150 }));

    expect(groundLayerOf(app).children[0]).toBe(openedGround);
  });

  it("rebuilds the ground layer when the season name changes", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);

    panel.open(makeInput({ tick: 0 })); // spring
    const openedGround = groundLayerOf(app).children[0];

    panel.update(makeInput({ tick: NATION_TICKS_PER_SEASON })); // summer

    expect(groundLayerOf(app).children[0]).not.toBe(openedGround);
  });

  it("redraws structures on every update, even without a season change", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);

    panel.open(makeInput({ tick: 0, population: 100, developmentLevel: 1 }));
    const openedHouses = houseCount(app);

    // Same season as open(), but more population/development to draw.
    panel.update(makeInput({ tick: 150, population: 6000, developmentLevel: 6 }));

    expect(houseCount(app)).toBeGreaterThan(openedHouses);
  });

  it("takes its chrome colour from the given banner colour, not from the scene's Polity.color", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);
    const input = makeInput({ bannerColor: "#123456" });

    panel.open(input);

    expect(host.style.getPropertyValue("--banner-color")).toBe("#123456");
    expect(host.style.getPropertyValue("--banner-color")).not.toBe(
      `#${input.scene.polity.color.toString(16).padStart(6, "0")}`,
    );
  });

  it("draws no directive mark when nothing is active", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);

    panel.open(makeInput());

    expect(directiveObjectCount(app)).toBe(0);
  });

  it("draws the mine head on open when openMine is active for this city", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);

    panel.open(makeInput({ activeDirectives: [makeDirective({ kind: "openMine" })] }));

    expect(directiveObjectCount(app)).toBeGreaterThan(0);
  });

  it("clears the directive mark on the update after the directive completes", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);

    panel.open(makeInput({ activeDirectives: [makeDirective({ kind: "holdFestival" })] }));
    expect(directiveObjectCount(app)).toBeGreaterThan(0);

    panel.update(makeInput({ tick: 150, activeDirectives: [] }));

    expect(directiveObjectCount(app)).toBe(0);
  });

  /**
   * Review finding: `activeDirectivesForCity` no longer special-cases which `DirectiveKind` gets
   * matched by kind vs by city; a null `targetCityId` (`openMine` here, nation-wide on the wire) now
   * shows only on the capital. This is the end-to-end proof that the wiring through `paintScene`
   * actually withholds the mark for a city that is not the capital, not just the pure function.
   */
  it("draws no directive mark on a city that is not the capital, even with a nation-wide directive active", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const panel = createCityViewPanel(host, app);

    panel.open(
      makeInput({ isCapital: false, activeDirectives: [makeDirective({ kind: "openMine" })] }),
    );

    expect(directiveObjectCount(app)).toBe(0);
  });

  it("fires onClose exactly once per close, and not for a close on an already-closed panel", () => {
    const app = makeApp();
    const host = document.createElement("div");
    const onClose = vi.fn();
    const panel = createCityViewPanel(host, app, { onClose });

    panel.open(makeInput());
    expect(onClose).not.toHaveBeenCalled();

    panel.close();
    expect(onClose).toHaveBeenCalledTimes(1);

    panel.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
