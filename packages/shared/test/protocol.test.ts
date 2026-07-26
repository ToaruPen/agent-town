import { describe, expect, it } from "vitest";
import { TRAIL_LEVEL_WEAR } from "../src/constants.js";
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeMessage,
  type ServerMessage,
} from "../src/protocol.js";
import type { TrailCell } from "../src/spatial.js";
import type { WorldState } from "../src/world.js";
import { makeDemandFixture, makeFacilityFixture, makeTrailCellsFixture } from "./spatialFixture.js";

/** The one cell a hauling route wore into a trail, which is all an update carries. */
function makeWornTrailCell(): TrailCell {
  return {
    wear: TRAIL_LEVEL_WEAR.trail,
    level: "trail",
    passagesToday: 8,
    purposeWear: {
      survival: 0,
      gathering: 0,
      construction: 0,
      facilityService: TRAIL_LEVEL_WEAR.trail,
      wandering: 0,
    },
    dominantPurpose: "facilityService",
    facilityWear: { "facility-institution-communalGranary": TRAIL_LEVEL_WEAR.trail },
    causedByFacilityIds: ["facility-institution-communalGranary"],
    lastUsedAtTick: 200,
  };
}

describe("wire protocol", () => {
  it("round-trips a welcome server message", () => {
    const state: WorldState = {
      tick: 0,
      width: 1,
      height: 1,
      tiles: [{ terrain: "plains", resource: null, resourceOrigin: "food" }],
      agents: [
        {
          id: "agent-1",
          name: "トネリコ",
          pos: { x: 0, y: 0 },
          carrying: null,
          activity: { kind: "idle" },
          tasks: [],
          planSource: "llm",
          llmProvider: "codex",
          thinking: true,
          lastThought: "Gather nearby wood before winter.",
          desires: { foodSecurity: 0.72 },
          lastHungerInterruptTick: 120,
          hunger: 42,
          fatigue: 37,
          health: 88,
          rationStrain: 0.16,
          lastRationTick: 900,
        },
      ],
      stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
      buildings: [
        { kind: "house", pos: { x: 0, y: 0 }, progress: 12, complete: false },
        { ...makeFacilityFixture("communalGranary", 0), progress: 0, complete: false },
      ],
      deaths: [{ name: "シラカバ", tick: 7200, cause: "starvation" }],
      spatialDemands: [makeDemandFixture("communalGranary")],
      trailCells: makeTrailCellsFixture(1, 1),
      collectives: [
        {
          id: "collective-communalGranaryStore-150",
          purpose: "communalGranaryStore",
          supporterIds: ["agent-1", "agent-2"],
          representativeId: "agent-1",
          cohesion: 0.78,
          formedAtTick: 150,
          provenance: {
            causedByEventIds: ["event-scarcity-1"],
            proposedByAgentIds: ["agent-1"],
            supportedByAgentIds: ["agent-1", "agent-2"],
            opposedByAgentIds: [],
            decidedAtTick: 150,
          },
        },
      ],
      institutions: [
        {
          id: "institution-communalGranaryStore-200",
          kind: "communalGranaryStore",
          supporterIds: ["agent-1", "agent-2"],
          opposedIds: [],
          establishedAtTick: 200,
          provenance: {
            causedByEventIds: ["event-scarcity-1"],
            proposedByAgentIds: ["agent-1"],
            supportedByAgentIds: ["agent-1", "agent-2"],
            opposedByAgentIds: [],
            decidedAtTick: 200,
          },
        },
      ],
      history: {
        startYear: -200,
        currentYear: 0,
        polities: [],
        events: [],
        landmarks: [],
        settlementOrigin: null,
        worldMap: {
          width: 96,
          height: 64,
          cells: Array.from({ length: 96 * 64 }, (_, index) => ({
            terrain: index === 97 ? "plains" : "sea",
            polityId: null,
          })),
          cities: [],
          tradeRoutes: [],
          borderChanges: [],
          settlementFrontierPos: { x: 1, y: 1 },
        },
      },
    };
    const message: ServerMessage = { type: "welcome", state };
    const decoded = decodeServerMessage(encodeMessage(message));

    expect(decoded).toEqual(message);
    expect(decoded.type === "welcome" ? decoded.state.tiles[0]?.resourceOrigin : null).toBe("food");
    expect(
      decoded.type === "welcome" ? decoded.state.history.worldMap.settlementFrontierPos : null,
    ).toEqual({ x: 1, y: 1 });
  });

  it("round-trips an update server message with social state", () => {
    const message: ServerMessage = {
      type: "update",
      tick: 200,
      agents: [],
      stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
      buildings: [makeFacilityFixture("communalGranary", 12)],
      deaths: [],
      changedTiles: [],
      spatialDemands: [makeDemandFixture("communalGranary")],
      changedTrailCells: [{ index: 1, cell: makeWornTrailCell() }],
      collectives: [
        {
          id: "collective-communalGranaryStore-150",
          purpose: "communalGranaryStore",
          supporterIds: ["agent-1", "agent-2"],
          representativeId: "agent-1",
          cohesion: 0.78,
          formedAtTick: 150,
          provenance: {
            causedByEventIds: ["event-scarcity-1"],
            proposedByAgentIds: ["agent-1"],
            supportedByAgentIds: ["agent-1", "agent-2"],
            opposedByAgentIds: [],
            decidedAtTick: 150,
          },
        },
      ],
      institutions: [
        {
          id: "institution-communalGranaryStore-200",
          kind: "communalGranaryStore",
          supporterIds: ["agent-1", "agent-2"],
          opposedIds: [],
          establishedAtTick: 200,
          provenance: {
            causedByEventIds: ["event-scarcity-1"],
            proposedByAgentIds: ["agent-1"],
            supportedByAgentIds: ["agent-1", "agent-2"],
            opposedByAgentIds: [],
            decidedAtTick: 200,
          },
        },
      ],
    };

    expect(decodeServerMessage(encodeMessage(message))).toEqual(message);
  });

  it("rejects a server message without a type", () => {
    expect(() => decodeServerMessage("{}")).toThrow("invalid server message");
  });

  it("rejects a welcome message without world history", () => {
    const welcomeWithoutHistory = JSON.stringify({
      type: "welcome",
      state: {
        tick: 0,
        width: 1,
        height: 1,
        tiles: [],
        agents: [],
        stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
        buildings: [],
        deaths: [],
      },
    });

    expect(() => decodeServerMessage(welcomeWithoutHistory)).toThrow("invalid server message");
  });

  it("rejects a welcome message without a world map", () => {
    const validWelcome: ServerMessage = {
      type: "welcome",
      state: {
        tick: 0,
        width: 1,
        height: 1,
        tiles: [],
        agents: [],
        stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
        buildings: [],
        deaths: [],
        collectives: [],
        institutions: [],
        spatialDemands: [],
        trailCells: makeTrailCellsFixture(1, 1),
        history: {
          startYear: -200,
          currentYear: 0,
          polities: [],
          events: [],
          landmarks: [],
          settlementOrigin: null,
          worldMap: {
            width: 96,
            height: 64,
            cells: Array.from({ length: 96 * 64 }, (_, index) => ({
              terrain: index === 97 ? "plains" : "sea",
              polityId: null,
            })),
            cities: [],
            tradeRoutes: [],
            borderChanges: [],
            settlementFrontierPos: { x: 1, y: 1 },
          },
        },
      },
    };
    const encoded = JSON.parse(encodeMessage(validWelcome));

    delete encoded.state.history.worldMap;

    expect(() => decodeServerMessage(JSON.stringify(encoded))).toThrow("invalid server message");
  });

  it("rejects an update without death history", () => {
    const updateWithoutDeaths = JSON.stringify({
      type: "update",
      tick: 1,
      agents: [],
      stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
      changedTiles: [],
    });

    expect(() => decodeServerMessage(updateWithoutDeaths)).toThrow("invalid server message");
  });

  it("rejects an update without buildings", () => {
    const updateWithoutBuildings = JSON.stringify({
      type: "update",
      tick: 1,
      agents: [],
      stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
      deaths: [],
      changedTiles: [],
    });

    expect(() => decodeServerMessage(updateWithoutBuildings)).toThrow("invalid server message");
  });

  it("rejects an update without collectives", () => {
    const updateWithoutCollectives = JSON.stringify({
      type: "update",
      tick: 1,
      agents: [],
      stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
      buildings: [],
      deaths: [],
      institutions: [],
      changedTiles: [],
    });

    expect(() => decodeServerMessage(updateWithoutCollectives)).toThrow("invalid server message");
  });

  it("rejects an update without institutions", () => {
    const updateWithoutInstitutions = JSON.stringify({
      type: "update",
      tick: 1,
      agents: [],
      stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
      buildings: [],
      deaths: [],
      collectives: [],
      changedTiles: [],
    });

    expect(() => decodeServerMessage(updateWithoutInstitutions)).toThrow("invalid server message");
  });

  it("rejects an update without spatial demands", () => {
    const updateWithoutDemands = JSON.stringify({
      type: "update",
      tick: 1,
      agents: [],
      stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
      buildings: [],
      deaths: [],
      collectives: [],
      institutions: [],
      changedTiles: [],
      changedTrailCells: [],
    });

    expect(() => decodeServerMessage(updateWithoutDemands)).toThrow("invalid server message");
  });

  it("rejects an update without changed trail cells", () => {
    const updateWithoutTrails = JSON.stringify({
      type: "update",
      tick: 1,
      agents: [],
      stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
      buildings: [],
      deaths: [],
      collectives: [],
      institutions: [],
      spatialDemands: [],
      changedTiles: [],
    });

    expect(() => decodeServerMessage(updateWithoutTrails)).toThrow("invalid server message");
  });

  it("decodes a hello client message", () => {
    expect(decodeClientMessage('{"type":"hello"}')).toEqual({ type: "hello" });
  });
});
