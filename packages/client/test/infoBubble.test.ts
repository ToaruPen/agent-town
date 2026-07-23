import {
  type AgentState,
  DAYS_PER_SEASON,
  HOUSE_BUILD_TICKS,
  TICKS_PER_DAY,
  type WorldState,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";
import { createDoubleTapHistory } from "../src/render/worldViewport.js";
import {
  activateInfoBubble,
  beginInfoBubbleInteraction,
  buildAgentBubbleText,
  buildHouseBubbleText,
  buildLandmarkBubbleText,
  buildResourceBubbleText,
  buildStockpileBubbleText,
  buildTerrainBubbleText,
  buildTombstoneBubbleText,
  createInfoBubbleGesture,
  createInfoBubbleRenderGate,
  endInfoBubbleInteraction,
  type InfoBubbleTarget,
  isTapGesture,
  mapInfoBubblePlacementToScreen,
  preserveInfoBubbleInvalidation,
  resolveHitPriority,
  resolveHoveredAgentAtScreen,
  resolveHoveredAgentId,
  resolveInfoBubbleTarget,
  resolveScreenBubblePlacement,
} from "../src/ui/infoBubble.js";
import type { DeathEvent } from "../src/ui/survivalViewModel.js";

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "ash",
    name: "トネリコ",
    pos: { x: 2, y: 3 },
    carrying: null,
    activity: { kind: "moving", path: [{ x: 3, y: 3 }], ticksIntoStep: 1 },
    tasks: [],
    planSource: "llm",
    llmProvider: "claude",
    thinking: false,
    lastThought: "日暮れまでに木材を集める。\nその後、家へ戻る。",
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    hunger: 21.2,
    fatigue: 43.4,
    health: 88.1,
    ...overrides,
  };
}

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    tick: 0,
    width: 2,
    height: 2,
    tiles: Array.from({ length: 4 }, () => ({ terrain: "plains" as const, resource: null })),
    agents: [makeAgent(), makeAgent({ id: "birch", name: "シラカバ" })],
    stockpile: { pos: { x: 0, y: 0 }, wood: 8, food: 25 },
    buildings: [],
    deaths: [],
    collectives: [],
    institutions: [],
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
    },
    ...overrides,
  };
}

describe("info bubble text builders", () => {
  it("formats an agent badge, activity, compact needs, and first thought line", () => {
    expect(buildAgentBubbleText(makeAgent({ llmProvider: "codex" }))).toEqual({
      title: "トネリコ",
      badge: "コーデックス",
      lines: ["移動中 · 空腹 21 · 疲労 43 · 健康 88", "日暮れまでに木材を集める。"],
    });
  });

  it("labels provider fallback and unmanaged fake plans", () => {
    expect(
      buildAgentBubbleText(makeAgent({ planSource: "fake", llmProvider: "claude" })).badge,
    ).toBe("クロード → 自律");
    expect(buildAgentBubbleText(makeAgent({ planSource: "fake", llmProvider: null })).badge).toBe(
      "自律",
    );
  });

  it("formats live tree and berry resources", () => {
    expect(
      buildResourceBubbleText(
        { terrain: "forest", resource: { kind: "wood", amount: 7 } },
        "wood",
        0,
      ),
    ).toBe("木 — 木材 残り7");
    expect(
      buildResourceBubbleText(
        { terrain: "plains", resource: { kind: "food", amount: 4 } },
        "food",
        0,
      ),
    ).toBe("木の実 — 食料 残り4");
  });

  it("adds regrowth and winter dormancy notes for depleted resources", () => {
    const winterTick = DAYS_PER_SEASON * 3 * TICKS_PER_DAY;

    expect(buildResourceBubbleText({ terrain: "forest", resource: null }, "wood", 0)).toBe(
      "木 — 枯渇・毎日再生",
    );
    expect(buildResourceBubbleText({ terrain: "plains", resource: null }, "food", winterTick)).toBe(
      "木の実 — 枯渇・毎日再生（冬は休眠）",
    );
  });

  it("recognizes a depleted berry origin on an initial or reconnected world", () => {
    const winterTick = DAYS_PER_SEASON * 3 * TICKS_PER_DAY;
    const depletedBerry = {
      terrain: "plains" as const,
      resource: null,
      resourceOrigin: "food" as const,
    };
    const world = makeWorld({
      tick: winterTick,
      tiles: [depletedBerry, ...makeWorld().tiles.slice(1)],
      agents: [],
      stockpile: { pos: { x: 1, y: 1 }, wood: 0, food: 0 },
    });

    expect(resolveInfoBubbleTarget(world, [], new Map(), { x: 8, y: 8 })).toEqual({
      kind: "resource",
      tileIndex: 0,
      resourceKind: "food",
    });
    expect(buildResourceBubbleText(depletedBerry, "food", winterTick)).toBe(
      "木の実 — 枯渇・毎日再生（冬は休眠）",
    );
  });

  it("formats construction progress and completed house capacity", () => {
    expect(
      buildHouseBubbleText({
        kind: "house",
        pos: { x: 1, y: 1 },
        progress: HOUSE_BUILD_TICKS / 4,
        complete: false,
      }),
    ).toBe("家 — 建設中 25%");
    expect(
      buildHouseBubbleText({
        kind: "house",
        pos: { x: 1, y: 1 },
        progress: HOUSE_BUILD_TICKS,
        complete: true,
      }),
    ).toBe("家 — 定員2人");
  });

  it("reuses the HUD food-days forecast for the stockpile", () => {
    expect(buildStockpileBubbleText(makeWorld())).toBe("貯蔵庫 — 木材8 · 食料25 · 3.0日分");
  });

  it("formats tombstone identity, day, and cause", () => {
    const event: DeathEvent = {
      id: "0:14400:トネリコ",
      name: "トネリコ",
      pos: { x: 1, y: 1 },
      cause: "starvation",
      deathTick: 6 * TICKS_PER_DAY,
      expiresAtTick: 7 * TICKS_PER_DAY,
      text: "トネリコが餓死 — 7日目",
    };

    expect(buildTombstoneBubbleText(event)).toBe("トネリコの墓 — 7日目に餓死");
  });

  it("formats terrain kind and coordinates", () => {
    expect(buildTerrainBubbleText({ terrain: "rock", resource: null }, { x: 4, y: 5 })).toBe(
      "岩場 — (4, 5)",
    );
  });
});

