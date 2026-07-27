import {
  type ClientMessage,
  decodeServerMessage,
  encodeMessage,
  type NationWorldState,
  type ServerMessage,
} from "@agent-town/shared";

const RECONNECT_DELAY_MS = 1_000;

export interface WebSocketLike {
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
}

/** Outbound channel for the HUD. Routes to whichever socket is current, so it survives a reconnect. */
export type SendClientMessage = (message: ClientMessage) => void;

type WebSocketFactory = (url: string) => WebSocketLike;
type OrdersMessage = Extract<ServerMessage, { type: "orders" }>;

interface ConnectionHandlers {
  onWelcome(state: NationWorldState): void;
  onUpdate(state: NationWorldState): void;
  onOrders(message: OrdersMessage): void;
  /**
   * The socket closed and a reconnect is pending. Optional because the dev pages mount without a
   * socket at all, but the nation page must implement it: a HUD holds its last payload forever, so a
   * dropped connection is indistinguishable from a paused world unless someone says otherwise.
   */
  onDisconnected?(): void;
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
  // A speed click can land before the handshake finishes, and sending then throws. Holding the first
  // messages until "open" costs a few bytes and keeps the HUD from having to know about socket states.
  let pending: string[] | null = [];
  const adapter: WebSocketLike = {
    onmessage: null,
    onclose: null,
    send(data: string): void {
      if (pending === null) socket.send(data);
      else pending.push(data);
    },
  };

  socket.addEventListener("open", () => {
    for (const data of pending ?? []) socket.send(data);
    pending = null;
  });
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
): SendClientMessage {
  let state: NationWorldState | null = null;
  let current: WebSocketLike | null = null;

  const open = (): void => {
    const socket = createSocket(url);
    current = socket;

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
      handlers.onDisconnected?.();
      setTimeout(open, RECONNECT_DELAY_MS);
    };
  };

  open();

  return (message) => {
    current?.send(encodeMessage(message));
  };
}
