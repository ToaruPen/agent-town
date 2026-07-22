import { encodeMessage, type ServerMessage, TICK_RATE } from "@agent-town/shared";
import WebSocket, { WebSocketServer } from "ws";

import { createEngine } from "../sim/engine.js";
import { FakePlanner } from "../sim/fakePlanner.js";
import { createRng } from "../sim/rng.js";
import { generateWorld } from "../sim/worldGen.js";

export interface ServerHandle {
  close(): Promise<void>;
}

function updateMessage(engine: ReturnType<typeof createEngine>): ServerMessage {
  const changedTiles = engine.drainDirtyTiles().map((index) => {
    const tile = engine.world.tiles[index];
    if (tile === undefined) throw new Error(`dirty tile index out of bounds: ${index}`);
    return { index, tile };
  });

  return {
    type: "update",
    tick: engine.world.tick,
    agents: engine.world.agents,
    stockpile: engine.world.stockpile,
    changedTiles,
  };
}

function broadcast(server: WebSocketServer, message: ServerMessage): void {
  const payload = encodeMessage(message);
  for (const client of server.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function closeServer(server: WebSocketServer, interval: NodeJS.Timeout): Promise<void> {
  clearInterval(interval);
  for (const client of server.clients) client.terminate();

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function startServer(opts: { port: number; seed: number }): ServerHandle {
  const rng = createRng(opts.seed);
  const engine = createEngine(generateWorld(opts.seed), new FakePlanner(rng), rng);
  const server = new WebSocketServer({ port: opts.port });

  server.on("connection", (socket) => {
    const welcome: ServerMessage = { type: "welcome", state: engine.world };
    socket.send(encodeMessage(welcome));
  });

  const interval = setInterval(() => {
    engine.step();
    broadcast(server, updateMessage(engine));
  }, 1_000 / TICK_RATE);

  return {
    close: () => closeServer(server, interval),
  };
}
