import { createServer, type Server as HttpServer } from "node:http";

import {
  CLOCK_BROADCAST_MS,
  type ClientMessage,
  DEFAULT_SPEED,
  type DirectiveBlockedReason,
  type DirectiveId,
  type DirectiveOption,
  decodeClientMessage,
  encodeMessage,
  NATION_TICKS_PER_SEASON,
  type NationId,
  type NationState,
  type NationWorldState,
  nationSeasonOfTick,
  nationYearOfTick,
  type ServerMessage,
  SPEED_MULTIPLIERS,
  type SpeedMultiplier,
  TICK_RATE,
} from "@agent-town/shared";
import WebSocket, { WebSocketServer } from "ws";

import { generateWorldHistory } from "../sim/historyGen.js";
import { bootstrapNations } from "../sim/nation/bootstrap.js";
import { chooseDirective } from "../sim/nation/chancellor.js";
import { listDirectiveOptions } from "../sim/nation/directives.js";
import {
  advanceNationEngine,
  chancellorDirectiveId,
  type NationEngineState,
  type QueuedDirective,
} from "../sim/nation/engine.js";
import { createStaticHandler } from "./staticServer.js";

const WEBSOCKET_PATH = "/ws";

export interface ServerHandle {
  close(): Promise<void>;
}

interface ServerOptions {
  port: number;
  seed: number;
  staticDir?: string;
}

export interface NationSession {
  nationId: NationId | null;
}

export interface RuntimeEmission {
  session: NationSession | null;
  message: ServerMessage;
}

export interface NationServerRuntime {
  createSession(): NationSession;
  removeSession(session: NationSession): void;
  worldState(): NationWorldState;
  clockMessage(): ServerMessage;
  handleClientMessage(session: NationSession, message: ClientMessage): ServerMessage[];
  advanceTicks(count: number): RuntimeEmission[];
  advancePaced(): RuntimeEmission[];
}

type OrderRejection = DirectiveBlockedReason | "notYourNation" | "unknownNation" | null;

function nextSeasonBoundaryTick(tick: number): number {
  return tick - (tick % NATION_TICKS_PER_SEASON) + NATION_TICKS_PER_SEASON;
}

class DefaultNationServerRuntime implements NationServerRuntime {
  private readonly history;
  private readonly sessions = new Set<NationSession>();
  private engineState: NationEngineState;
  private speed: SpeedMultiplier = DEFAULT_SPEED;
  private playerNationId: NationId | null = null;
  private queued: QueuedDirective | null = null;
  private nextDirectiveNumber = 1;

  constructor(seed: number) {
    this.history = generateWorldHistory(seed);
    this.engineState = {
      tick: 0,
      nations: bootstrapNations(this.history, null),
    };
  }

  createSession(): NationSession {
    const session = { nationId: this.playerNationId };
    this.sessions.add(session);
    return session;
  }

  removeSession(session: NationSession): void {
    this.sessions.delete(session);
  }

  worldState(): NationWorldState {
    return {
      tick: this.engineState.tick,
      year: nationYearOfTick(this.engineState.tick),
      season: nationSeasonOfTick(this.engineState.tick),
      speed: this.speed,
      history: this.history,
      nations: this.engineState.nations,
      playerNationId: this.playerNationId,
    };
  }

  clockMessage(): ServerMessage {
    const state = this.worldState();
    return {
      type: "clock",
      tick: state.tick,
      year: state.year,
      season: state.season,
      speed: state.speed,
    };
  }

  private nation(nationId: NationId | null): NationState | undefined {
    return this.engineState.nations.find(({ id }) => id === nationId);
  }

  private options(nation: NationState): DirectiveOption[] {
    const polity = this.history.polities.find(({ id }) => id === nation.id);
    if (polity === undefined) throw new Error(`missing polity for nation ${nation.id}`);
    return listDirectiveOptions(nation, polity, this.history.worldMap);
  }

