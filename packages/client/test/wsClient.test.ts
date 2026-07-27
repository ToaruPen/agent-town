import type { NationState, NationWorldState, ServerMessage } from "@agent-town/shared";
import { describe, expect, it, vi } from "vitest";

import { connect, getWebSocketUrl, type WebSocketLike } from "../src/net/wsClient.js";
import { SPRITE_PATHS } from "../src/render/sprites.js";

const pixiShell = vi.hoisted(() => {
  const canvas = {};
  return {
    canvas,
    appendChild: vi.fn(),
    init: vi.fn(async () => undefined),
    load: vi.fn(async () => undefined),
  };
});

vi.mock("pixi.js", () => ({
  Application: class {
    readonly canvas = pixiShell.canvas;
    readonly init = pixiShell.init;
  },
  Assets: { load: pixiShell.load },
  TextureStyle: { defaultOptions: { scaleMode: "linear" } },
}));

class MockWebSocket implements WebSocketLike {
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  emit(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function nationFixture(overrides: Partial<NationState> = {}): NationState {
  return {
    id: "realm",
    controller: "player",
    autoPilot: false,
    stocks: { food: 100, materials: 80, wealth: 60 },
    cities: [{ cityId: "capital", population: 1_000, developmentLevel: 0 }],
    territoryCellCount: 10,
    population: 1_000,
    stability: 70,
    culture: 20,
    foodProduction: 10,
    materialProduction: 5,
    activeDirectives: [],
    prosperity: {
      population: 0.2,
      production: 0.3,
      wealth: 0.4,
      stability: 0.7,
      culture: 0.2,
      total: 340,
    },
    lastReport: null,
    ...overrides,
  };
}

function worldFixture(): NationWorldState {
  return {
    tick: 0,
    year: 1,
    season: "spring",
    speed: 1,
    history: {
      startYear: -200,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
      worldMap: {
        width: 1,
        height: 1,
        cells: [{ terrain: "plains", polityId: "realm" }],
        cities: [],
        tradeRoutes: [],
        borderChanges: [],
        settlementFrontierPos: { x: 0, y: 0 },
      },
    },
    nations: [nationFixture()],
    playerNationId: "realm",
  };
}

describe("connect", () => {
  it("holds the welcome world and replaces nation state at a season boundary", () => {
    const socket = new MockWebSocket();
    const factory = vi.fn(() => socket);
    const onWelcome = vi.fn();
    const onUpdate = vi.fn();
    const onOrders = vi.fn();
    const nextNation = nationFixture({ population: 1_050 });

    connect("ws://example.test", { onWelcome, onUpdate, onOrders }, factory);
    socket.emit({ type: "welcome", state: worldFixture() });
    socket.emit({
      type: "season",
      tick: 300,
      year: 1,
      season: "summer",
      nations: [nextNation],
      changedCells: [],
    });

    const welcomed = onWelcome.mock.calls[0]?.[0];
    const updated = onUpdate.mock.calls[0]?.[0];
    expect(factory).toHaveBeenCalledWith("ws://example.test");
    expect(welcomed).toEqual(worldFixture());
    expect(updated).toEqual({
      ...worldFixture(),
      tick: 300,
      year: 1,
      season: "summer",
      nations: [nextNation],
    });
    expect(updated.history).toBe(welcomed.history);
    expect(onOrders).not.toHaveBeenCalled();
  });

  it("applies a light clock while retaining history and nations by reference", () => {
    const socket = new MockWebSocket();
    const onWelcome = vi.fn();
    const onUpdate = vi.fn();

    connect("ws://example.test", { onWelcome, onUpdate, onOrders: vi.fn() }, () => socket);
    socket.emit({ type: "welcome", state: worldFixture() });
    socket.emit({
      type: "clock",
      tick: 17,
      year: 1,
      season: "spring",
      speed: 4,
    });

    const welcomed = onWelcome.mock.calls[0]?.[0];
    const updated = onUpdate.mock.calls[0]?.[0];
    expect(updated).toEqual({ ...worldFixture(), tick: 17, speed: 4 });
    expect(updated.history).toBe(welcomed.history);
    expect(updated.nations).toBe(welcomed.nations);
  });

  it("forwards orders without pretending they are nation state", () => {
    const socket = new MockWebSocket();
    const onUpdate = vi.fn();
    const onOrders = vi.fn();
    const orders: ServerMessage = {
      type: "orders",
      tick: 0,
      nationId: "realm",
      autoPilot: false,
      options: [],
      queued: null,
      chancellorChoice: null,
      rejected: "insufficientFood",
    };

    connect("ws://example.test", { onWelcome: vi.fn(), onUpdate, onOrders }, () => socket);
    socket.emit({ type: "welcome", state: worldFixture() });
    socket.emit(orders);

    expect(onOrders).toHaveBeenCalledWith(orders);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  /**
   * The HUD holds its last payload, so a dropped socket renders identically to a stopped clock. The
   * close has to be announced or the page silently lies about being live.
   */
  it("announces a close before scheduling the reconnect", () => {
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const onDisconnected = vi.fn();

    connect(
      "ws://example.test",
      { onWelcome: vi.fn(), onUpdate: vi.fn(), onOrders: vi.fn(), onDisconnected },
      () => socket,
    );
    socket.onclose?.();

    expect(onDisconnected).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  /** The dev pages mount without a socket, so the handler stays optional and its absence is not a crash. */
  it("tolerates a close with no disconnect handler", () => {
    vi.useFakeTimers();
    const socket = new MockWebSocket();

    connect(
      "ws://example.test",
      { onWelcome: vi.fn(), onUpdate: vi.fn(), onOrders: vi.fn() },
      () => socket,
    );

    expect(() => socket.onclose?.()).not.toThrow();
    vi.useRealTimers();
  });
});

describe("connect's outbound channel", () => {
  it("encodes a client message onto the socket", () => {
    const socket = new MockWebSocket();

    const send = connect(
      "ws://example.test",
      { onWelcome: vi.fn(), onUpdate: vi.fn(), onOrders: vi.fn() },
      () => socket,
    );
    send({ type: "setSpeed", speed: 4 });

    expect(socket.sent).toEqual(['{"type":"setSpeed","speed":4}']);
  });

  /** Reconnect replaces the socket, so a `send` captured before the drop must reach the new one. */
  it("routes to the reconnected socket rather than the closed one", () => {
    vi.useFakeTimers();
    const sockets = [new MockWebSocket(), new MockWebSocket()];
    let opened = 0;

    const send = connect(
      "ws://example.test",
      { onWelcome: vi.fn(), onUpdate: vi.fn(), onOrders: vi.fn() },
      () => {
        const socket = sockets[opened];
        opened += 1;
        if (socket === undefined) throw new Error("opened more sockets than the test provides");
        return socket;
      },
    );
    sockets[0]?.onclose?.();
    vi.runOnlyPendingTimers();
    send({ type: "setSpeed", speed: 0 });
    vi.useRealTimers();

    expect(sockets[0]?.sent).toEqual([]);
    expect(sockets[1]?.sent).toEqual(['{"type":"setSpeed","speed":0}']);
  });

  /**
   * The second between a drop and the reconnect. `current` used to keep pointing at the closed socket, and
   * `createBrowserSocket`'s queue only buffers before the *first* open, so the message went to a CLOSED
   * socket — which browsers discard without throwing. Every click and key for that second vanished with no
   * error anywhere, while the controls stayed enabled.
   *
   * Refused rather than queued for the replacement: a directive submitted before a gap of unknown length is
   * an intent formed against a world that has since moved, and replaying it would make the transport assert
   * what the desk is forbidden from asserting. The caller is told no, and says so.
   */
  it("refuses a send during the reconnect gap instead of dropping it silently", () => {
    vi.useFakeTimers();
    const sockets = [new MockWebSocket(), new MockWebSocket()];
    let opened = 0;

    const send = connect(
      "ws://example.test",
      { onWelcome: vi.fn(), onUpdate: vi.fn(), onOrders: vi.fn() },
      () => {
        const socket = sockets[opened];
        opened += 1;
        if (socket === undefined) throw new Error("opened more sockets than the test provides");
        return socket;
      },
    );

    expect(send({ type: "setSpeed", speed: 2 })).toBe(true);

    sockets[0]?.onclose?.();

    // Still inside the gap: no replacement socket exists yet.
    expect(send({ type: "issueDirective", kind: "holdFestival", targetCityId: null })).toBe(false);
    expect(opened).toBe(1);

    vi.runOnlyPendingTimers();

    expect(send({ type: "setSpeed", speed: 4 })).toBe(true);
    vi.useRealTimers();

    // The refused message reached neither socket, and was not replayed onto the replacement.
    expect(sockets[0]?.sent).toEqual(['{"type":"setSpeed","speed":2}']);
    expect(sockets[1]?.sent).toEqual(['{"type":"setSpeed","speed":4}']);
  });

  /** The notice fires on the same edge that stops the sending, so the two can never disagree. */
  it("reports the disconnect to the caller before the gap begins", () => {
    vi.useFakeTimers();
    const socket = new MockWebSocket();
    const onDisconnected = vi.fn();
    let sentDuringNotice: boolean | null = null;

    const send = connect(
      "ws://example.test",
      {
        onWelcome: vi.fn(),
        onUpdate: vi.fn(),
        onOrders: vi.fn(),
        onDisconnected: () => {
          onDisconnected();
          sentDuringNotice = send({ type: "setSpeed", speed: 1 });
        },
      },
      () => socket,
    );
    socket.onclose?.();
    vi.useRealTimers();

    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(sentDuringNotice).toBe(false);
  });
});

describe("getWebSocketUrl", () => {
  it("uses the same-origin /ws path for HTTP development", () => {
    expect(getWebSocketUrl({ host: "localhost:5173", protocol: "http:" })).toBe(
      "ws://localhost:5173/ws",
    );
  });

  it("uses secure WebSockets for an HTTPS production origin", () => {
    expect(getWebSocketUrl({ host: "town.example", protocol: "https:" })).toBe(
      "wss://town.example/ws",
    );
  });
});

describe("main shell", () => {
  /**
   * The Pixi half of the entry point, which the nation HUD sits beside rather than replaces. The stub
   * document has no HUD roots, so `main.ts` takes its unmounted path and this stays a test of the
   * shell — the mounted path is DOM construction, which this repo has no environment to exercise.
   */
  it("boots an empty nearest-neighbour Pixi application after preloading resident sprites", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      body: { appendChild: pixiShell.appendChild },
      getElementById: () => null,
    });

    await expect(import("../src/main.js")).resolves.toBeDefined();

    expect(pixiShell.load).toHaveBeenCalledWith([...SPRITE_PATHS]);
    expect(pixiShell.init).toHaveBeenCalledWith({
      background: 0x1d2428,
      resizeTo: window,
    });
    expect(pixiShell.appendChild).toHaveBeenCalledWith(pixiShell.canvas);
  });
});
