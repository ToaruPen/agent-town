import type { NationWorldState, WorldCellChange } from "@agent-town/shared";
import { Application, Assets, TextureStyle } from "pixi.js";

import { type CityViewApp, createCityViewPanel } from "./local/cityViewPanel.js";
import { type CityViewSyncController, createCityViewSync } from "./local/cityViewSync.js";
import { resolvePlayerCityViewTarget } from "./local/cityViewTarget.js";
import { connect, getWebSocketUrl, type SendClientMessage } from "./net/wsClient.js";
import { SPRITE_PATHS } from "./render/sprites.js";
import { createNationHud, type NationHudRoots } from "./ui/nationHud.js";
import { bindNationKeys } from "./ui/nationKeyboard.js";
import {
  createWorldMapHost,
  type WorldMapHostController,
  type WorldMapSnapshot,
} from "./ui/worldMapHost.js";

/**
 * The nation HUD's roots, or null when the page does not provide them. Absent roots mean this is not
 * the nation page — the dev pages mount their own entry points — so the HUD stays unmounted rather
 * than throwing over markup it has no claim to.
 */
function findNationHudRoots(): NationHudRoots | null {
  const clock = document.getElementById("nation-clock");
  const dashboard = document.getElementById("nation-dashboard");
  const ranking = document.getElementById("nation-ranking");
  const directives = document.getElementById("directive-panel");
  const select = document.getElementById("nation-select");
  const status = document.getElementById("world-status");
  const strip = document.getElementById("nation-strip");
  const report = document.getElementById("season-report");
  if (clock === null || dashboard === null || ranking === null) return null;
  if (directives === null || select === null || status === null) return null;
  if (strip === null || report === null) return null;
  return { clock, dashboard, ranking, directives, select, status, strip, report };
}

/**
 * Shows and hides the one piece of markup that is not driven by a server payload. `index.html` ships
 * it visible, so the page explains itself in the three cases where nothing else can: the script never
 * ran, the socket never opened, or the server is not up.
 */
function createBootNotice(): { clear(): void; show(message: string): void } {
  const notice = document.getElementById("nation-boot");
  return {
    clear(): void {
      notice?.remove();
    },
    show(message: string): void {
      if (notice === null) return;
      notice.textContent = message;
      if (!notice.isConnected) document.body.append(notice);
    },
  };
}

/**
 * The map is mounted separately from the HUD because it is not a HUD panel: the HUD overlays the world
 * and this *is* the world. A null root means a page without a map, which the HUD survives.
 */
function createMapHost(): WorldMapHostController | null {
  const root = document.getElementById("world-map");
  return root === null ? null : createWorldMapHost(root, { className: "world-map__canvas" });
}

/**
 * Every city of every nation, which is what gives each glyph its population tier.
 *
 * `playerPolityId` comes from the HUD rather than from `world.playerNationId`, which looks like the
 * obvious source and is wrong: that field is only ever set by a `welcome`, and a fresh connect always
 * carries null. Nothing afterwards updates it — a `clock` message has no such field and `season` does not
 * copy it — so the id a mid-session `selectNation` established lives only in the HUD, which learns it
 * from the `orders` echo. Reading the payload instead left the map marking nobody until a reconnect.
 */
function mapSnapshot(
  world: NationWorldState,
  playerPolityId: string | null,
  openCityId: string | null,
  changedCells: readonly WorldCellChange[],
): WorldMapSnapshot {
  return {
    history: world.history,
    cityStates: world.nations.flatMap(({ cities }) => cities),
    playerPolityId,
    openCityId,
    tick: world.tick,
    changedCells,
  };
}

/** What `mountNationHud` hands back once the socket is live, so the module-level code can attach the
 *  city view once its own prerequisites (loaded assets, an initialized `Application`) are ready — see
 *  the call site below for why those two starts cannot be reordered to run before the socket opens. */
interface NationHudHandle {
  attachCityView(app: CityViewApp, host: HTMLElement): void;
}

