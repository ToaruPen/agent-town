import { MAP_HEIGHT, MAP_WIDTH, seasonOfTick, type WorldState } from "@agent-town/shared";
import type { Application, Container as PixiContainer } from "pixi.js";
import { Container } from "pixi.js";

import { renderDirectiveLayer } from "../render/directiveLayer.js";
import { renderMapLayer, TILE_SIZE } from "../render/mapLayer.js";
import { renderStructureLayer } from "../render/structureLayer.js";
import { renderTrailLayer } from "../render/trailLayer.js";
import { createWorldViewport } from "../render/worldViewport.js";
import {
  activeDirectiveKinds,
  type CitySceneInput,
  directiveAnchorPositions,
  synthesizeCityScene,
} from "./cityScene.js";

/** `bannerColor` on the wire is the CSS hex string `hexColor()` (`worldMapView.ts`) produces for
 *  `host.style`; the directive layer draws with Pixi's own numeric colours, so this is that
 *  conversion's inverse rather than a second source of the colour. */
function numericColor(cssHex: string): number {
  return Number.parseInt(cssHex.slice(1), 16);
}

/** The slice of `Application` the panel actually touches — narrow on purpose. `createWorldViewport`
 *  only ever reaches `stage`, so a test can hand this a bare `Container` and never pay for `app.init()`
 *  or a WebGL context, and the panel itself never risks constructing a second `Application`. `resize` is
 *  included because the panel's own host toggles `hidden` — see `open()`'s comment for why nothing else
 *  re-measures the renderer when that happens. */
export type CityViewApp = Pick<Application, "stage" | "canvas" | "resize">;

export interface CityViewPanelInput {
  scene: CitySceneInput;
  /** The nation's derived banner colour (C1-1) — see `cityViewTarget.ts` for why not `Polity.color`. */
  bannerColor: string;
}

export interface CityViewPanelOptions {
  /**
   * Fired right after `close()` tears the mounted scene down. visual.md §2.6's automatic locate pulse
   * fires "on entering the world view from the local view" — in this docked layout both surfaces are
   * always on screen at once, so closing the city view *is* that transition; there is no other moment
   * it could mean. The panel stays ignorant of the map itself: the caller supplies what "entering the
   * world view" should do.
   */
  onClose?: () => void;
}

export interface CityViewPanelController {
  /** Mounts the scene fresh under the app's stage and shows the host. If something is already open
   *  (switching target cities), it is closed first — opening is always a cut to a specific city, never
   *  a merge into whatever was already on screen. */
  open(input: CityViewPanelInput): void;
  /** Repaints an already-open panel. A no-op while closed: `update` never implicitly opens. */
  update(input: CityViewPanelInput): void;
  /** Tears the mounted scene down and hides the host. A no-op while already closed. */
  close(): void;
  /** Matches the `isOpen()` every other panel controller in this codebase exposes (directivePanel,
   *  worldChronicle, seasonReportPanel). `cityViewSync.ts` tracks target identity itself rather than
   *  calling this, so today it is exercised by tests only — kept for the shape, not dead by oversight. */
  isOpen(): boolean;
}

const CANVAS_CLASS = "city-view__canvas";
const CLOSE_BUTTON_CLASS = "city-view__close";
const CLOSE_BUTTON_LABEL = "都市の眺めを閉じる";

/** `viewport` and `world` are not kept here: nothing after `mountScene` calls back into either —
 *  the resize observer closes over `viewport` directly, and `world` only existed to parent the three
 *  layers below and to hand to `createWorldViewport` — so storing them would just be dead weight.
 *  `viewportStage` is kept because `close()` needs it, to detach and destroy the whole mounted subtree
 *  in one call. */
interface MountedScene {
  viewportStage: PixiContainer;
  groundLayer: PixiContainer;
  trailLayer: PixiContainer;
  objectLayer: PixiContainer;
  resizeObserver: ResizeObserver | null;
  /** Fingerprint of the last ground/trail rebuild, so a same-key `update` can skip it. */
  redrawKey: string;
}

/**
 * Ground and trails are gated on this; structures are not. `renderMapLayer` tears down and rebuilds one
 * sprite per tile (3072 of them) plus every resource and the stockpile, and `renderTrailLayer`'s cost
 * scales with house count via `isVisibleGround` scanning every building — both expensive enough that a
 * teardown on every `update` (as often as once a second) would matter. `renderStructureLayer` clears
 * only its own label group and is cheap regardless, so it simply redraws every call.
 *
 * Keyed off the *synthesized scene*'s own season and building count — the values `renderMapLayer` and
 * the plot layout actually read (`seasonOfTick(scene.tick)`, `scene.buildings.length`) — rather than
 * recomputed independently from the input tick, so the gate cannot drift from what it gates. Building
 * count stands in for "did the plot layout change": `clearFootprint` levels ground under every plot, and
 * plot positions are a deterministic function of the drawn house count for a fixed city (`cityScene.ts`),
 * so two scenes with equal season and count share the same cleared footprint. In this milestone that
 * count only ever changes at a season boundary (directives resolve there), which always changes the
 * season name too — but keying on the count directly means the gate holds even if that cadence changes,
 * rather than depending on it silently.
 */
function redrawKeyOf(scene: WorldState): string {
  return `${seasonOfTick(scene.tick)}:${scene.buildings.length}`;
}