describe("resolveHitPriority", () => {
  it("selects agent above tombstone, house, stockpile, resource, and terrain", () => {
    const targets: InfoBubbleTarget[] = [
      { kind: "terrain", tileIndex: 0 },
      { kind: "resource", tileIndex: 0, resourceKind: "wood" },
      { kind: "stockpile" },
      { kind: "house", pos: { x: 0, y: 0 } },
      { kind: "tombstone", eventId: "death" },
      { kind: "agent", agentId: "ash" },
    ];

    expect(resolveHitPriority(targets)).toEqual({ kind: "agent", agentId: "ash" });
  });

  it("preserves topmost order within one priority and returns null without hits", () => {
    const topmost: InfoBubbleTarget = { kind: "agent", agentId: "birch" };
    const behind: InfoBubbleTarget = { kind: "agent", agentId: "ash" };

    expect(resolveHitPriority([topmost, behind])).toBe(topmost);
    expect(resolveHitPriority([])).toBeNull();
  });
});

describe("resolveInfoBubbleTarget", () => {
  it("selects the visually frontmost agent when five same-tile hit areas overlap", () => {
    const agents = Array.from({ length: 5 }, (_, index) =>
      makeAgent({ id: `agent-${index}`, pos: { x: 0, y: 0 } }),
    );
    const world = makeWorld({
      agents,
      stockpile: { pos: { x: 1, y: 1 }, wood: 0, food: 0 },
    });

    expect(resolveInfoBubbleTarget(world, [], new Map(), { x: 8, y: 8 })).toEqual({
      kind: "agent",
      agentId: "agent-3",
    });
  });

  it("selects a landmark and explains the event that left it behind", async () => {
    const world = makeWorld({
      agents: [],
      stockpile: { pos: { x: 1, y: 1 }, wood: 0, food: 0 },
      history: {
        startYear: -200,
        currentYear: 0,
        polities: [
          {
            id: "polity-1",
            name: "黒貂辺境国",
            adjective: "黒貂",
            color: 0x6f7f88,
            values: [],
            foundingMyth: "守人たちはひとつの火を分かち合った。",
            formativeTraumaEventIds: ["event-war"],
            taboo: "死者を葬らずに放置すること。",
            ambition: "すべての峠を守り固める。",
            governance: "守人と村会による合議。",
          },
        ],
        events: [
          {
            id: "event-war",
            year: -80,
            kind: "war",
            title: "黒貂・金環国境戦争",
            summary: "国境の農地が焼け落ちた。",
            polityIds: ["polity-1"],
            causeIds: [],
            effects: [
              {
                kind: "landmark",
                targetId: "landmark-1",
                landmarkKind: "borderFort",
              },
            ],
          },
        ],
        landmarks: [
          {
            id: "landmark-1",
            kind: "borderFort",
            name: "古き黒貂国境砦",
            pos: { x: 0, y: 0 },
            polityId: "polity-1",
            foundedByEventId: "event-war",
          },
        ],
        settlementOrigin: null,
      },
    });
    expect(resolveInfoBubbleTarget(world, [], new Map(), { x: 8, y: 8 })).toEqual({
      kind: "landmark",
      landmarkId: "landmark-1",
    });
    expect(buildLandmarkBubbleText(world.history.landmarks[0], world.history)).toBe(
      "古き黒貂国境砦 — 黒貂・金環国境戦争の後に築かれた（−80年）",
    );
  });
});

