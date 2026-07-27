import {
  isFacility,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Position,
  type ResourceKind,
  seasonOfTick,
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
import { interpolateAgentLayer, renderAgentLayer } from "./render/agentLayer.js";
import { renderDeathMarkerLayer } from "./render/deathLayer.js";
import { renderHistoryLayer } from "./render/historyLayer.js";
import { HUD_PANEL_HEIGHT, renderHudLayer } from "./render/hudLayer.js";
import { renderMapLayer, TILE_SIZE } from "./render/mapLayer.js";
import { SPRITE_PATHS } from "./render/sprites.js";
import { renderStructureLayer } from "./render/structureLayer.js";
import { renderTickerLayer } from "./render/tickerLayer.js";
import { renderTrailLayer } from "./render/trailLayer.js";
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
  type InspectTarget,
  updateThoughtBubbleSchedule,
} from "./ui/inspectPanel.js";
import {
  keyboardActivationAction,
  moveTileCursor,
  resolveKeyboardTarget,
} from "./ui/keyboardNavigation.js";
import {
  createSocialMilestoneSchedule,
  currentMilestone,
  mergeMilestoneQueues,
  type SocialMilestoneSchedule,
  updateSocialMilestoneSchedule,
} from "./ui/societyViewModel.js";
import {
  createSpatialMilestoneSchedule,
  type SpatialMilestoneSchedule,
  updateSpatialMilestoneSchedule,
} from "./ui/spatialViewModel.js";
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
  "エージェント・タウンの世界。矢印キーでタイルを選び、改行キーまたは空白キーで調べ、エスケープキーで閉じます。";

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

const inspectPanelElement = document.querySelector<HTMLElement>("#inspect-panel");
if (inspectPanelElement === null) throw new Error("Missing #inspect-panel root");
const inspectPanelRoot: HTMLElement = inspectPanelElement;
const worldStatusElement = document.querySelector<HTMLElement>("#world-status");
if (worldStatusElement === null) throw new Error("Missing #world-status root");
const worldStatusRoot: HTMLElement = worldStatusElement;
const chronicleRoot = document.querySelector<HTMLElement>("#world-chronicle");
if (chronicleRoot === null) throw new Error("Missing #world-chronicle root");
const chronicleToggleElement = document.querySelector<HTMLButtonElement>("#chronicle-toggle");
if (chronicleToggleElement === null) throw new Error("Missing #chronicle-toggle root");
const chronicleToggleRoot: HTMLButtonElement = chronicleToggleElement;
const trafficOverlayToggleElement =
  document.querySelector<HTMLButtonElement>("#traffic-overlay-toggle");
if (trafficOverlayToggleElement === null) throw new Error("Missing #traffic-overlay-toggle root");
const trafficOverlayToggleRoot: HTMLButtonElement = trafficOverlayToggleElement;

