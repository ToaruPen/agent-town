import { createServer } from "node:net";

import {
  DAYS_PER_SEASON,
  decodeServerMessage,
  HOUSE_BUILD_TICKS,
  IMMIGRANT_NAMES,
  MAP_HEIGHT,
  MAP_WIDTH,
  SEASONS,
  type ServerMessage,
  TICKS_PER_DAY,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

import { createUpdateMessage, startServer } from "../src/net/wsServer.js";
import { createEngine } from "../src/sim/engine.js";
import type { Planner } from "../src/sim/fakePlanner.js";
import { generateWorld } from "../src/sim/worldGen.js";

function getEphemeralPort(): Promise<number> {
  const probe = createServer();

  return new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("failed to reserve an ephemeral port"));
        return;
      }

      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function receiveMessages(socket: WebSocket, count: number): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    const timeout = setTimeout(
      () => reject(new Error(`received only ${messages.length} messages`)),
      2_000,
    );

    socket.on("error", reject);
    socket.on("message", (raw: RawData) => {
      try {
        messages.push(decodeServerMessage(raw.toString()));
      } catch (error) {
        reject(error);
        return;
      }

      if (messages.length === count) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });
  });
}

describe("startServer", () => {
  it("includes a spring-boundary immigrant in the same-step broadcast update", () => {
    const world = generateWorld(42);
    const agent = world.agents[0];
    if (agent === undefined) throw new Error("missing test agent");
    world.agents = [agent];
    agent.tasks = [{ kind: "deposit" }];
    world.stockpile.food = 1_000;
    world.buildings = [
      {
        kind: "house",
        pos: { x: world.stockpile.pos.x + 2, y: world.stockpile.pos.y },
        progress: HOUSE_BUILD_TICKS,
        complete: true,
      },
    ];
    world.tick = DAYS_PER_SEASON * SEASONS.length * TICKS_PER_DAY - 1;
    world.collectives = [
      {
        id: "collective-communalGranaryStore-150",
        purpose: "communalGranaryStore",
        supporterIds: ["agent-1"],
        representativeId: "agent-1",
        cohesion: 0.78,
        formedAtTick: 150,
        provenance: {
          causedByEventIds: ["event-scarcity-1"],
          proposedByAgentIds: ["agent-1"],
          supportedByAgentIds: ["agent-1"],
          opposedByAgentIds: [],
          decidedAtTick: 150,
        },
      },
    ];
    world.institutions = [
      {
        id: "institution-communalGranaryStore-200",
        kind: "communalGranaryStore",
        supporterIds: ["agent-1"],
        opposedIds: [],
        establishedAtTick: 200,
        provenance: {
          causedByEventIds: ["event-scarcity-1"],
          proposedByAgentIds: ["agent-1"],
          supportedByAgentIds: ["agent-1"],
          opposedByAgentIds: [],
          decidedAtTick: 200,
        },
      },
    ];
    const idlePlanner: Planner = { plan: () => [] };
    const engine = createEngine(world, idlePlanner, () => 0);

    engine.step();
    const update = createUpdateMessage(engine);

    expect(update).toMatchObject({
      type: "update",
      collectives: world.collectives,
      institutions: world.institutions,
    });
    expect(update.type).toBe("update");
    if (update.type !== "update") throw new Error("expected update message");
    expect(update.agents.map(({ name }) => name)).toEqual(["トネリコ", IMMIGRANT_NAMES[0]]);
    expect(update.collectives).toEqual(world.collectives);
    expect(update.institutions).toEqual(world.institutions);
  });

  it("accepts /ws upgrades, sends updates, and closes cleanly", async () => {
    const port = await getEphemeralPort();
    const server = startServer({ port, seed: 42 });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let serverClosed = false;

    try {
      const [welcome, update] = await receiveMessages(socket, 2);

      expect(welcome?.type).toBe("welcome");
      if (welcome?.type !== "welcome") throw new Error("first message was not welcome");
      expect(welcome.state.tiles).toHaveLength(MAP_WIDTH * MAP_HEIGHT);
      expect(welcome.state.agents).toHaveLength(3);
      expect(welcome.state.agents[0]).toMatchObject({
        planSource: "fake",
        llmProvider: null,
        thinking: false,
      });

      expect(update?.type).toBe("update");
      if (update?.type !== "update") throw new Error("second message was not update");
      expect(update.tick).toBeGreaterThan(welcome.state.tick);
      expect(update.agents[0]).toMatchObject({
        planSource: "fake",
        llmProvider: null,
        thinking: false,
      });
      expect(update.buildings).toEqual(welcome.state.buildings);
      expect(update.deaths).toEqual(welcome.state.deaths);

      const socketClosed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      await expect(server.close()).resolves.toBeUndefined();
      serverClosed = true;
      await socketClosed;
      expect(socket.readyState).toBe(WebSocket.CLOSED);
    } finally {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      if (!serverClosed) await server.close();
    }
  });

  it("rejects WebSocket upgrades outside /ws", async () => {
    const port = await getEphemeralPort();
    const server = startServer({ port, seed: 42 });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`);

    try {
      await expect(
        new Promise<void>((resolve, reject) => {
          socket.once("error", () => resolve());
          socket.once("open", () => reject(new Error("unexpected WebSocket connection")));
        }),
      ).resolves.toBeUndefined();
    } finally {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      await server.close();
    }
  });
});
