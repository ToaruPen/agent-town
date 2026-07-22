import { createServer } from "node:net";

import { decodeServerMessage, MAP_HEIGHT, MAP_WIDTH, type ServerMessage } from "@agent-town/shared";
import { describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

import { startServer } from "../src/net/wsServer.js";

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
  it("sends welcome and tick updates and closes cleanly", async () => {
    const port = await getEphemeralPort();
    const server = startServer({ port, seed: 42 });
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    let serverClosed = false;

    try {
      const [welcome, update] = await receiveMessages(socket, 2);

      expect(welcome?.type).toBe("welcome");
      if (welcome?.type !== "welcome") throw new Error("first message was not welcome");
      expect(welcome.state.tiles).toHaveLength(MAP_WIDTH * MAP_HEIGHT);
      expect(welcome.state.agents).toHaveLength(3);

      expect(update?.type).toBe("update");
      if (update?.type !== "update") throw new Error("second message was not update");
      expect(update.tick).toBeGreaterThan(welcome.state.tick);

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
});
