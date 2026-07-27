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
  it("boots an empty nearest-neighbour Pixi application after preloading resident sprites", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { body: { appendChild: pixiShell.appendChild } });

    await expect(import("../src/main.js")).resolves.toBeDefined();

    expect(pixiShell.load).toHaveBeenCalledWith([...SPRITE_PATHS]);
    expect(pixiShell.init).toHaveBeenCalledWith({
      background: 0x1d2428,
      resizeTo: window,
    });
    expect(pixiShell.appendChild).toHaveBeenCalledWith(pixiShell.canvas);
  });
});
