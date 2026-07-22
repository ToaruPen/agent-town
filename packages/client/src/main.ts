import { MAP_HEIGHT, MAP_WIDTH, type WorldState } from "@agent-town/shared";
import { Application, Assets, Container, TextureStyle } from "pixi.js";

import { connect, getWebSocketUrl } from "./net/wsClient.js";
import { renderAgentLayer } from "./render/agentLayer.js";
import { renderHudLayer } from "./render/hudLayer.js";
import { renderMapLayer, TILE_SIZE } from "./render/mapLayer.js";
import { SPRITE_PATHS } from "./render/sprites.js";
import { createWorldViewport } from "./render/worldViewport.js";

const HUD_PADDING = 16;

TextureStyle.defaultOptions.scaleMode = "nearest";
await Assets.load([...SPRITE_PATHS]);

const app = new Application();
await app.init({
  background: 0x1d2428,
  resizeTo: window,
});

document.body.appendChild(app.canvas);

const world = new Container();
const mapLayer = new Container();
const agentLayer = new Container();
const hudLayer = new Container();
world.addChild(mapLayer, agentLayer);
hudLayer.position.set(HUD_PADDING, HUD_PADDING);
app.stage.addChild(world, hudLayer);

const viewport = createWorldViewport(
  app.stage,
  world,
  MAP_WIDTH * TILE_SIZE,
  MAP_HEIGHT * TILE_SIZE,
  app.screen.width,
  app.screen.height,
);
app.renderer.on("resize", viewport.resize);

let state: WorldState | null = null;
let mapDirty = false;
let agentsDirty = false;
let hudDirty = false;

function replaceState(next: WorldState): void {
  state = next;
  viewport.fit(next.width * TILE_SIZE, next.height * TILE_SIZE);
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

connect(getWebSocketUrl(window.location), { onWelcome: replaceState, onUpdate: updateState });

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