  private orders(session: NationSession, rejected: OrderRejection): ServerMessage | null {
    const nation = this.nation(session.nationId);
    if (nation === undefined) return null;
    const polity = this.history.polities.find(({ id }) => id === nation.id);
    if (polity === undefined) throw new Error(`missing polity for nation ${nation.id}`);
    const options = this.options(nation);
    const choice = chooseDirective(nation, polity, options, nation.lastReport);
    const queued =
      this.queued?.nationId === nation.id
        ? {
            id: this.queued.id,
            kind: this.queued.kind,
            targetCityId: this.queued.targetCityId,
          }
        : null;
    return {
      type: "orders",
      tick: this.engineState.tick,
      nationId: nation.id,
      autoPilot: nation.autoPilot,
      options,
      queued,
      chancellorChoice:
        choice === null
          ? null
          : {
              id: chancellorDirectiveId(nation.id, nextSeasonBoundaryTick(this.engineState.tick)),
              kind: choice.kind,
              targetCityId: choice.targetCityId,
            },
      rejected,
    };
  }

  private ownNation(session: NationSession): NationState | undefined {
    if (session.nationId !== this.playerNationId) return undefined;
    return this.nation(session.nationId);
  }

  private selectNation(session: NationSession, nationId: NationId): ServerMessage[] {
    if (this.nation(nationId) === undefined) return [];
    this.playerNationId = nationId;
    session.nationId = nationId;
    this.queued = null;
    this.engineState = {
      ...this.engineState,
      nations: this.engineState.nations.map((nation) => ({
        ...nation,
        controller: nation.id === nationId ? "player" : "agent",
      })),
    };
    const orders = this.orders(session, null);
    return orders === null ? [] : [orders];
  }

  private issueDirective(
    session: NationSession,
    message: Extract<ClientMessage, { type: "issueDirective" }>,
  ): ServerMessage[] {
    const nation = this.ownNation(session);
    if (nation === undefined) return this.ordersResult(session, "notYourNation");
    const option = this.options(nation).find(
      (candidate) =>
        candidate.kind === message.kind && candidate.targetCityId === message.targetCityId,
    );
    if (option === undefined) return this.ordersResult(session, "notYourNation");
    if (option.blockedReason !== null) {
      return this.ordersResult(session, option.blockedReason);
    }
    this.queued = {
      id: `directive-${this.nextDirectiveNumber}`,
      nationId: nation.id,
      kind: option.kind,
      targetCityId: option.targetCityId,
      issuedAtTick: this.engineState.tick,
    };
    this.nextDirectiveNumber += 1;
    return this.ordersResult(session, null);
  }

  private ordersResult(session: NationSession, rejected: OrderRejection): ServerMessage[] {
    const orders = this.orders(session, rejected);
    return orders === null ? [] : [orders];
  }

  private cancelDirective(session: NationSession, directiveId: DirectiveId): ServerMessage[] {
    const nation = this.ownNation(session);
    if (nation === undefined) return this.ordersResult(session, "notYourNation");
    if (this.queued?.id === directiveId && this.queued.nationId === nation.id) {
      this.queued = null;
      return this.ordersResult(session, null);
    }
    const active = nation.activeDirectives.some(({ id }) => id === directiveId);
    if (active) {
      this.engineState = {
        ...this.engineState,
        nations: this.engineState.nations.map((candidate) =>
          candidate.id === nation.id
            ? {
                ...candidate,
                activeDirectives: candidate.activeDirectives.filter(({ id }) => id !== directiveId),
              }
            : candidate,
        ),
      };
      return this.ordersResult(session, null);
    }
    const belongsToRival = this.engineState.nations.some(
      (candidate) =>
        candidate.id !== nation.id &&
        candidate.activeDirectives.some(({ id }) => id === directiveId),
    );
    return this.ordersResult(session, belongsToRival ? "notYourNation" : "unknownNation");
  }

  private setAutoPilot(session: NationSession, enabled: boolean): ServerMessage[] {
    const nation = this.ownNation(session);
    if (nation === undefined) return this.ordersResult(session, "notYourNation");
    this.engineState = {
      ...this.engineState,
      nations: this.engineState.nations.map((candidate) =>
        candidate.id === nation.id ? { ...candidate, autoPilot: enabled } : candidate,
      ),
    };
    return this.ordersResult(session, null);
  }

