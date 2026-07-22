import { describe, expect, it } from "vitest";

import {
  decodeClientMessage,
  decodeServerMessage,
  encodeMessage,
  type ServerMessage,
} from "../src/protocol.js";
import type { WorldState } from "../src/world.js";

describe("wire protocol", () => {
  it("round-trips a welcome server message", () => {
    const state: WorldState = {
      tick: 0,
      width: 1,
      height: 1,
      tiles: [{ terrain: "plains", resource: null }],
      agents: [
        {
          id: "agent-1",
          name: "Ash",
          pos: { x: 0, y: 0 },
          carrying: null,
          activity: { kind: "idle" },
          tasks: [],
          planSource: "llm",
          thinking: true,
          lastThought: "Gather nearby wood before winter.",
        },
      ],
      stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    };
    const message: ServerMessage = { type: "welcome", state };

    expect(decodeServerMessage(encodeMessage(message))).toEqual(message);
  });

  it("rejects a server message without a type", () => {
    expect(() => decodeServerMessage("{}")).toThrow("invalid server message");
  });

  it("decodes a hello client message", () => {
    expect(decodeClientMessage('{"type":"hello"}')).toEqual({ type: "hello" });
  });
});