let selectedInspectTarget: InspectTarget | null = null;
let hoveredAgentId: string | null = null;
let activeInfoTarget: InfoBubbleTarget | null = null;
let agentsDirty = false;
let infoBubbleDirty = false;
const inspectPanel = createInspectPanel(inspectPanelRoot, closeInspectPanel);
const chronicle = createWorldChronicle(chronicleRoot, closeWorldChronicle, chronicleToggleRoot);
bindWorldChronicleEscape(chronicle, () => {
  closeWorldChronicle();
  announce("年代記を閉じました。");
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
let trafficOverlayEnabled = false;

const world = new Container();
const groundLayer = new Container();
const trailLayer = new Container();
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
trailLayer.zIndex = 1;
objectLayer.zIndex = 2;
keyboardCursor.zIndex = 3;
keyboardCursor.eventMode = "none";
keyboardCursor.visible = false;
trailLayer.eventMode = "none";
world.addChild(groundLayer, trailLayer, objectLayer, keyboardCursor);
hudLayer.position.set(HUD_PADDING, HUD_PADDING);
app.stage.addChild(world, infoBubbleLayer, hudLayer, tickerLayer);

function closeInspectPanel(): void {
  selectedInspectTarget = null;
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
  if (state === null) return "世界データはまだ利用できません。";
  const viewModel = buildInfoBubbleViewModel(target, state, deathSchedule.events);
  return viewModel === null ? "選んだ対象はもう存在しません。" : bubbleText(viewModel);
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
    width < NARROW_SCREEN_MAX_WIDTH
      ? Math.max(
          HUD_PADDING + HUD_PANEL_HEIGHT + TICKER_HUD_GAP,
          trafficOverlayToggleRoot.getBoundingClientRect().bottom + TICKER_HUD_GAP,
        )
      : HUD_PADDING;
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
let socialSchedule: SocialMilestoneSchedule | null = null;
let spatialSchedule: SpatialMilestoneSchedule | null = null;
let mapDirty = false;
let trailsDirty = false;
let structuresDirty = false;
let deathsDirty = false;
let tickerDirty = false;
let hudDirty = false;
let historyDirty = false;

function inspectTargetExists(target: InspectTarget, next: WorldState): boolean {
  if (target.kind === "agent") return next.agents.some(({ id }) => id === target.agentId);
  if (target.kind === "facility") {
    return next.buildings.filter(isFacility).some(({ id }) => id === target.facilityId);
  }
  return next.trailCells[target.tileIndex] !== undefined;
}

function syncInspectPanel(next: WorldState): void {
  if (selectedInspectTarget === null) return;
  if (!inspectTargetExists(selectedInspectTarget, next)) {
    closeInspectPanel();
    return;
  }
  inspectPanel.show(selectedInspectTarget, next);
}

function openInspectPanel(target: InspectTarget): void {
  if (state === null) return;
  closeWorldChronicle();
  selectedInspectTarget = target;
  inspectPanel.show(target, state);
  if (inspectPanelRoot.hidden) {
    selectedInspectTarget = null;
    return;
  }
  agentsDirty = true;
  announce(`${targetAnnouncement(target)} 詳細を開きました。`);
}

function inspectTargetsEqual(left: InspectTarget, right: InspectTarget): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "agent" && right.kind === "agent") return left.agentId === right.agentId;
  if (left.kind === "facility" && right.kind === "facility") {
    return left.facilityId === right.facilityId;
  }
  return left.kind === "trail" && right.kind === "trail" && left.tileIndex === right.tileIndex;
}

function isInspectTarget(target: InfoBubbleTarget): target is InspectTarget {
  return target.kind === "agent" || target.kind === "facility" || target.kind === "trail";
}

function openInspectPanelFromBubble(target: InspectTarget): void {
  if (
    activeInfoTarget === null ||
    !isInspectTarget(activeInfoTarget) ||
    !inspectTargetsEqual(activeInfoTarget, target)
  ) {
    return;
  }
  openInspectPanel(target);
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
  const coordinates = `タイル ${keyboardCursorPosition.x + 1}, ${keyboardCursorPosition.y + 1}。`;
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
    isInspectTarget(target) &&
    keyboardActivationAction(activeInfoTarget, target) === "open-inspect"
  ) {
    openInspectPanel(target);
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
    announce("年代記を閉じました。");
    return;
  }
  closeInspectPanel();
  closeInfoBubble();
  announce("選択を閉じました。");
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
  socialSchedule = createSocialMilestoneSchedule(next);
  spatialSchedule = createSpatialMilestoneSchedule(next);
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
  trailsDirty = true;
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

function normalizeMilestoneSchedules() {
  if (socialSchedule === null || spatialSchedule === null) return [];
  const merged = mergeMilestoneQueues(socialSchedule.events, spatialSchedule.events);
  const timingById = new Map(
    merged.map(({ id, visibleFromTick, expiresAtTick }) => [
      id,
      { visibleFromTick, expiresAtTick },
    ]),
  );
  socialSchedule = {
    ...socialSchedule,
    events: socialSchedule.events.map((event) => ({
      ...event,
      ...timingById.get(event.id),
    })),
  };
  spatialSchedule = {
    ...spatialSchedule,
    events: spatialSchedule.events.map((event) => ({
      ...event,
      ...timingById.get(event.id),
    })),
  };
  return merged;
}

function updateMilestoneSchedules(previous: WorldState, next: WorldState): boolean {
  const previousMilestones = normalizeMilestoneSchedules();
  const previousMilestone = currentMilestone(previousMilestones, previous.tick);
  const previousMilestoneIds = previousMilestones.map((event) => event.id);
  socialSchedule = updateSocialMilestoneSchedule(
    socialSchedule ?? createSocialMilestoneSchedule(previous),
    previous,
    next,
  );
  spatialSchedule = updateSpatialMilestoneSchedule(
    spatialSchedule ?? createSpatialMilestoneSchedule(previous),
    previous,
    next,
  );
  const nextMilestones = normalizeMilestoneSchedules();
  const nextMilestone = currentMilestone(nextMilestones, next.tick);
  const queueChanged =
    previousMilestoneIds.join("\n") !== nextMilestones.map((event) => event.id).join("\n");
  return queueChanged || previousMilestone?.id !== nextMilestone?.id;
}

function updateState(next: WorldState): void {
  if (state === null) {
    replaceState(next);
    return;
  }
  mapDirty =
    mapDirty || next.tiles !== state.tiles || seasonOfTick(next.tick) !== seasonOfTick(state.tick);
  trailsDirty = trailsDirty || next.trailCells !== state.trailCells;
  structuresDirty = structuresDirty || next.buildings !== state.buildings;
  bubbleSchedule = updateThoughtBubbleSchedule(bubbleSchedule, next.agents, performance.now());
  const previousDeathEventId = latestDeathEvent(deathSchedule)?.id ?? null;
  deathSchedule = updateDeathEventSchedule(deathSchedule, state, next);
  const milestoneTickerChanged = updateMilestoneSchedules(state, next);
  const deathTickerChanged = previousDeathEventId !== (latestDeathEvent(deathSchedule)?.id ?? null);
  observeResourceKinds(next);
  state = next;
  rehitHoveredAgent();
  syncInspectPanel(next);
  agentsDirty = true;
  deathsDirty = true;
  tickerDirty = tickerDirty || milestoneTickerChanged || deathTickerChanged;
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
  announce("世界地図を開きました。");
}

chronicleToggleRoot.addEventListener("click", openWorldChronicle);
trafficOverlayToggleRoot.addEventListener("click", () => {
  trafficOverlayEnabled = !trafficOverlayEnabled;
  trafficOverlayToggleRoot.setAttribute("aria-pressed", String(trafficOverlayEnabled));
  trafficOverlayToggleRoot.textContent = trafficOverlayEnabled ? "通行量を隠す" : "通行量を表示";
  trailsDirty = true;
});
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

function selectedAgentRenderId(): string | null {
  if (activeInfoTarget?.kind === "agent") return activeInfoTarget.agentId;
  if (selectedInspectTarget?.kind === "agent") return selectedInspectTarget.agentId;
  return null;
}

function renderDirtyWorldLayers(currentState: WorldState): void {
  if (mapDirty) {
    renderMapLayer(groundLayer, objectLayer, currentState);
    mapDirty = false;
  }
  if (trailsDirty) {
    renderTrailLayer(trailLayer, currentState, trafficOverlayEnabled);
    trailsDirty = false;
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
    renderAgentLayer(objectLayer, currentState.agents, bubbleSchedule.bubbles, {
      selectedAgentId: selectedAgentRenderId(),
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
    const milestone = currentMilestone(
      mergeMilestoneQueues(socialSchedule?.events ?? [], spatialSchedule?.events ?? []),
      currentState.tick,
    );
    const deathEvent = latestDeathEvent(deathSchedule);
    const tickerMessage =
      milestone === null
        ? deathEvent === null
          ? null
          : { text: deathEvent.text, tone: "death" as const }
        : { text: milestone.text, tone: "social" as const };
    renderTickerLayer(tickerLayer, tickerMessage);
    tickerDirty = false;
  }
  if (hudDirty) {
    renderHudLayer(hudLayer, currentState);
    hudDirty = false;
  }
}

app.ticker.add((ticker) => {
  if (state === null) return;
  expireSpeechBubbles(performance.now(), state);
  interpolateAgentLayer(objectLayer, ticker.deltaMS);
  renderDirtyWorldLayers(state);
  renderActiveInfoBubble(state);
  renderScreenLayers(state);
});
