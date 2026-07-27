import {
  type ServerMessage,
  type SpatialDemand,
  TRAIL_LEVEL_WEAR,
  type TrailCell,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it, vi } from "vitest";

import { connect, getWebSocketUrl, type WebSocketLike } from "../src/net/wsClient.js";
import { makeTrailCellsFixture } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

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
    spatialDemands: [],
    trailCells: makeTrailCellsFixture(2, 1),
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
      worldMap: makeWorldMapFixture(),
    },
  };
}

/** The single cell a hauling route wore in, which is all a sparse update carries. */
function makeWornTrailCellFixture(): TrailCell {
  return {
    ...makeTrailCellsFixture(1, 1)[0],
    wear: TRAIL_LEVEL_WEAR.trail,
    level: "trail",
    passagesToday: 8,
    dominantPurpose: "facilityService",
    causedByFacilityIds: ["facility-institution-communalGranaryStore-200"],
    lastUsedAtTick: 200,
  } as TrailCell;
}

function makeDemandFixture(): SpatialDemand {
  return {
    id: "demand-institution-communalGranaryStore-200",
    facilityKind: "communalGranary",
    source: { kind: "institution", id: "institution-communalGranaryStore-200" },
    supporterIds: ["ash"],
    requiredWood: 15,
    requiredLabor: 240,
    status: "building",
    blockedReason: null,
    site: { x: 1, y: 0 },
    siteRationale: { score: 1, contributions: [] },
    provenance: {
      causedByEventIds: [],
      proposedByAgentIds: ["ash"],
      supportedByAgentIds: ["ash"],
      opposedByAgentIds: [],
      decidedAtTick: 4,
    },
  };
}

function makeUpdate(
  overrides: Pick<
    Extract<ServerMessage, { type: "update" }>,
    "spatialDemands" | "changedTrailCells"
  >,
): ServerMessage {
  return {
    type: "update",
    tick: 5,
    agents: [],
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    changedTiles: [],
    ...overrides,
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
          rationStrain: 0,
          lastRationTick: null,
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
      spatialDemands: [],
      changedTrailCells: [],
    });

    const welcomedState = onWelcome.mock.calls[0]?.[0];
    const updatedState = onUpdate.mock.calls[0]?.[0];
    expect(factory).toHaveBeenCalledWith("ws://example.test");
    expect(onWelcome).toHaveBeenCalledWith(expect.objectContaining({ tick: 0 }));
    expect(updatedState?.history).toBe(welcomedState?.history);
    expect(updatedState?.history.worldMap).toEqual(makeWorld().history.worldMap);
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
          rationStrain: 0,
          lastRationTick: null,
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

  it("replaces only the trail cells an update names and keeps the rest by reference", () => {
    const socket = new MockWebSocket();
    const onWelcome = vi.fn();
    const onUpdate = vi.fn();
    const worn = makeWornTrailCellFixture();
    const demand = makeDemandFixture();

    connect("ws://example.test", { onWelcome, onUpdate }, () => socket);
    socket.emit({ type: "welcome", state: makeWorld() });
    socket.emit(
      makeUpdate({ spatialDemands: [demand], changedTrailCells: [{ index: 1, cell: worn }] }),
    );
    socket.emit(makeUpdate({ spatialDemands: [demand], changedTrailCells: [] }));

    const welcomed = onWelcome.mock.calls[0]?.[0];
    const first = onUpdate.mock.calls[0]?.[0];
    const second = onUpdate.mock.calls[1]?.[0];
    expect(first?.trailCells[0]).toBe(welcomed?.trailCells[0]);
    expect(first?.trailCells[1]).toEqual(worn);
    expect(first?.trailCells).not.toBe(welcomed?.trailCells);
    expect(first?.spatialDemands).toEqual([demand]);
    expect(first?.history).toBe(welcomed?.history);
    expect(second?.trailCells).toBe(first?.trailCells);
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
