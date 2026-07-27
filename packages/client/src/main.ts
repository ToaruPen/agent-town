import { Application, Assets, TextureStyle } from "pixi.js";

import { connect, getWebSocketUrl, type SendClientMessage } from "./net/wsClient.js";
import { SPRITE_PATHS } from "./render/sprites.js";
import { createNationHud, type NationHudRoots } from "./ui/nationHud.js";
import { bindNationSpeedKeys } from "./ui/nationKeyboard.js";

/**
 * The nation HUD's roots, or null when the page does not provide them. Absent roots mean this is not
 * the nation page — the dev pages mount their own entry points — so the HUD stays unmounted rather
 * than throwing over markup it has no claim to.
 */
function findNationHudRoots(): NationHudRoots | null {
  const clock = document.getElementById("nation-clock");
  const dashboard = document.getElementById("nation-dashboard");
  const ranking = document.getElementById("nation-ranking");
  const select = document.getElementById("nation-select");
  const status = document.getElementById("world-status");
  if (clock === null || dashboard === null || ranking === null) return null;
  if (select === null || status === null) return null;
  return { clock, dashboard, ranking, select, status };
}

function mountNationHud(roots: NationHudRoots): void {
  // The HUD needs a send and `connect` needs the HUD's handlers, so the channel is resolved lazily.
  // It is non-null well before the player can click anything, and dropping a send that somehow beats
  // the socket is correct anyway: the server's state is what the HUD renders.
  let send: SendClientMessage | null = null;
  const post: SendClientMessage = (message) => send?.(message);

  const hud = createNationHud(roots, post);
  send = connect(getWebSocketUrl(window.location), {
    onWelcome: (state) => {
      hud.applyWelcome(state, Date.now());
    },
    onUpdate: (state) => {
      hud.applyUpdate(state, Date.now());
    },
    onOrders: (message) => {
      // The order desk is C1-4. Only the nation id is read here, because it is the sole place the
      // server confirms a `selectNation`; the candidate list and the queued order are that slice's.
      hud.applyOrdersNation(message.nationId);
    },
  });
  bindNationSpeedKeys(post, () => hud.state());

  // The countdown's own loop, deliberately not Pixi's ticker: that belongs to a scene which may be
  // unmounted. `tick` short-circuits itself while paused, so a paused game repaints nothing.
  const frame = (): void => {
    hud.tick(Date.now());
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const nationRoots = findNationHudRoots();
if (nationRoots !== null) mountNationHud(nationRoots);

TextureStyle.defaultOptions.scaleMode = "nearest";
await Assets.load([...SPRITE_PATHS]);

const app = new Application();
await app.init({
  background: 0x1d2428,
  resizeTo: window,
});

document.body.appendChild(app.canvas);
