import type { ServerMessage, WorldState } from "@agent-town/shared";
import { describe, expect, it, vi } from "vitest";

import { connect, getWebSocketUrl, type WebSocketLike } from "../src/net/wsClient.js";

class MockWebSocket implements WebSocketLike {
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  emit(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function makeWorld(): WorldState {
  return {
    tick: 0,
    width: 2,
    height: 1,
    tiles: [
      { terrain: "plains", resource: { kind: "food", amount: 3 } },
      { terrain: "forest", resource: { kind: "wood", amount: 5 } },
    ],
    agents: [],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
    collectives: [
      {
        id: "collective-grainMarket-1",
        purpose: "grainMarket",
        supporterIds: ["old-agent"],
        representativeId: "old-agent",
        cohesion: 0.5,
        formedAtTick: 1,
        provenance: {
          causedByEventIds: [],
          proposedByAgentIds: ["old-agent"],
          supportedByAgentIds: ["old-agent"],
          opposedByAgentIds: [],
          decidedAtTick: 1,
        },
      },
    ],
    institutions: [
      {
        id: "institution-grainMarket-2",
        kind: "grainMarket",
        supporterIds: ["old-agent"],
        opposedIds: [],
        establishedAtTick: 2,
        provenance: {
          causedByEventIds: [],
          proposedByAgentIds: ["old-agent"],
          supportedByAgentIds: ["old-agent"],
          opposedByAgentIds: [],
          decidedAtTick: 2,
        },
      },
    ],
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
    },
  };
}

describe("connect", () => {
  it("applies welcome and update messages to its local world state", () => {
    const socket = new MockWebSocket();
    const factory = vi.fn(() => socket);
    const onWelcome = vi.fn();
    const onUpdate = vi.fn();

    connect("ws://example.test", { onWelcome, onUpdate }, factory);
    socket.emit({ type: "welcome", state: makeWorld() });
    socket.emit({
      type: "update",
      tick: 4,
      agents: [
        {
          id: "ash",
          name: "トネリコ",
          pos: { x: 1, y: 0 },
          carrying: { kind: "wood", amount: 2 },
          activity: { kind: "idle" },
          tasks: [],
          planSource: "llm",
          llmProvider: "claude",
          thinking: true,
          lastThought: null,
          desires: { foodSecurity: 0 },
          lastHungerInterruptTick: null,
          hunger: 80,
          fatigue: 70,
          health: 90,
        },
      ],
      stockpile: { pos: { x: 0, y: 0 }, wood: 5, food: 1 },
      buildings: [{ kind: "house", pos: { x: 1, y: 0 }, progress: 400, complete: true }],
      deaths: [{ name: "シラカバ", tick: 4, cause: "starvation" }],
      collectives: [
        {
          id: "collective-communalGranaryStore-3",
          purpose: "communalGranaryStore",
          supporterIds: ["ash"],
          representativeId: "ash",
          cohesion: 0.78,
          formedAtTick: 3,
          provenance: {
            causedByEventIds: ["event-scarcity-1"],
            proposedByAgentIds: ["ash"],
            supportedByAgentIds: ["ash"],
            opposedByAgentIds: [],
            decidedAtTick: 3,
          },
        },
      ],
      institutions: [
        {
          id: "institution-communalGranaryStore-4",
          kind: "communalGranaryStore",
          supporterIds: ["ash"],
          opposedIds: [],
          establishedAtTick: 4,
          provenance: {
            causedByEventIds: ["event-scarcity-1"],
            proposedByAgentIds: ["ash"],
            supportedByAgentIds: ["ash"],
            opposedByAgentIds: [],
            decidedAtTick: 4,
          },
        },
      ],
      changedTiles: [{ index: 1, tile: { terrain: "forest", resource: null } }],
    });

    expect(factory).toHaveBeenCalledWith("ws://example.test");
    expect(onWelcome).toHaveBeenCalledWith(expect.objectContaining({ tick: 0 }));
    expect(onUpdate).toHaveBeenCalledWith({
      ...makeWorld(),
      tick: 4,
      agents: [
        {
          id: "ash",
          name: "トネリコ",
          pos: { x: 1, y: 0 },
          carrying: { kind: "wood", amount: 2 },
          activity: { kind: "idle" },
          tasks: [],
          planSource: "llm",
          llmProvider: "claude",
          thinking: true,
          lastThought: null,
          desires: { foodSecurity: 0 },
          lastHungerInterruptTick: null,
          hunger: 80,
          fatigue: 70,
          health: 90,
        },
      ],
      stockpile: { pos: { x: 0, y: 0 }, wood: 5, food: 1 },
      buildings: [{ kind: "house", pos: { x: 1, y: 0 }, progress: 400, complete: true }],
      deaths: [{ name: "シラカバ", tick: 4, cause: "starvation" }],
      collectives: [
        {
          id: "collective-communalGranaryStore-3",
          purpose: "communalGranaryStore",
          supporterIds: ["ash"],
          representativeId: "ash",
          cohesion: 0.78,
          formedAtTick: 3,
          provenance: {
            causedByEventIds: ["event-scarcity-1"],
            proposedByAgentIds: ["ash"],
            supportedByAgentIds: ["ash"],
            opposedByAgentIds: [],
            decidedAtTick: 3,
          },
        },
      ],
      institutions: [
        {
          id: "institution-communalGranaryStore-4",
          kind: "communalGranaryStore",
          supporterIds: ["ash"],
          opposedIds: [],
          establishedAtTick: 4,
          provenance: {
            causedByEventIds: ["event-scarcity-1"],
            proposedByAgentIds: ["ash"],
            supportedByAgentIds: ["ash"],
            opposedByAgentIds: [],
            decidedAtTick: 4,
          },
        },
      ],
      tiles: [
        { terrain: "plains", resource: { kind: "food", amount: 3 } },
        { terrain: "forest", resource: null },
      ],
    });
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