function mountNationHud(roots: NationHudRoots): NationHudHandle {
  // The HUD needs a send and `connect` needs the HUD's handlers, so the channel is resolved lazily.
  // It is non-null well before the player can click anything, and dropping a send that somehow beats
  // the socket is correct anyway: the server's state is what the HUD renders.
  let send: SendClientMessage | null = null;
  const post: SendClientMessage = (message) => send?.(message) ?? false;

  const hud = createNationHud(roots, post);
  const map = createMapHost();
  const boot = createBootNotice();
  // The last payload, kept so an `orders` message can repaint the map: claiming a nation changes which
  // territory is marked, and `orders` carries the id but none of the world the map draws.
  let world: NationWorldState | null = null;
  // Null until `attachCityView` runs — the panel needs a loaded `Application`, which starts after the
  // socket (see the module-level comment on `NationHudHandle`). Every use below is guarded on this.
  // Owns the open/update/close decision — see `cityViewSync.ts` for why that logic lives there rather
  // than here: a nation switch or death needs to compare target *identity* against what is currently
  // shown, not merely whether a redraw key changed or an open has ever happened.
  let citySync: CityViewSyncController | null = null;
  /**
   * `changedCells` defaults to empty: only the `onUpdate` handler below ever has a fresh delta to
   * forward, straight from the wire (`wsClient.ts`'s own second `onUpdate` argument). Every other caller
   * is repainting the *same* world state — a welcome, an orders echo, a city-view close — and the host's
   * own accumulator already remembers whatever change is still animating, so there is nothing new to add.
   */
  const paintMap = (changedCells: readonly WorldCellChange[] = []): void => {
    if (world !== null) {
      // `citySync?.shownCityId() ?? null` rather than a separately tracked variable: the world map's
      // own "open city" mark (traversal.md §2.2) must agree with what the panel actually shows, and
      // reading it from `citySync` — the single owner of that fact — is what keeps it from drifting.
      map?.render(
        mapSnapshot(
          world,
          hud.state().playerNationId,
          citySync?.shownCityId() ?? null,
          changedCells,
        ),
      );
    }
  };
  /** Resolves the player's target (plan: "default target is the player's capital") and hands it to
   *  `citySync`, which decides open/update/close from there — see `cityViewSync.ts`. */
  const paintCityView = (): void => {
    if (citySync === null || world === null) return;
    const target = resolvePlayerCityViewTarget(
      world.history,
      world.nations,
      hud.state().playerNationId,
      world.tick,
    );
    citySync.sync(target);
  };
  send = connect(getWebSocketUrl(window.location), {
    onWelcome: (state) => {
      boot.clear();
      hud.applyWelcome(state, Date.now());
      world = state;
      paintCityView();
      paintMap();
    },
    onUpdate: (state, changedCells) => {
      hud.applyUpdate(state, Date.now());
      world = state;
      paintCityView();
      // Repainted from the server, not from the pointer. This is the whole point of the host: a border
      // that changed hands or a city that grew a tier appears when it happens, not when next clicked.
      paintMap(changedCells);
    },
    onOrders: (message) => {
      hud.applyOrders(message);
      paintCityView();
      paintMap();
    },
    onDisconnected: () => {
      // Deliberately not "paused": a HUD keeps its last payload on screen, so a dropped socket looks
      // exactly like a stopped clock until something says which one it is.
      boot.show("接続が切れました。再接続しています…");
      // And the desk's controls stop offering to send, because for the next second nothing can.
      hud.applyDisconnected();
    },
  });
  // `hud.send`, not `post`: the keys go through the HUD's channel so a send the transport refused is
  // announced. Bound to `post` they would be swallowed silently, with no control on screen to say why.
  bindNationKeys(
    hud.send,
    () => hud.state(),
    {
      toggleDirectives: () => {
        hud.toggleDirectives();
      },
      toggleReport: () => {
        hud.toggleReport();
      },
      closeTopPanel: () => hud.closeTopPanel(),
    },
    { locate: () => map?.locate() },
  );

  // The countdown's own loop, deliberately not Pixi's ticker: that belongs to a scene which may be
  // unmounted. `tick` short-circuits itself while paused, so a paused game repaints nothing.
  const frame = (): void => {
    hud.tick(Date.now());
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    attachCityView(cityApp, host): void {
      const panel = createCityViewPanel(host, cityApp, {
        // visual.md §2.6's automatic locate, on entering the world view from the local view — see
        // `CityViewPanelOptions.onClose`'s own comment for why closing the panel is that transition
        // in this docked layout. Repainting the map here, not waiting for the next server broadcast,
        // is what makes "the open city is marked as open" (traversal.md §2.2) true the instant it
        // actually stops being true, rather than up to a second later. `notifyClosed()` runs first so
        // `citySync` has already recorded the closed city — including the *player*-vs-vanished-target
        // distinction — before `paintMap` reads `shownCityId()` back out.
        onClose: () => {
          citySync?.notifyClosed();
          map?.locate();
          paintMap();
        },
      });
      citySync = createCityViewSync(panel);
      paintCityView();
      paintMap();
    },
  };
}

const nationRoots = findNationHudRoots();
const nationHud = nationRoots !== null ? mountNationHud(nationRoots) : null;

TextureStyle.defaultOptions.scaleMode = "nearest";
await Assets.load([...SPRITE_PATHS]);

const cityViewHost = document.getElementById("city-view");
const app = new Application();
await app.init({
  background: 0x1d2428,
  resizeTo: cityViewHost ?? window,
});

// The primary surface (traversal.md §2.2): the panel mounts its own canvas inside `#city-view` and
// manages its own visibility, rather than the module appending it to `document.body` unconditionally.
// A page with no `#city-view` (none exists today) still gets a live `Application` on screen, matching
// the previous behaviour, since nothing else ever removes or repositions this fallback append.
if (cityViewHost !== null) nationHud?.attachCityView(app, cityViewHost);
else document.body.appendChild(app.canvas);