  private setSpeed(speed: SpeedMultiplier): void {
    if (SPEED_MULTIPLIERS.some((candidate) => candidate === speed)) this.speed = speed;
  }

  handleClientMessage(session: NationSession, message: ClientMessage): ServerMessage[] {
    switch (message.type) {
      case "hello":
        return [];
      case "selectNation":
        return this.selectNation(session, message.nationId);
      case "issueDirective":
        return this.issueDirective(session, message);
      case "cancelDirective":
        return this.cancelDirective(session, message.directiveId);
      case "setSpeed":
        this.setSpeed(message.speed);
        return [];
      case "setAutoPilot":
        return this.setAutoPilot(session, message.enabled);
    }
  }

  private advanceOneTick(): RuntimeEmission[] {
    const result = advanceNationEngine(
      this.engineState,
      this.history,
      this.queued === null ? [] : [this.queued],
    );
    this.engineState = result.state;
    if (this.queued !== null && result.consumedQueuedDirectiveIds.includes(this.queued.id)) {
      this.queued = null;
    }
    if (result.reports.size === 0) return [];
    const state = this.worldState();
    const emissions: RuntimeEmission[] = [
      {
        session: null,
        message: {
          type: "season",
          tick: state.tick,
          year: state.year,
          season: state.season,
          nations: state.nations,
          changedCells: [],
        },
      },
    ];
    for (const session of this.sessions) {
      const orders = this.orders(session, null);
      if (orders !== null) emissions.push({ session, message: orders });
    }
    return emissions;
  }

  advanceTicks(count: number): RuntimeEmission[] {
    const emissions: RuntimeEmission[] = [];
    for (let step = 0; step < count; step += 1) emissions.push(...this.advanceOneTick());
    return emissions;
  }

  advancePaced(): RuntimeEmission[] {
    return this.advanceTicks(this.speed);
  }
}

export function createNationServerRuntime(seed: number): NationServerRuntime {
  return new DefaultNationServerRuntime(seed);
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
  intervals: readonly NodeJS.Timeout[],
): Promise<void> {
  for (const interval of intervals) clearInterval(interval);
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

function tryDecodeClientMessage(raw: string): ClientMessage | null {
  try {
    return decodeClientMessage(raw);
  } catch {
    return null;
  }
}

export function startServer(opts: ServerOptions): ServerHandle {
  const runtime = createNationServerRuntime(opts.seed);
  const httpServer = createServer(createStaticHandler(opts.staticDir));
  const socketServer = createWebSocketServer(httpServer, WEBSOCKET_PATH);
  const socketBySession = new Map<NationSession, WebSocket>();

  socketServer.on("connection", (socket) => {
    const session = runtime.createSession();
    socketBySession.set(session, socket);
    socket.send(encodeMessage({ type: "welcome", state: runtime.worldState() }));
    socket.on("message", (raw) => {
      const message = tryDecodeClientMessage(raw.toString());
      if (message === null) return;
      for (const response of runtime.handleClientMessage(session, message)) {
        if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage(response));
      }
    });
    socket.on("close", () => {
      runtime.removeSession(session);
      socketBySession.delete(session);
    });
  });

  const tickInterval = setInterval(() => {
    for (const emission of runtime.advancePaced()) {
      if (emission.session === null) {
        broadcast(socketServer, emission.message);
        continue;
      }
      const socket = socketBySession.get(emission.session);
      if (socket?.readyState === WebSocket.OPEN) socket.send(encodeMessage(emission.message));
    }
  }, 1_000 / TICK_RATE);
  const clockInterval = setInterval(() => {
    broadcast(socketServer, runtime.clockMessage());
  }, CLOCK_BROADCAST_MS);

  httpServer.listen(opts.port);

  return {
    close: () => closeServer(httpServer, socketServer, [tickInterval, clockInterval]),
  };
}
