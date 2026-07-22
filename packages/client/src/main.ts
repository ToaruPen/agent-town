import { MAP_HEIGHT, MAP_WIDTH, type WorldState } from "@agent-town/shared";
import { Application, Assets, Container, type FederatedPointerEvent, TextureStyle } from "pixi.js";

import { connect, getWebSocketUrl } from "./net/wsClient.js";
import { renderAgentLayer } from "./render/agentLayer.js";
import { renderDeathMarkerLayer, renderDeathTickerLayer } from "./render/deathLayer.js";
import { HUD_PANEL_HEIGHT, renderHudLayer } from "./render/hudLayer.js";
import { renderMapLayer, TILE_SIZE } from "./render/mapLayer.js";
import { SPRITE_PATHS } from "./render/sprites.js";
import { renderStructureLayer } from "./render/structureLayer.js";
import { createWorldViewport } from "./render/worldViewport.js";
import {
  createInspectPanel,
  createThoughtBubbleSchedule,
  updateThoughtBubbleSchedule,
} from "./ui/inspectPanel.js";
import {
  createDeathEventSchedule,
  type DeathEventSchedule,
  latestDeathEvent,
  updateDeathEventSchedule,
} from "./ui/survivalViewModel.js";

const HUD_PADDING = 16;
const NARROW_SCREEN_MAX_WIDTH = 520;
const TICKER_HUD_GAP = 6;
const MAX_GROUND_TAP_DISTANCE = 12;
const MAX_GROUND_TAP_DURATION_MS = 300;

interface GroundTapCandidate {
  x: number;
  y: number;
  startedAt: number;
}

TextureStyle.defaultOptions.scaleMode = "nearest";
await Assets.load([...SPRITE_PATHS]);

const app = new Application();
await app.init({
  background: 0x1d2428,
  resizeTo: window,
});

document.body.appendChild(app.canvas);

const inspectPanelRoot = document.querySelector<HTMLElement>("#inspect-panel");
if (inspectPanelRoot === null) throw new Error("Missing #inspect-panel root");

let selectedAgentId: string | null = null;
const inspectPanel = createInspectPanel(inspectPanelRoot, closeInspectPanel);
const groundTapCandidates = new Map<number, GroundTapCandidate>();

function closeInspectPanel(): void {
  selectedAgentId = null;
  inspectPanel.close();
}

function startGroundTap(event: FederatedPointerEvent): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  groundTapCandidates.set(event.pointerId, {
    x: event.global.x,
    y: event.global.y,
    startedAt: event.timeStamp,
  });
  if (groundTapCandidates.size > 1) groundTapCandidates.clear();
}

function trackGroundTap(event: FederatedPointerEvent): void {
  const candidate = groundTapCandidates.get(event.pointerId);
  if (candidate === undefined) return;
  const distance = Math.hypot(event.global.x - candidate.x, event.global.y - candidate.y);
  if (distance > MAX_GROUND_TAP_DISTANCE) groundTapCandidates.delete(event.pointerId);
}

function closeOnGroundTap(event: FederatedPointerEvent): void {
  const candidate = groundTapCandidates.get(event.pointerId);
  groundTapCandidates.delete(event.pointerId);
  if (candidate === undefined || event.target !== app.stage) return;
  const duration = event.timeStamp - candidate.startedAt;
  if (duration >= 0 && duration <= MAX_GROUND_TAP_DURATION_MS) closeInspectPanel();
}

const world = new Container();
const mapLayer = new Container();
const structureLayer = new Container();
const agentLayer = new Container();
const deathMarkerLayer = new Container();
const hudLayer = new Container();
const tickerLayer = new Container();
world.addChild(mapLayer, structureLayer, deathMarkerLayer, agentLayer);
hudLayer.position.set(HUD_PADDING, HUD_PADDING);
app.stage.addChild(world, hudLayer, tickerLayer);

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
  positionTicker(width);
});
app.stage.on("pointerdown", startGroundTap);
app.stage.on("globalpointermove", trackGroundTap);
app.stage.on("pointertap", closeOnGroundTap);
app.stage.on("pointerupoutside", (event) => groundTapCandidates.delete(event.pointerId));
app.stage.on("pointercancel", (event) => groundTapCandidates.delete(event.pointerId));

let state: WorldState | null = null;
let bubbleSchedule = createThoughtBubbleSchedule();
let deathSchedule: DeathEventSchedule = { observedDeaths: 0, events: [] };
let mapDirty = false;
let structuresDirty = false;
let agentsDirty = false;
let deathsDirty = false;
let tickerDirty = false;
let hudDirty = false;

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
  selectedAgentId = agentId;
  inspectPanel.show(agent);
}

function replaceState(next: WorldState): void {
  bubbleSchedule = updateThoughtBubbleSchedule(
    createThoughtBubbleSchedule(),
    next.agents,
    performance.now(),
  );
  deathSchedule = createDeathEventSchedule(next);
  state = next;
  viewport.fit(next.width * TILE_SIZE, next.height * TILE_SIZE);
  syncInspectPanel(next);
  mapDirty = true;
  structuresDirty = true;
  agentsDirty = true;
  deathsDirty = true;
  tickerDirty = true;
  hudDirty = true;
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
  state = next;
  syncInspectPanel(next);
  agentsDirty = true;
  deathsDirty = true;
  tickerDirty = true;
  hudDirty = true;
}

connect(getWebSocketUrl(window.location), { onWelcome: replaceState, onUpdate: updateState });

app.ticker.add(() => {
  if (state === null) return;
  const now = performance.now();
  if ([...bubbleSchedule.bubbles.values()].some((bubble) => bubble.expiresAt <= now)) {
    bubbleSchedule = updateThoughtBubbleSchedule(bubbleSchedule, state.agents, now);
    agentsDirty = true;
  }
  if (mapDirty) {
    renderMapLayer(mapLayer, state);
    mapDirty = false;
  }
  if (structuresDirty) {
    renderStructureLayer(structureLayer, state.buildings);
    structuresDirty = false;
  }
  if (agentsDirty) {
    renderAgentLayer(agentLayer, state.agents, bubbleSchedule.bubbles, openInspectPanel);
    agentsDirty = false;
  }
  if (deathsDirty) {
    renderDeathMarkerLayer(deathMarkerLayer, deathSchedule.events);
    deathsDirty = false;
  }
  if (tickerDirty) {
    renderDeathTickerLayer(tickerLayer, latestDeathEvent(deathSchedule));
    tickerDirty = false;
  }
  if (hudDirty) {
    renderHudLayer(hudLayer, state);
    hudDirty = false;
  }
});