function mountScene(app: CityViewApp, host: HTMLElement): MountedScene {
  const viewportStage = new Container();
  const world = new Container();
  const groundLayer = new Container();
  const trailLayer = new Container();
  const objectLayer = new Container();
  viewportStage.label = "city-view-stage";
  world.label = "city-view-world";
  groundLayer.label = "city-view-ground";
  trailLayer.label = "city-view-trail";
  objectLayer.label = "city-view-object";

  // Copied from `main.ts`'s container topology, not invented: `renderMapLayer`, `renderTrailLayer` and
  // `renderStructureLayer` all write into containers that live in one flat set, and each clears only its
  // own labelled children, so correct front-to-back ordering depends on this `zIndex` set living outside
  // every render function rather than on call order.
  world.sortableChildren = true;
  objectLayer.sortableChildren = true;
  groundLayer.zIndex = 0;
  trailLayer.zIndex = 1;
  objectLayer.zIndex = 2;
  trailLayer.eventMode = "none";
  world.addChild(groundLayer, trailLayer, objectLayer);
  viewportStage.addChild(world);
  app.stage.addChild(viewportStage);

  const worldWidth = MAP_WIDTH * TILE_SIZE;
  const worldHeight = MAP_HEIGHT * TILE_SIZE;
  // `host.clientWidth/Height` rather than `app.canvas.width/height`: the canvas's own pixel size tracks
  // Pixi's `resizeTo` on its own schedule, which may not have caught up yet the moment the host becomes
  // visible (it starts hidden, and `resizeTo` cannot measure a `display: none` element). Falling back to
  // the world's native size keeps the first frame sane — 1:1 — rather than a zero-size fit.
  const viewport = createWorldViewport(
    viewportStage,
    world,
    worldWidth,
    worldHeight,
    host.clientWidth || worldWidth,
    host.clientHeight || worldHeight,
  );
  viewport.fit(worldWidth, worldHeight);

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      // `resizeTo` (see `open()`'s comment) never fires on its own here — this observer is the render
      // target's only chance to track the host's real size while the panel stays open.
      app.resize();
      viewport.resize(host.clientWidth, host.clientHeight);
      viewport.fit(worldWidth, worldHeight);
    });
    resizeObserver.observe(host);
  }

  return {
    viewportStage,
    groundLayer,
    trailLayer,
    objectLayer,
    resizeObserver,
    redrawKey: "",
  };
}

function paintScene(input: CityViewPanelInput, mounted: MountedScene): void {
  const scene = synthesizeCityScene(input.scene);
  const key = redrawKeyOf(scene);
  if (key !== mounted.redrawKey) {
    renderMapLayer(mounted.groundLayer, mounted.objectLayer, scene);
    renderTrailLayer(mounted.trailLayer, scene);
    mounted.redrawKey = key;
  }
  // Cheap regardless of the gate above — see `redrawKeyOf`'s comment. `clearFarmland` and
  // `encourageStores` already flow through `scene.buildings`; the other three directive marks are
  // not `Building`s (`directiveLayer.ts`'s own comment says why) and are drawn separately here.
  renderStructureLayer(mounted.objectLayer, scene.buildings);
  renderDirectiveLayer(
    mounted.objectLayer,
    directiveAnchorPositions(scene.stockpile.pos),
    activeDirectiveKinds(input.scene.nation, input.scene.city.id),
    numericColor(input.bannerColor),
  );
}

/**
 * `packages/client/src/local/cityViewPanel.ts` per traversal.md §3 (L1): owns its `createWorldViewport`
 * against the Pixi `Application` the caller already has — never constructs one, which would open a
 * second WebGL context. The mounted scene lives under its own dedicated container rather than directly
 * on `app.stage`, so `close()` can reclaim it — Pixi's own `Container.destroy({ children: true })` both
 * destroys every sprite/graphics underneath and calls `removeAllListeners()` on the container itself,
 * which is what `createWorldViewport`'s pointer/wheel handlers are attached to. That is what makes
 * open→close→open→close leave nothing behind: the reclaiming is structural, not bookkept by hand.
 */
export function createCityViewPanel(
  host: HTMLElement,
  app: CityViewApp,
  options: CityViewPanelOptions = {},
): CityViewPanelController {
  app.canvas.classList.add(CANVAS_CLASS);
  host.hidden = true;
  host.append(app.canvas);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = CLOSE_BUTTON_CLASS;
  closeButton.setAttribute("aria-label", CLOSE_BUTTON_LABEL);
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => close());
  host.append(closeButton);

  let mounted: MountedScene | null = null;

  /** The reclaiming `close()` shares with `open()`'s re-mount — kept apart from `onClose` on purpose.
   *  Switching to a different city via `open()` is a cut *within* the local view, never a transition to
   *  the world view, so it must not fire the locate pulse `onClose` exists for. */
  function teardown(): void {
    if (mounted === null) return;
    mounted.resizeObserver?.disconnect();
    app.stage.removeChild(mounted.viewportStage);
    mounted.viewportStage.destroy({ children: true });
    mounted = null;
    host.hidden = true;
  }

  function close(): void {
    if (mounted === null) return;
    teardown();
    options.onClose?.();
  }

  return {
    open(input): void {
      teardown();
      host.hidden = false;
      // Pixi's `resizeTo` (set once, in `main.ts`'s `app.init()`) only re-measures on its own setter or
      // on a `window.resize` event — never on the host merely toggling `hidden`. A host last measured
      // while `display: none` (say, the browser was resized while the panel was closed) would otherwise
      // stay pinned at that stale — possibly 0x0 — size forever. Resizing here, right after unhiding and
      // before `mountScene` reads `host.clientWidth/Height` for the viewport, keeps both in step.
      app.resize();
      mounted = mountScene(app, host);
      host.style.setProperty("--banner-color", input.bannerColor);
      paintScene(input, mounted);
    },

    update(input): void {
      if (mounted === null) return;
      host.style.setProperty("--banner-color", input.bannerColor);
      paintScene(input, mounted);
    },

    close,

    isOpen(): boolean {
      return mounted !== null;
    },
  };
}
