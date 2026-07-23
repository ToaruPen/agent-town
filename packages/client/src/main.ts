import {
  MAP_HEIGHT,
  MAP_WIDTH,
  type Position,
  type ResourceKind,
  type WorldState,
} from "@agent-town/shared";
import {
  Application,
  Assets,
  Container,
  type FederatedPointerEvent,
  Graphics,
  TextureStyle,
} from "pixi.js";

import { connect, getWebSocketUrl } from "./net/wsClient.js";
import { renderAgentLayer } from "./render/agentLayer.js";
import { renderDeathMarkerLayer, renderDeathTickerLayer } from "./render/deathLayer.js";
import { renderHistoryLayer } from "./render/historyLayer.js";
import { HUD_PANEL_HEIGHT, renderHudLayer } from "./render/hudLayer.js";
import { renderMapLayer, TILE_SIZE } from "./render/mapLayer.js";
import { SPRITE_PATHS } from "./render/sprites.js";
import { renderStructureLayer } from "./render/structureLayer.js";
import { createDoubleTapHistory, createWorldViewport } from "./render/worldViewport.js";
import {
  bubbleText,
  buildInfoBubbleViewModel,
  createInfoBubbleGesture,
  createInfoBubbleRenderGate,
  type InfoBubblePointer,
  type InfoBubbleTarget,
  isTapGesture,
  mapInfoBubblePlacementToScreen,
  preserveInfoBubbleInvalidation,
  renderInfoBubble,
  resolveHoveredAgentAtScreen,
  resolveInfoBubbleTarget,
  type TapPoint,
} from "./ui/infoBubble.js";
import {
  createInspectPanel,
  createThoughtBubbleSchedule,
  updateThoughtBubbleSchedule,
} from "./ui/inspectPanel.js";
import {
  keyboardActivationAction,
  moveTileCursor,
  resolveKeyboardTarget,
} from "./ui/keyboardNavigation.js";
import {
  createDeathEventSchedule,
  type DeathEventSchedule,
  latestDeathEvent,
  updateDeathEventSchedule,
} from "./ui/survivalViewModel.js";
import { bindWorldChronicleEscape, createWorldChronicle } from "./ui/worldChronicle.js";

const HUD_PADDING = 16;
const NARROW_SCREEN_MAX_WIDTH = 520;
const TICKER_HUD_GAP = 6;
const KEYBOARD_CURSOR_COLOR = 0xfff176;
const CANVAS_LABEL =
  "Agent Town world. Use arrow keys to move the tile cursor, Enter or Space to inspect, and Escape to close.";

type TapCandidate = TapPoint;

TextureStyle.defaultOptions.scaleMode = "nearest";
await Assets.load([...SPRITE_PATHS]);

const app = new Application();
await app.init({
  background: 0x1d2428,
  resizeTo: window,
});

document.body.appendChild(app.canvas);
app.canvas.tabIndex = 0;
app.canvas.setAttribute("role", "application");
app.canvas.setAttribute("aria-label", CANVAS_LABEL);
app.canvas.setAttribute("aria-describedby", "world-instructions world-status");

const inspectPanelRoot = document.querySelector<HTMLElement>("#inspect-panel");
if (inspectPanelRoot === null) throw new Error("Missing #inspect-panel root");
const worldStatusElement = document.querySelector<HTMLElement>("#world-status");
if (worldStatusElement === null) throw new Error("Missing #world-status root");
const worldStatusRoot: HTMLElement = worldStatusElement;
const chronicleRoot = document.querySelector<HTMLElement>("#world-chronicle");
if (chronicleRoot === null) throw new Error("Missing #world-chronicle root");
const chronicleToggleElement = document.querySelector<HTMLButtonElement>("#chronicle-toggle");
if (chronicleToggleElement === null) throw new Error("Missing #chronicle-toggle root");
const chronicleToggleRoot: HTMLButtonElement = chronicleToggleElement;

