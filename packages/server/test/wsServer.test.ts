import { createServer } from "node:net";

import {
  decodeServerMessage,
  NATION_TICKS_PER_SEASON,
  NATION_TICKS_PER_YEAR,
  type ServerMessage,
} from "@agent-town/shared";
import { describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData } from "ws";

import { createNationServerRuntime, startServer } from "../src/net/wsServer.js";

const spawnProcess = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnProcess }));

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
      2_500,
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

function firstOrders(
  messages: readonly ServerMessage[],
): Extract<ServerMessage, { type: "orders" }> {
  const orders = messages.find(
    (message): message is Extract<ServerMessage, { type: "orders" }> => message.type === "orders",
  );
  if (orders === undefined) throw new Error("missing orders message");
  return orders;
}

describe("nation server runtime", () => {
  it("emits season exactly at a boundary and follows it with one orders refresh", () => {
    const runtime = createNationServerRuntime(42);
    const session = runtime.createSession();
    const nationId = runtime.worldState().nations[0]?.id;
    if (nationId === undefined) throw new Error("missing nation");
    runtime.handleClientMessage(session, { type: "selectNation", nationId });

    expect(runtime.advanceTicks(NATION_TICKS_PER_SEASON - 1)).toEqual([]);

    const boundary = runtime.advanceTicks(1);

    expect(boundary.map(({ message }) => message.type)).toEqual(["season", "orders"]);
    const season = boundary[0]?.message;
    if (season?.type !== "season") throw new Error("missing season");
    expect(season).toMatchObject({
      tick: NATION_TICKS_PER_SEASON,
      year: 1,
      season: "summer",
      changedCells: [],
    });
    expect(boundary[0]?.session).toBeNull();
    expect(boundary[1]?.session).toBe(session);
  });

  it("uses the chancellor choice wire id for the directive cost and effect ledger", () => {
    const runtime = createNationServerRuntime(6);
    const session = runtime.createSession();
    const nationId = runtime.worldState().nations[0]?.id;
    if (nationId === undefined) throw new Error("missing nation");
    const selected = firstOrders(
      runtime.handleClientMessage(session, { type: "selectNation", nationId }),
    );
    const choice = selected.chancellorChoice;
    if (choice === null) throw new Error("missing chancellor choice");
    const wireId = choice.id;

    expect(choice.kind).toBe("holdFestival");
    expect(wireId).toBe(`chancellor-${nationId}-${NATION_TICKS_PER_SEASON}`);

    const season = runtime
      .advanceTicks(NATION_TICKS_PER_SEASON)
      .find(({ message }) => message.type === "season")?.message;
    if (season?.type !== "season") throw new Error("missing season");
    const report = season.nations.find(({ id }) => id === nationId)?.lastReport;
    if (report === null || report === undefined) throw new Error("missing season report");
    const ledgerReasons = new Set(
      report.entries
        .filter(({ directiveId }) => directiveId === wireId)
        .map(({ reason }) => reason),
    );

    expect(ledgerReasons).toEqual(new Set(["directiveCost", "directiveEffect"]));
    expect(report.completedDirectiveIds).toContain(wireId);
  });

  it("acknowledges every order mutation, mints the id immediately, and preserves queue on rejection", () => {
    const runtime = createNationServerRuntime(42);
    const session = runtime.createSession();
    const nationId = runtime.worldState().nations[0]?.id;
    if (nationId === undefined) throw new Error("missing nation");
    const selected = runtime.handleClientMessage(session, { type: "selectNation", nationId });
    const selectedOrders = firstOrders(selected);
    const option = selectedOrders.options.find(({ blockedReason }) => blockedReason === null);
    const blocked = selectedOrders.options.find(({ blockedReason }) => blockedReason !== null);
    if (option === undefined || blocked === undefined)
      throw new Error("missing directive fixtures");

    expect(runtime.handleClientMessage(session, { type: "hello" })).toEqual([]);
    expect(runtime.handleClientMessage(session, { type: "setSpeed", speed: 2 })).toEqual([]);
    const autoPilot = runtime.handleClientMessage(session, {
      type: "setAutoPilot",
      enabled: false,
    });
    const accepted = runtime.handleClientMessage(session, {
      type: "issueDirective",
      kind: option.kind,
      targetCityId: option.targetCityId,
    });
    const acceptedOrders = firstOrders(accepted);

    expect(autoPilot.map(({ type }) => type)).toEqual(["orders"]);
    expect(acceptedOrders.queued).toEqual({
      id: "directive-1",
      kind: option.kind,
      targetCityId: option.targetCityId,
    });
    expect(runtime.worldState().nations[0]?.activeDirectives).toEqual([]);

    const rejected = firstOrders(
      runtime.handleClientMessage(session, {
        type: "issueDirective",
        kind: blocked.kind,
        targetCityId: blocked.targetCityId,
      }),
    );

    expect(rejected.rejected).toBe(blocked.blockedReason);
    expect(rejected.queued).toEqual(acceptedOrders.queued);

    const cancelled = firstOrders(
      runtime.handleClientMessage(session, {
        type: "cancelDirective",
        directiveId: "directive-1",
      }),
    );
    expect(cancelled.queued).toBeNull();
    expect(cancelled.rejected).toBeNull();
  });

  it("emits orders for rejected issue, cancel, and auto-pilot messages", () => {
    const runtime = createNationServerRuntime(42);
    const firstSession = runtime.createSession();
    const secondSession = runtime.createSession();
    const [firstNation, secondNation] = runtime.worldState().nations;
    if (firstNation === undefined || secondNation === undefined) {
      throw new Error("missing nation fixtures");
    }
    runtime.handleClientMessage(firstSession, {
      type: "selectNation",
      nationId: firstNation.id,
    });
    runtime.handleClientMessage(secondSession, {
      type: "selectNation",
      nationId: secondNation.id,
    });
    const before = structuredClone(runtime.worldState());

    const rejected = [
      runtime.handleClientMessage(firstSession, {
        type: "issueDirective",
        kind: "clearFarmland",
        targetCityId: null,
      }),
      runtime.handleClientMessage(firstSession, {
        type: "cancelDirective",
        directiveId: "directive-unknown",
      }),
      runtime.handleClientMessage(firstSession, {
        type: "setAutoPilot",
        enabled: false,
      }),
    ].map(firstOrders);

    expect(rejected.map((message) => message.rejected)).toEqual([
      "notYourNation",
      "notYourNation",
      "notYourNation",
    ]);
    expect(runtime.worldState()).toEqual(before);
  });

  it("charges an issued directive in exactly one season report across its lifetime", () => {
    const runtime = createNationServerRuntime(42);
    const session = runtime.createSession();
    const nationId = runtime.worldState().nations[0]?.id;
    if (nationId === undefined) throw new Error("missing nation");
    const selected = firstOrders(
      runtime.handleClientMessage(session, { type: "selectNation", nationId }),
    );
    runtime.handleClientMessage(session, { type: "setAutoPilot", enabled: false });
    const option = selected.options.find(
      ({ blockedReason, seasons }) => blockedReason === null && seasons > 1,
    );
    if (option === undefined) throw new Error("missing multi-season directive");
    const accepted = firstOrders(
      runtime.handleClientMessage(session, {
        type: "issueDirective",
        kind: option.kind,
        targetCityId: option.targetCityId,
      }),
    );
    const directiveId = accepted.queued?.id;
    if (directiveId === undefined) throw new Error("missing accepted directive id");

    const emissions = runtime.advanceTicks(NATION_TICKS_PER_SEASON * (option.seasons + 1));
    const reports = emissions.flatMap(({ message }) =>
      message.type === "season"
        ? message.nations
            .filter(({ id }) => id === nationId)
            .flatMap(({ lastReport }) => (lastReport === null ? [] : [lastReport]))
        : [],
    );
    const chargedReports = reports.filter((report) =>
      report.entries.some(
        ({ reason, directiveId: entryDirectiveId }) =>
          reason === "directiveCost" && entryDirectiveId === directiveId,
      ),
    );
    const foodCostEntries = reports.flatMap((report) =>
      report.entries.filter(
        ({ metric, reason, directiveId: entryDirectiveId }) =>
          metric === "food" && reason === "directiveCost" && entryDirectiveId === directiveId,
      ),
    );

    expect(chargedReports).toHaveLength(1);
    expect(foodCostEntries).toHaveLength(1);
    expect(reports.flatMap(({ completedDirectiveIds }) => completedDirectiveIds)).toContain(
      directiveId,
    );
  });

  it("cancels an active player directive by the id minted when it was queued", () => {
    const runtime = createNationServerRuntime(42);
    const session = runtime.createSession();
    const nationId = runtime.worldState().nations[0]?.id;
    if (nationId === undefined) throw new Error("missing nation");
    const selected = firstOrders(
      runtime.handleClientMessage(session, { type: "selectNation", nationId }),
    );
    runtime.handleClientMessage(session, { type: "setAutoPilot", enabled: false });
    const option = selected.options.find(
      ({ blockedReason, seasons }) => blockedReason === null && seasons > 1,
    );
    if (option === undefined) throw new Error("missing multi-season directive");
    const accepted = firstOrders(
      runtime.handleClientMessage(session, {
        type: "issueDirective",
        kind: option.kind,
        targetCityId: option.targetCityId,
      }),
    );
    const directiveId = accepted.queued?.id;
    if (directiveId === undefined) throw new Error("missing accepted directive id");

    runtime.advanceTicks(NATION_TICKS_PER_SEASON);
    expect(runtime.worldState().nations[0]?.activeDirectives.map(({ id }) => id)).toContain(
      directiveId,
    );

    const cancelled = firstOrders(
      runtime.handleClientMessage(session, { type: "cancelDirective", directiveId }),
    );

    expect(cancelled.rejected).toBeNull();
    expect(runtime.worldState().nations[0]?.activeDirectives.map(({ id }) => id)).not.toContain(
      directiveId,
    );
  });

  it("rejects unknown nations, directives for another nation, and invalid speeds without mutation", () => {
    const runtime = createNationServerRuntime(42);
    const session = runtime.createSession();
    const beforeUnknown = structuredClone(runtime.worldState());

    expect(
      runtime.handleClientMessage(session, {
        type: "selectNation",
        nationId: "unknown",
      }),
    ).toEqual([]);
    expect(runtime.worldState()).toEqual(beforeUnknown);

    const [own, rival] = runtime.worldState().nations;
    const rivalCityId = rival?.cities[0]?.cityId;
    if (own === undefined || rivalCityId === undefined) throw new Error("missing nation fixtures");
    runtime.handleClientMessage(session, { type: "selectNation", nationId: own.id });
    const beforeDirective = structuredClone(runtime.worldState());
    const rejected = firstOrders(
      runtime.handleClientMessage(session, {
        type: "issueDirective",
        kind: "growCity",
        targetCityId: rivalCityId,
      }),
    );

    expect(rejected.rejected).toBe("notYourNation");
    expect(runtime.worldState()).toEqual(beforeDirective);

    const beforeSpeed = structuredClone(runtime.worldState());
    expect(
      runtime.handleClientMessage(session, {
        type: "setSpeed",
        speed: 3,
      } as never),
    ).toEqual([]);
    expect(runtime.worldState()).toEqual(beforeSpeed);
  });

  it("rejects an unaffordable directive without changing nation state", () => {
    const runtime = createNationServerRuntime(26);
    const session = runtime.createSession();
    const selected = runtime.handleClientMessage(session, {
      type: "selectNation",
      nationId: "polity-3",
    });
    runtime.handleClientMessage(session, { type: "setAutoPilot", enabled: false });
    const insufficient = firstOrders(selected).options.find(
      ({ kind, blockedReason }) =>
        kind === "clearFarmland" && blockedReason === "insufficientMaterials",
    );
    if (insufficient === undefined) throw new Error("missing unaffordable directive fixture");
    const before = structuredClone(runtime.worldState());

    const rejected = firstOrders(
      runtime.handleClientMessage(session, {
        type: "issueDirective",
        kind: insufficient.kind,
        targetCityId: insufficient.targetCityId,
      }),
    );

    expect(rejected.rejected).toBe(insufficient.blockedReason);
    expect(runtime.worldState()).toEqual(before);
  });

  it("produces identical tick-N state at x1, x4, and across pause and resume", () => {
    const x1 = createNationServerRuntime(42);
    const x4 = createNationServerRuntime(42);
    const resumed = createNationServerRuntime(42);
    const x4Session = x4.createSession();
    const resumedSession = resumed.createSession();

    x4.handleClientMessage(x4Session, { type: "setSpeed", speed: 4 });
    for (let callback = 0; callback < NATION_TICKS_PER_YEAR; callback += 1) x1.advancePaced();
    for (let callback = 0; callback < NATION_TICKS_PER_YEAR / 4; callback += 1) {
      x4.advancePaced();
    }

    for (let callback = 0; callback < 100; callback += 1) resumed.advancePaced();
    resumed.handleClientMessage(resumedSession, { type: "setSpeed", speed: 0 });
    for (let callback = 0; callback < 50; callback += 1) resumed.advancePaced();
    resumed.handleClientMessage(resumedSession, { type: "setSpeed", speed: 4 });
    for (let callback = 0; callback < 275; callback += 1) resumed.advancePaced();

    x4.handleClientMessage(x4Session, { type: "setSpeed", speed: 1 });
    resumed.handleClientMessage(resumedSession, { type: "setSpeed", speed: 1 });

    expect(x1.worldState().tick).toBe(NATION_TICKS_PER_YEAR);
    expect(x4.worldState()).toEqual(x1.worldState());
    expect(resumed.worldState()).toEqual(x1.worldState());
  });

  it("runs twenty headless years without negative stocks or spawning an LLM process", () => {
    const runtime = createNationServerRuntime(42);

    runtime.advanceTicks(NATION_TICKS_PER_YEAR * 20);

    expect(runtime.worldState().tick).toBe(NATION_TICKS_PER_YEAR * 20);
    for (const nation of runtime.worldState().nations) {
      expect(nation.stocks.food).toBeGreaterThanOrEqual(0);
      expect(nation.stocks.materials).toBeGreaterThanOrEqual(0);
      expect(nation.stocks.wealth).toBeGreaterThanOrEqual(0);
    }
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});

describe("startServer", () => {
  it("sends one welcome and keeps the wall-clock heartbeat observable while paused", async () => {
    const port = await getEphemeralPort();
    const server = startServer({ port, seed: 42 });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let serverClosed = false;

    try {
      socket.once("open", () => {
        socket.send(JSON.stringify({ type: "setSpeed", speed: 0 }));
      });
      const messages = await receiveMessages(socket, 2);
      const [welcome, clock] = messages;

      expect(messages.filter(({ type }) => type === "welcome")).toHaveLength(1);
      expect(welcome?.type).toBe("welcome");
      if (welcome?.type !== "welcome") throw new Error("first message was not welcome");
      expect(welcome.state.history.landmarks).toEqual([]);
      expect(welcome.state.nations.length).toBeGreaterThan(0);

      expect(clock).toMatchObject({ type: "clock", speed: 0 });
      if (clock?.type !== "clock") throw new Error("second message was not clock");
      expect("nations" in clock).toBe(false);
      expect("state" in clock).toBe(false);

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
