import {
  decodeClientMessage,
  decodeServerMessage,
  encodeMessage,
  type NationState,
  type NationWorldState,
  type ServerMessage,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

function nationFixture(): NationState {
  return {
    id: "realm",
    controller: "player",
    autoPilot: false,
    stocks: { food: 100, materials: 80, wealth: 60 },
    cities: [{ cityId: "realm-capital", population: 1_000, developmentLevel: 1 }],
    territoryCellCount: 12,
    population: 1_000,
    stability: 70,
    culture: 30,
    foodProduction: 15,
    materialProduction: 8,
    activeDirectives: [],
    prosperity: {
      population: 0.2,
      production: 0.3,
      wealth: 0.4,
      stability: 0.7,
      culture: 0.3,
      total: 350,
    },
    lastReport: null,
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

describe("wire protocol", () => {
  it("round-trips a welcome server message with the complete nation world", () => {
    const message: ServerMessage = { type: "welcome", state: worldFixture() };

    expect(decodeServerMessage(encodeMessage(message))).toEqual(message);
  });

  it("round-trips a clock heartbeat without carrying nation state", () => {
    const message: ServerMessage = {
      type: "clock",
      tick: 42,
      year: 1,
      season: "spring",
      speed: 4,
    };
    const decoded = decodeServerMessage(encodeMessage(message));

    expect(decoded).toEqual(message);
    expect("nations" in decoded).toBe(false);
    expect("state" in decoded).toBe(false);
  });

  it("round-trips a season boundary with nations and changed cells", () => {
    const message: ServerMessage = {
      type: "season",
      tick: 300,
      year: 1,
      season: "summer",
      nations: [nationFixture()],
      changedCells: [],
    };

    expect(decodeServerMessage(encodeMessage(message))).toEqual(message);
  });

  it("round-trips an orders acknowledgement with options and an accept-time id", () => {
    const message: ServerMessage = {
      type: "orders",
      tick: 17,
      nationId: "realm",
      autoPilot: false,
      options: [
        {
          kind: "clearFarmland",
          targetCityId: null,
          cost: { food: 10, materials: 5, wealth: 0 },
          seasons: 2,
          affinity: 0.5,
          blockedReason: null,
        },
      ],
      queued: { id: "directive-1", kind: "clearFarmland", targetCityId: null },
      chancellorChoice: {
        id: "chancellor-realm-300",
        kind: "clearFarmland",
        targetCityId: null,
      },
      rejected: null,
    };

    expect(decodeServerMessage(encodeMessage(message))).toEqual(message);
  });

  it("rejects a server message without a type", () => {
    expect(() => decodeServerMessage("{}")).toThrow("invalid server message");
  });

  it("rejects a welcome message without world history", () => {
    const state = worldFixture();
    const { history: _history, ...withoutHistory } = state;

    expect(() =>
      decodeServerMessage(JSON.stringify({ type: "welcome", state: withoutHistory })),
    ).toThrow("invalid server message");
  });

  it("rejects a welcome message without a world map", () => {
    const state = worldFixture();
    const { worldMap: _worldMap, ...historyWithoutMap } = state.history;

    expect(() =>
      decodeServerMessage(
        JSON.stringify({
          type: "welcome",
          state: { ...state, history: historyWithoutMap },
        }),
      ),
    ).toThrow("invalid server message");
  });

  it("rejects a season message without nations", () => {
    expect(() =>
      decodeServerMessage(
        JSON.stringify({
          type: "season",
          tick: 300,
          year: 1,
          season: "summer",
          changedCells: [],
        }),
      ),
    ).toThrow("invalid server message");
  });

  it("rejects a season message without changed cells", () => {
    expect(() =>
      decodeServerMessage(
        JSON.stringify({
          type: "season",
          tick: 300,
          year: 1,
          season: "summer",
          nations: [],
        }),
      ),
    ).toThrow("invalid server message");
  });

  it("rejects an orders message without the stable candidate list", () => {
    expect(() =>
      decodeServerMessage(
        JSON.stringify({
          type: "orders",
          tick: 0,
          nationId: "realm",
          autoPilot: true,
          queued: null,
          chancellorChoice: null,
          rejected: null,
        }),
      ),
    ).toThrow("invalid server message");
  });

  it("rejects an orders message whose chancellor choice has no id", () => {
    expect(() =>
      decodeServerMessage(
        JSON.stringify({
          type: "orders",
          tick: 0,
          nationId: "realm",
          autoPilot: true,
          options: [],
          queued: null,
          chancellorChoice: { kind: "clearFarmland", targetCityId: null },
          rejected: null,
        }),
      ),
    ).toThrow("invalid server message");
  });

  it("rejects an out-of-range speed before it reaches the server", () => {
    expect(() => decodeClientMessage('{"type":"setSpeed","speed":3}')).toThrow(
      "invalid client message",
    );
  });

  it.each([
    { type: "hello" },
    { type: "selectNation", nationId: "realm" },
    { type: "issueDirective", kind: "growCity", targetCityId: "realm-capital" },
    { type: "cancelDirective", directiveId: "directive-1" },
    { type: "setSpeed", speed: 0 },
    { type: "setAutoPilot", enabled: false },
  ] as const)("decodes the client message $type", (message) => {
    expect(decodeClientMessage(JSON.stringify(message))).toEqual(message);
  });
});
