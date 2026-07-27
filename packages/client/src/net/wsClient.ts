import { decodeServerMessage, type NationWorldState, type ServerMessage } from "@agent-town/shared";

const RECONNECT_DELAY_MS = 1_000;

export interface WebSocketLike {
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

type WebSocketFactory = (url: string) => WebSocketLike;
type OrdersMessage = Extract<ServerMessage, { type: "orders" }>;

interface ConnectionHandlers {
  onWelcome(state: NationWorldState): void;
  onUpdate(state: NationWorldState): void;
  onOrders(message: OrdersMessage): void;
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

function applyStateMessage(state: NationWorldState, message: ServerMessage): NationWorldState {
  if (message.type === "clock") {
    return {
      ...state,
      tick: message.tick,
      year: message.year,
      season: message.season,
      speed: message.speed,
    };
  }
  if (message.type === "season") {
    return {
      ...state,
      tick: message.tick,
      year: message.year,
      season: message.season,
      nations: message.nations,
    };
  }
  return state;
}

export function connect(
  url: string,
  handlers: ConnectionHandlers,
  createSocket: WebSocketFactory = createBrowserSocket,
): void {
  let state: NationWorldState | null = null;

  const open = (): void => {
    const socket = createSocket(url);

    socket.onmessage = (event) => {
      const message = decodeServerMessage(event.data);
      if (message.type === "welcome") {
        state = message.state;
        handlers.onWelcome(state);
        return;
      }
      if (message.type === "orders") {
        handlers.onOrders(message);
        return;
      }
      if (state === null) return;

      state = applyStateMessage(state, message);
      handlers.onUpdate(state);
    };
    socket.onclose = () => {
      setTimeout(open, RECONNECT_DELAY_MS);
    };
  };

  open();
}