describe("resolveHoveredAgentId", () => {
  it("returns the agent under the pointer and clears over non-agent terrain", () => {
    const world = makeWorld({
      agents: [makeAgent({ pos: { x: 0, y: 0 } })],
    });

    expect(resolveHoveredAgentId(world, [], new Map(), { x: 8, y: 8 })).toBe("ash");
    expect(resolveHoveredAgentId(world, [], new Map(), { x: 24, y: 8 })).toBeNull();
  });
});

describe("isTapGesture", () => {
  it("accepts pointerup at the eight-pixel boundary before 300ms", () => {
    expect(isTapGesture({ x: 4, y: 9, at: 100 }, { x: 12, y: 9, at: 399 })).toBe(true);
  });

  it("rejects drags beyond eight pixels and gestures lasting 300ms", () => {
    expect(isTapGesture({ x: 0, y: 0, at: 0 }, { x: 8.01, y: 0, at: 299 })).toBe(false);
    expect(isTapGesture({ x: 0, y: 0, at: 0 }, { x: 0, y: 0, at: 300 })).toBe(false);
  });
});

describe("screen-space info bubbles", () => {
  it("keeps a 390px fitted-world bubble readable and flips below the top edge", () => {
    const fitScale = 390 / 512;
    const anchor = mapInfoBubblePlacementToScreen({ x: 256, top: 0, bottom: 16 }, ({ x, y }) => ({
      x: x * fitScale,
      y: y * fitScale,
    }));
    const placement = resolveScreenBubblePlacement(
      anchor,
      { width: 160, height: 36 },
      {
        width: 390,
        height: 844,
      },
    );

    expect(placement.below).toBe(true);
    expect(placement.x).toBe(195);
    expect(placement.boxTop).toBeGreaterThanOrEqual(2);
    expect(placement.boxBottom).toBeLessThanOrEqual(842);
  });

  it("clamps a panned and zoomed edge anchor inside both screen axes", () => {
    const anchor = mapInfoBubblePlacementToScreen(
      { x: 480, top: 448, bottom: 464 },
      ({ x, y }) => ({ x: x * 2 - 500, y: y * 2 - 600 }),
    );
    const placement = resolveScreenBubblePlacement(
      anchor,
      { width: 160, height: 50 },
      {
        width: 390,
        height: 300,
      },
    );

    expect(placement.x).toBeLessThanOrEqual(308);
    expect(placement.boxTop).toBeGreaterThanOrEqual(2);
    expect(placement.boxBottom).toBeLessThanOrEqual(298);
  });
});