let selectedAgentId: string | null = null;
let hoveredAgentId: string | null = null;
let activeInfoTarget: InfoBubbleTarget | null = null;
let agentsDirty = false;
let infoBubbleDirty = false;
const inspectPanel = createInspectPanel(inspectPanelRoot, closeInspectPanel);
const chronicle = createWorldChronicle(chronicleRoot, closeWorldChronicle, chronicleToggleRoot);
bindWorldChronicleEscape(chronicle, () => {
  closeWorldChronicle();
  announce("Chronicle closed.");
});
const tapCandidates = new Map<number, TapCandidate>();
const knownResourceKinds = new Map<number, ResourceKind>();
const mainTapHistory = createDoubleTapHistory();
let infoBubbleRenderGate = createInfoBubbleRenderGate();
let infoBubbleGesture = createInfoBubbleGesture();
let lastPointerScreenPosition: Position | null = null;
let keyboardCursorPosition: Position = { x: 0, y: 0 };
let keyboardFocused = false;
let keyboardWorldInitialized = false;

const world = new Container();
const groundLayer = new Container();
const objectLayer = new Container();
const infoBubbleLayer = new Container();
const hudLayer = new Container();
const tickerLayer = new Container();
const keyboardCursor = new Graphics()
  .rect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2)
  .stroke({ color: KEYBOARD_CURSOR_COLOR, width: 1 });
world.sortableChildren = true;
objectLayer.sortableChildren = true;
groundLayer.zIndex = 0;
objectLayer.zIndex = 1;
keyboardCursor.zIndex = 2;
keyboardCursor.eventMode = "none";
keyboardCursor.visible = false;
world.addChild(groundLayer, objectLayer, keyboardCursor);
hudLayer.position.set(HUD_PADDING, HUD_PADDING);
app.stage.addChild(world, infoBubbleLayer, hudLayer, tickerLayer);

function closeInspectPanel(): void {
  selectedAgentId = null;
  inspectPanel.close();
  agentsDirty = true;
}

function closeWorldChronicle(): void {
  chronicle.close();
  chronicleToggleRoot.setAttribute("aria-expanded", "false");
}

function closeInfoBubble(): void {
  if (activeInfoTarget?.kind === "landmark") historyDirty = true;
  activeInfoTarget = null;
  infoBubbleDirty = true;
  infoBubbleRenderGate.cancel();
  infoBubbleGesture.cancel();
  agentsDirty = true;
}

function clearGestureHistories(): void {
  tapCandidates.clear();
  mainTapHistory.clear();
  viewport.clearTapHistory();
}

function startTap(event: FederatedPointerEvent): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  updateHoveredAgentAt(event);
  tapCandidates.set(event.pointerId, {
    x: event.global.x,
    y: event.global.y,
    at: event.timeStamp,
  });
  if (tapCandidates.size <= 1) return;
  tapCandidates.clear();
  mainTapHistory.clear();
  closeInfoBubble();
}

function trackTap(event: FederatedPointerEvent): void {
  updateHoveredAgentAt(event);
  if (infoBubbleGesture.move(infoBubblePointer(event)) === "invalid") closeInfoBubble();
  const candidate = tapCandidates.get(event.pointerId);
  if (candidate === undefined) return;
  const distanceOnlyEnd = { x: event.global.x, y: event.global.y, at: candidate.at };
  if (isTapGesture(candidate, distanceOnlyEnd)) return;
  tapCandidates.delete(event.pointerId);
  mainTapHistory.clear();
  closeInfoBubble();
}

function infoBubblePointer(event: FederatedPointerEvent): InfoBubblePointer {
  return {
    pointerId: event.pointerId,
    x: event.global.x,
    y: event.global.y,
    at: event.timeStamp,
  };
}

function announce(message: string): void {
  worldStatusRoot.textContent = message;
}

function targetAnnouncement(target: InfoBubbleTarget): string {
  if (state === null) return "World data is not available yet.";
  const viewModel = buildInfoBubbleViewModel(target, state, deathSchedule.events);
  return viewModel === null ? "The selected object is no longer available." : bubbleText(viewModel);
}

function selectInfoTarget(target: InfoBubbleTarget): void {
  closeWorldChronicle();
  closeInspectPanel();
  activeInfoTarget = target;
  historyDirty = true;
  infoBubbleDirty = true;
  agentsDirty = true;
  announce(targetAnnouncement(target));
}

