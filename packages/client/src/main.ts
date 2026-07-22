import { MAP_HEIGHT, MAP_WIDTH, type WorldState, WS_PORT } from "@agent-town/shared";
import { Application, Container } from "pixi.js";

import { connect } from "./net/wsClient.js";
import { renderAgentLayer } from "./render/agentLayer.js";
import { renderHudLayer } from "./render/hudLayer.js";
import { renderMapLayer, TILE_SIZE } from "./render/mapLayer.js";

const HUD_WIDTH = 180;
const HUD_PADDING = 16;

const app = new Application();
await app.init({
  width: MAP_WIDTH * TILE_SIZE + HUD_WIDTH,
  height: MAP_HEIGHT * TILE_SIZE,
  background: 0x1d2428,
});

document.body.appendChild(app.canvas);

const mapLayer = new Container();
const agentLayer = new Container();
const hudLayer = new Container();
hudLayer.position.set(MAP_WIDTH * TILE_SIZE + HUD_PADDING, HUD_PADDING);
app.stage.addChild(mapLayer, agentLayer, hudLayer);

let state: WorldState | null = null;
let mapDirty = false;
let agentsDirty = false;
let hudDirty = false;

function replaceState(next: WorldState): void {
  state = next;
  mapDirty = true;
  agentsDirty = true;
  hudDirty = true;
}

function updateState(next: WorldState): void {
  mapDirty = mapDirty || next.tiles !== state?.tiles;
  state = next;
  agentsDirty = true;
  hudDirty = true;
}

connect(`ws://localhost:${WS_PORT}`, { onWelcome: replaceState, onUpdate: updateState });

app.ticker.add(() => {
  if (state === null) return;
  if (mapDirty) {
    renderMapLayer(mapLayer, state);
    mapDirty = false;
  }
  if (agentsDirty) {
    renderAgentLayer(agentLayer, state.agents);
    agentsDirty = false;
  }
  if (hudDirty) {
    renderHudLayer(hudLayer, state);
    hudDirty = false;
  }
});