describe("info bubble gesture isolation", () => {
  it("opens an agent after a quick tap without preserving either double-tap history", () => {
    const mainHistory = createDoubleTapHistory();
    const cameraHistory = createDoubleTapHistory();
    const stopCalls: string[] = [];
    let openedAgentId: string | null = null;
    const event = { stopPropagation: () => stopCalls.push("stopped") };
    const clearHistories = () => {
      mainHistory.clear();
      cameraHistory.clear();
    };
    mainHistory.register({ x: 100, y: 100, at: 100 });
    cameraHistory.register({ x: 100, y: 100, at: 100 });

    beginInfoBubbleInteraction(event, clearHistories);
    activateInfoBubble(event, "ash", clearHistories, (agentId) => {
      openedAgentId = agentId;
    });

    expect(openedAgentId).toBe("ash");
    expect(stopCalls).toEqual(["stopped", "stopped"]);
    expect(mainHistory.register({ x: 110, y: 100, at: 250 })).toBe(false);
    expect(cameraHistory.register({ x: 110, y: 100, at: 250 })).toBe(false);
  });

  it("keeps the pressed bubble alive through an update until its tap handler runs", () => {
    const gate = createInfoBubbleRenderGate();
    const stopCalls: string[] = [];
    const event = { stopPropagation: () => stopCalls.push("stopped") };
    let bubbleAlive = true;
    let opened = 0;
    const dirtyAfterStateUpdate = true;

    beginInfoBubbleInteraction(event, () => undefined, gate.begin);
    if (gate.shouldRender(dirtyAfterStateUpdate)) bubbleAlive = false;
    endInfoBubbleInteraction(event, gate.end);
    activateInfoBubble(
      event,
      "ash",
      () => undefined,
      () => {
        opened += 1;
      },
      gate.canActivate,
    );

    expect(bubbleAlive).toBe(true);
    expect(opened).toBe(1);
    expect(gate.shouldRender(dirtyAfterStateUpdate)).toBe(true);
    expect(stopCalls).toEqual(["stopped", "stopped", "stopped"]);
  });

  it("preserves a close invalidation across a state update so the layer is removed", () => {
    const gate = createInfoBubbleRenderGate();
    let bubbleAlive = true;
    const dirtyAfterClose = true;
    const dirtyAfterUpdate = preserveInfoBubbleInvalidation(dirtyAfterClose, null);

    gate.cancel();
    if (gate.shouldRender(dirtyAfterUpdate)) bubbleAlive = false;

    expect(dirtyAfterUpdate).toBe(true);
    expect(bubbleAlive).toBe(false);
  });

  it.each(["wheel", "Escape"])(
    "cancels a pressed bubble on %s and rejects its stale pointerup activation",
    () => {
      const gate = createInfoBubbleRenderGate();
      const event = { stopPropagation: () => undefined };
      let bubbleAlive = true;
      let opened = 0;

      beginInfoBubbleInteraction(event, () => undefined, gate.begin);
      gate.cancel();
      if (gate.shouldRender(true)) bubbleAlive = false;
      endInfoBubbleInteraction(event, gate.end);
      activateInfoBubble(
        event,
        "ash",
        () => undefined,
        () => {
          opened += 1;
        },
        gate.canActivate,
      );

      expect(bubbleAlive).toBe(false);
      expect(opened).toBe(0);
    },
  );
});

describe("info bubble local gesture", () => {
  it("invalidates a drag beyond eight pixels even when release returns inside", () => {
    const gesture = createInfoBubbleGesture();
    gesture.start({ pointerId: 1, x: 10, y: 10, at: 100 });

    expect(gesture.move({ pointerId: 1, x: 19, y: 10, at: 150 })).toBe("invalid");
    expect(gesture.end({ pointerId: 1, x: 12, y: 10, at: 200 }, true)).toBe(false);
    expect(gesture.canActivate()).toBe(false);
  });

  it("allows one inside release within eight pixels and before 300ms", () => {
    const gesture = createInfoBubbleGesture();
    gesture.start({ pointerId: 1, x: 10, y: 10, at: 100 });

    expect(gesture.move({ pointerId: 1, x: 18, y: 10, at: 200 })).toBe("pending");
    expect(gesture.end({ pointerId: 1, x: 18, y: 10, at: 399 }, true)).toBe(true);
    expect(gesture.canActivate()).toBe(true);
  });

  it("rejects outside releases and holds lasting 300ms", () => {
    const outside = createInfoBubbleGesture();
    outside.start({ pointerId: 1, x: 10, y: 10, at: 100 });
    expect(outside.end({ pointerId: 1, x: 12, y: 10, at: 200 }, false)).toBe(false);

    const longHold = createInfoBubbleGesture();
    longHold.start({ pointerId: 2, x: 10, y: 10, at: 100 });
    expect(longHold.end({ pointerId: 2, x: 10, y: 10, at: 400 }, true)).toBe(false);
    expect(longHold.canActivate()).toBe(false);
  });
});

describe("screen-space hover re-evaluation", () => {
  it("clears hover at the last pointer position after the agent moves", () => {
    const pointer = { x: 8, y: 8 };
    const current = makeWorld({ agents: [makeAgent({ pos: { x: 0, y: 0 } })] });
    const moved = makeWorld({ agents: [makeAgent({ pos: { x: 1, y: 0 } })] });
    const identity = (point: { x: number; y: number }) => point;

    expect(resolveHoveredAgentAtScreen(current, [], new Map(), pointer, identity)).toBe("ash");
    expect(resolveHoveredAgentAtScreen(moved, [], new Map(), pointer, identity)).toBeNull();
  });
});