function endTap(event: FederatedPointerEvent): void {
  const candidate = tapCandidates.get(event.pointerId);
  tapCandidates.delete(event.pointerId);
  if (candidate === undefined) return;
  const end = { x: event.global.x, y: event.global.y, at: event.timeStamp };
  if (!isTapGesture(candidate, end)) {
    closeInfoBubble();
    return;
  }
  if (mainTapHistory.register(end)) {
    closeInfoBubble();
    return;
  }
  if (state === null) {
    closeInfoBubble();
    return;
  }
  const target = resolveInfoBubbleTarget(
    state,
    deathSchedule.events,
    knownResourceKinds,
    world.toLocal(event.global),
  );
  if (target === null) {
    closeInspectPanel();
    closeInfoBubble();
    return;
  }
  selectInfoTarget(target);
}

function cancelTap(event: FederatedPointerEvent): void {
  tapCandidates.delete(event.pointerId);
  mainTapHistory.clear();
}

function positionTicker(width: number): void {
  const y =
    width < NARROW_SCREEN_MAX_WIDTH ? HUD_PADDING + HUD_PANEL_HEIGHT + TICKER_HUD_GAP : HUD_PADDING;
  tickerLayer.position.set(width / 2, y);
}

positionTicker(app.screen.width);

const viewport = createWorldViewport(
  app.stage,
  world,
  MAP_WIDTH * TILE_SIZE,
  MAP_HEIGHT * TILE_SIZE,
  app.screen.width,
  app.screen.height,
);
app.renderer.on("resize", (width, height) => {
  viewport.resize(width, height);
  closeInfoBubble();
  positionTicker(width);
});
app.stage.on("pointerdown", startTap);
app.stage.on("globalpointermove", trackTap);
app.stage.on("pointerup", endTap);
app.stage.on("pointerupoutside", cancelTap);
app.stage.on("pointercancel", cancelTap);
app.stage.on("wheel", () => {
  mainTapHistory.clear();
  closeInfoBubble();
});

let state: WorldState | null = null;
let bubbleSchedule = createThoughtBubbleSchedule();
let deathSchedule: DeathEventSchedule = { observedDeaths: 0, events: [] };
let mapDirty = false;
let structuresDirty = false;
let deathsDirty = false;
let tickerDirty = false;
let hudDirty = false;
let historyDirty = false;

function syncInspectPanel(next: WorldState): void {
  if (selectedAgentId === null) return;
  const selectedAgent = next.agents.find((agent) => agent.id === selectedAgentId);
  if (selectedAgent === undefined) {
    closeInspectPanel();
    return;
  }
  inspectPanel.show(selectedAgent);
}

function openInspectPanel(agentId: string): void {
  if (state === null) return;
  const agent = state.agents.find((candidate) => candidate.id === agentId);
  if (agent === undefined) return;
  closeWorldChronicle();
  selectedAgentId = agentId;
  inspectPanel.show(agent);
  agentsDirty = true;
  announce(`Opened full details for ${agent.name}.`);
}

function openInspectPanelFromBubble(agentId: string): void {
  if (activeInfoTarget?.kind !== "agent" || activeInfoTarget.agentId !== agentId) return;
  openInspectPanel(agentId);
  closeInfoBubble();
}

function observeResourceKinds(next: WorldState): void {
  for (const [index, tile] of next.tiles.entries()) {
    const resourceKind = tile.resource?.kind ?? tile.resourceOrigin;
    if (resourceKind !== undefined) knownResourceKinds.set(index, resourceKind);
  }
}

function setHoveredAgent(agentId: string | null): void {
  if (hoveredAgentId === agentId) return;
  hoveredAgentId = agentId;
  agentsDirty = true;
}

function rehitHoveredAgent(): void {
  const agentId =
    state === null || lastPointerScreenPosition === null
      ? null
      : resolveHoveredAgentAtScreen(
          state,
          deathSchedule.events,
          knownResourceKinds,
          lastPointerScreenPosition,
          (point) => world.toLocal(point),
        );
  setHoveredAgent(agentId);
}

function updateHoveredAgentAt(event: FederatedPointerEvent): void {
  lastPointerScreenPosition = { x: event.global.x, y: event.global.y };
  rehitHoveredAgent();
}

function clearHoveredAgent(): void {
  lastPointerScreenPosition = null;
  setHoveredAgent(null);
}

