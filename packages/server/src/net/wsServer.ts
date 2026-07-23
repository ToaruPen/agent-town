import { createServer, type Server as HttpServer } from "node:http";
import { encodeMessage, type ServerMessage, TICK_RATE } from "@agent-town/shared";
import WebSocket, { WebSocketServer } from "ws";

import { CliClaudeRunner } from "../llm/claudeRunner.js";
import { llmAgentIdsForWorld, parseLlmAgentSelection } from "../llm/llmAgentSelection.js";
import { LlmPlanner } from "../llm/llmPlanner.js";
import { ThoughtBroker } from "../llm/thoughtBroker.js";
import { createEngine, type Engine } from "../sim/engine.js";
import { FakePlanner } from "../sim/fakePlanner.js";
import { createRng } from "../sim/rng.js";
import { generateWorld } from "../sim/worldGen.js";
import { createStaticHandler } from "./staticServer.js";

const WEBSOCKET_PATH = "/ws";

export interface ServerHandle {
  close(): Promise<void>;
}

interface ServerOptions {
  port: number;
  seed: number;
  llmPlannerEnabled?: boolean;
  llmAgents?: string;
  staticDir?: string;
}

export function createUpdateMessage(engine: ReturnType<typeof createEngine>): ServerMessage {
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
    buildings: engine.world.buildings,
    deaths: engine.world.deaths,
    changedTiles,
  };
}

function broadcast(server: WebSocketServer, message: ServerMessage): void {
  const payload = encodeMessage(message);
  for (const client of server.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function closeServer(
  httpServer: HttpServer,
  socketServer: WebSocketServer,
  interval: NodeJS.Timeout,
): Promise<void> {
  clearInterval(interval);
  for (const client of socketServer.clients) client.terminate();
  await Promise.all([closeWebSocketServer(socketServer), closeHttpServer(httpServer)]);
}

function createWebSocketServer(httpServer: HttpServer, path: string): WebSocketServer {
  const socketServer = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    if (requestPath !== path) {
      socket.destroy();
      return;
    }
    socketServer.handleUpgrade(request, socket, head, (client) => {
      socketServer.emit("connection", client, request);
    });
  });

  return socketServer;
}

function createThoughtBroker(
  enabled: boolean,
  engine: Engine,
  fallback: FakePlanner,
  llmAgents: string | undefined,
): ThoughtBroker | undefined {
  if (!enabled) return undefined;
  const planner = new LlmPlanner("claude", new CliClaudeRunner(), fallback);
  const selection = parseLlmAgentSelection(llmAgents, engine.world.agents);
  return new ThoughtBroker({
    engine,
    llmAgentIds: () => llmAgentIdsForWorld(selection, engine.world.agents),
    planFn: (world, agent) => planner.planAsync(world, agent),
  });
}

export function startServer(opts: ServerOptions): ServerHandle {
  const rng = createRng(opts.seed);
  const fallback = new FakePlanner(rng);
  const engine = createEngine(generateWorld(opts.seed), fallback, rng);
  const broker = createThoughtBroker(
    opts.llmPlannerEnabled === true,
    engine,
    fallback,
    opts.llmAgents,
  );
  const httpServer = createServer(createStaticHandler(opts.staticDir));
  const socketServer = createWebSocketServer(httpServer, WEBSOCKET_PATH);

  socketServer.on("connection", (socket) => {
    const welcome: ServerMessage = { type: "welcome", state: engine.world };
    socket.send(encodeMessage(welcome));
  });

  const interval = setInterval(() => {
    engine.step();
    broker?.onTick();
    broadcast(socketServer, createUpdateMessage(engine));
  }, 1_000 / TICK_RATE);

  httpServer.listen(opts.port);

  return {
    close: () => closeServer(httpServer, socketServer, interval),
  };
}
