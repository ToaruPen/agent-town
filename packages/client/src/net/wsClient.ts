import { decodeServerMessage, type WorldState } from "@agent-town/shared";

const RECONNECT_DELAY_MS = 1_000;

export interface WebSocketLike {
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

type WebSocketFactory = (url: string) => WebSocketLike;

interface ConnectionHandlers {
  onWelcome(state: WorldState): void;
  onUpdate(state: WorldState): void;
}

interface WebSocketLocation {
  host: string;
  protocol: string;
}

export function getWebSocketUrl(location: WebSocketLocation): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}/ws`;
}

function createBrowserSocket(url: string): WebSocketLike {
  const socket = new WebSocket(url);
  const adapter: WebSocketLike = { onmessage: null, onclose: null };

  socket.addEventListener("message", (event) => {
    adapter.onmessage?.({ data: String(event.data) });
  });
  socket.addEventListener("close", () => {
    adapter.onclose?.();
  });

  return adapter;
}

function applyUpdate(
  state: WorldState,
  message: ReturnType<typeof decodeServerMessage>,
): WorldState {
  if (message.type !== "update") return state;

  const tiles = message.changedTiles.length === 0 ? state.tiles : [...state.tiles];
  for (const change of message.changedTiles) tiles[change.index] = change.tile;

  return {
    ...state,
    tick: message.tick,
    agents: message.agents,
    stockpile: message.stockpile,
    buildings: message.buildings,
    deaths: message.deaths,
    tiles,
  };
}

export function connect(
  url: string,
  handlers: ConnectionHandlers,
  createSocket: WebSocketFactory = createBrowserSocket,
): void {
  let state: WorldState | null = null;

  const open = (): void => {
    const socket = createSocket(url);

    socket.onmessage = (event) => {
      const message = decodeServerMessage(event.data);
      if (message.type === "welcome") {
        state = message.state;
        handlers.onWelcome(state);
        return;
      }
      if (state === null) return;

      state = applyUpdate(state, message);
      handlers.onUpdate(state);
    };
    socket.onclose = () => {
      setTimeout(open, RECONNECT_DELAY_MS);
    };
  };

  open();
}