function setKeyboardCursor(position: Position): void {
  keyboardCursorPosition = position;
  keyboardCursor.position.set(position.x * TILE_SIZE, position.y * TILE_SIZE);
}

function keyboardTarget(): InfoBubbleTarget | null {
  return state === null
    ? null
    : resolveKeyboardTarget(
        state,
        deathSchedule.events,
        knownResourceKinds,
        keyboardCursorPosition,
      );
}

function announceKeyboardCursor(): void {
  const target = keyboardTarget();
  const coordinates = `Tile ${keyboardCursorPosition.x + 1}, ${keyboardCursorPosition.y + 1}.`;
  announce(target === null ? coordinates : `${coordinates} ${targetAnnouncement(target)}`);
}

function moveKeyboardSelection(key: string, currentState: WorldState): void {
  setKeyboardCursor(
    moveTileCursor(keyboardCursorPosition, key, currentState.width, currentState.height),
  );
  closeInfoBubble();
  announceKeyboardCursor();
}

function activateKeyboardSelection(): void {
  const target = keyboardTarget();
  if (target === null) {
    announceKeyboardCursor();
    return;
  }
  if (
    target.kind === "agent" &&
    keyboardActivationAction(activeInfoTarget, target) === "open-agent"
  ) {
    openInspectPanel(target.agentId);
    closeInfoBubble();
    return;
  }
  selectInfoTarget(target);
}

function handleCanvasKeydown(event: KeyboardEvent): void {
  if (state === null) return;
  if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    moveKeyboardSelection(event.key, state);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activateKeyboardSelection();
    return;
  }
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (chronicle.isOpen()) {
    closeWorldChronicle();
    announce("Chronicle closed.");
    return;
  }
  closeInspectPanel();
  closeInfoBubble();
  announce("Selection closed.");
}

function syncKeyboardCursor(next: WorldState): void {
  if (!keyboardWorldInitialized) {
    keyboardWorldInitialized = true;
    setKeyboardCursor(next.stockpile.pos);
    return;
  }
  setKeyboardCursor({
    x: Math.min(keyboardCursorPosition.x, next.width - 1),
    y: Math.min(keyboardCursorPosition.y, next.height - 1),
  });
}

function replaceState(next: WorldState): void {
  bubbleSchedule = updateThoughtBubbleSchedule(
    createThoughtBubbleSchedule(),
    next.agents,
    performance.now(),
  );
  deathSchedule = createDeathEventSchedule(next);
  knownResourceKinds.clear();
  observeResourceKinds(next);
  state = next;
  closeWorldChronicle();
  chronicleToggleRoot.hidden = next.history.events.length === 0;
  syncKeyboardCursor(next);
  closeInfoBubble();
  viewport.fit(next.width * TILE_SIZE, next.height * TILE_SIZE);
  syncInspectPanel(next);
  mapDirty = true;
  structuresDirty = true;
  agentsDirty = true;
  deathsDirty = true;
  tickerDirty = true;
  hudDirty = true;
  historyDirty = true;
  infoBubbleDirty = true;
  rehitHoveredAgent();
  if (keyboardFocused) announceKeyboardCursor();
}

function updateState(next: WorldState): void {
  if (state === null) {
    replaceState(next);
    return;
  }
  mapDirty = mapDirty || next.tiles !== state.tiles;
  structuresDirty = structuresDirty || next.buildings !== state.buildings;
  bubbleSchedule = updateThoughtBubbleSchedule(bubbleSchedule, next.agents, performance.now());
  deathSchedule = updateDeathEventSchedule(deathSchedule, state, next);
  observeResourceKinds(next);
  state = next;
  rehitHoveredAgent();
  syncInspectPanel(next);
  agentsDirty = true;
  deathsDirty = true;
  tickerDirty = true;
  hudDirty = true;
  infoBubbleDirty = preserveInfoBubbleInvalidation(infoBubbleDirty, activeInfoTarget);
}

connect(getWebSocketUrl(window.location), { onWelcome: replaceState, onUpdate: updateState });

function openWorldChronicle(): void {
  if (state === null) return;
  closeInspectPanel();
  closeInfoBubble();
  chronicle.show(state.history);
  chronicleToggleRoot.setAttribute("aria-expanded", "true");
  announce(`Opened the ${state.history.currentYear - state.history.startYear}-year chronicle.`);
}

chronicleToggleRoot.addEventListener("click", openWorldChronicle);
app.canvas.addEventListener("pointerleave", clearHoveredAgent);
app.canvas.addEventListener("keydown", handleCanvasKeydown);
app.canvas.addEventListener("focus", () => {
  keyboardFocused = true;
  keyboardCursor.visible = true;
  announceKeyboardCursor();
});
app.canvas.addEventListener("blur", () => {
  keyboardFocused = false;
  keyboardCursor.visible = false;
});

function expireSpeechBubbles(now: number, currentState: WorldState): void {
  if ([...bubbleSchedule.bubbles.values()].some((bubble) => bubble.expiresAt <= now)) {
    bubbleSchedule = updateThoughtBubbleSchedule(bubbleSchedule, currentState.agents, now);
    agentsDirty = true;
  }
}

function renderDirtyWorldLayers(currentState: WorldState): void {
  if (mapDirty) {
    renderMapLayer(groundLayer, objectLayer, currentState);
    mapDirty = false;
  }
  if (structuresDirty) {
    renderStructureLayer(objectLayer, currentState.buildings);
    structuresDirty = false;
  }
  if (historyDirty) {
    const landmarkId = activeInfoTarget?.kind === "landmark" ? activeInfoTarget.landmarkId : null;
    renderHistoryLayer(
      objectLayer,
      currentState.history.landmarks,
      currentState.history.polities,
      landmarkId,
    );
    historyDirty = false;
  }
  if (agentsDirty) {
    const bubbleAgentId =
      activeInfoTarget?.kind === "agent" ? activeInfoTarget.agentId : selectedAgentId;
    renderAgentLayer(objectLayer, currentState.agents, bubbleSchedule.bubbles, {
      selectedAgentId: bubbleAgentId,
      hoveredAgentId,
    });
    agentsDirty = false;
  }
  if (deathsDirty) {
    renderDeathMarkerLayer(objectLayer, deathSchedule.events);
    deathsDirty = false;
  }
}

function renderActiveInfoBubble(currentState: WorldState): void {
  if (infoBubbleRenderGate.shouldRender(infoBubbleDirty)) {
    infoBubbleRenderGate.cancel();
    infoBubbleGesture.cancel();
    infoBubbleRenderGate = createInfoBubbleRenderGate();
    infoBubbleGesture = createInfoBubbleGesture();
    const interaction = infoBubbleRenderGate;
    const gesture = infoBubbleGesture;
    const viewModel =
      activeInfoTarget === null
        ? null
        : buildInfoBubbleViewModel(activeInfoTarget, currentState, deathSchedule.events);
    if (activeInfoTarget !== null && viewModel === null) {
      activeInfoTarget = null;
      agentsDirty = true;
    }
    const screenViewModel =
      viewModel === null
        ? null
        : {
            ...viewModel,
            placement: mapInfoBubblePlacementToScreen(viewModel.placement, (point) =>
              world.toGlobal(point),
            ),
          };
    renderInfoBubble(
      infoBubbleLayer,
      screenViewModel,
      app.screen,
      openInspectPanelFromBubble,
      () => {
        clearGestureHistories();
      },
      (event) => {
        interaction.begin();
        gesture.start(infoBubblePointer(event));
      },
      (event, releasedInside) => {
        const shouldActivate = gesture.end(infoBubblePointer(event), releasedInside);
        interaction.end();
        if (!shouldActivate) closeInfoBubble();
      },
      () => interaction.canActivate() && gesture.canActivate(),
    );
    infoBubbleDirty = false;
  }
}

function renderScreenLayers(currentState: WorldState): void {
  if (tickerDirty) {
    renderDeathTickerLayer(tickerLayer, latestDeathEvent(deathSchedule));
    tickerDirty = false;
  }
  if (hudDirty) {
    renderHudLayer(hudLayer, currentState);
    hudDirty = false;
  }
}

app.ticker.add(() => {
  if (state === null) return;
  expireSpeechBubbles(performance.now(), state);
  renderDirtyWorldLayers(state);
  renderActiveInfoBubble(state);
  renderScreenLayers(state);
});
