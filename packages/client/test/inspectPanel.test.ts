import type { AgentState, WorldState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  buildAgentInspectPanelViewModel,
  createInspectPanel,
  createThoughtBubbleSchedule,
  resolveInspectPanelViewModel,
  updateThoughtBubbleSchedule,
} from "../src/ui/inspectPanel.js";
import { makeFacilityFixture, makeTrailCellsFixture, requireTrailCell } from "./spatialFixture.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "ash",
    name: "トネリコ",
    pos: { x: 2, y: 3 },
    carrying: null,
    activity: { kind: "moving", path: [{ x: 3, y: 3 }], ticksIntoStep: 1 },
    tasks: [
      { kind: "moveTo", dest: { x: 4, y: 5 } },
      { kind: "gather", resource: "wood", target: { x: 6, y: 7 } },
      { kind: "deposit" },
    ],
    planSource: "llm",
    llmProvider: "claude",
    thinking: false,
    lastThought: "日暮れまでに木材を集める。\nそれから挨拶する。",
    desires: { foodSecurity: 0 },
    lastHungerInterruptTick: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
    rationStrain: 0,
    lastRationTick: null,
    ...overrides,
  };
}

function makeWorld(agents: AgentState[], overrides: Partial<WorldState> = {}): WorldState {
  return {
    tick: 200,
    width: 1,
    height: 1,
    tiles: [],
    agents,
    stockpile: { pos: { x: 0, y: 0 }, wood: 0, food: 0 },
    buildings: [],
    deaths: [],
    collectives: [
      {
        id: "collective-communalGranaryStore-150",
        purpose: "communalGranaryStore",
        supporterIds: ["ash", "birch"],
        representativeId: "ash",
        cohesion: 0.78,
        formedAtTick: 150,
        provenance: {
          causedByEventIds: [],
          proposedByAgentIds: ["ash"],
          supportedByAgentIds: ["ash", "birch"],
          opposedByAgentIds: ["cedar"],
          decidedAtTick: 150,
        },
      },
    ],
    institutions: [
      {
        id: "institution-communalGranaryStore-200",
        kind: "communalGranaryStore",
        supporterIds: ["ash", "birch"],
        opposedIds: ["cedar"],
        establishedAtTick: 200,
        provenance: {
          causedByEventIds: [],
          proposedByAgentIds: ["ash"],
          supportedByAgentIds: ["ash", "birch"],
          opposedByAgentIds: ["cedar"],
          decidedAtTick: 200,
        },
      },
    ],
    spatialDemands: [],
    trailCells: makeTrailCellsFixture(1, 1),
    history: {
      startYear: 0,
      currentYear: 0,
      polities: [],
      events: [],
      landmarks: [],
      settlementOrigin: null,
      worldMap: makeWorldMapFixture(),
    },
    ...overrides,
  };
}

describe("buildAgentInspectPanelViewModel", () => {
  it("formats activity and task targets while preserving lastThought verbatim", () => {
    const selectedAgent = makeAgent({
      desires: { foodSecurity: 0.624 },
      tasks: [
        { kind: "moveTo", dest: { x: 4, y: 5 } },
        { kind: "gather", resource: "wood", target: { x: 6, y: 7 } },
        { kind: "forage", target: { x: 8, y: 9 } },
        { kind: "build", pos: { x: 10, y: 11 } },
        {
          kind: "transferToFacility",
          facilityId: "facility-granary",
          resource: "food",
        },
        { kind: "buildFacility", facilityId: "facility-granary" },
        { kind: "maintainFacility", facilityId: "facility-granary" },
        { kind: "deposit" },
      ],
    });
    const world = makeWorld(
      [
        selectedAgent,
        makeAgent({ id: "birch", name: "シラカバ" }),
        makeAgent({ id: "cedar", name: "スギ" }),
      ],
      {
        buildings: [
          {
            ...makeFacilityFixture("communalGranary", { x: 0, y: 0 }),
            id: "facility-granary",
          },
        ],
      },
    );

    expect(buildAgentInspectPanelViewModel(selectedAgent, world)).toEqual({
      kind: "agent",
      name: "トネリコ",
      providerBadge: { label: "クロード", tone: "llm" },
      activityKind: "moving",
      activityLabel: "移動中",
      tasks: [
        { kind: "moveTo", label: "移動", target: "(4, 5)" },
        { kind: "gather", label: "採集", target: "(6, 7)" },
        { kind: "forage", label: "採食", target: "(8, 9)" },
        { kind: "build", label: "建設", target: "(10, 11)" },
        {
          kind: "transferToFacility",
          label: "施設へ搬入",
          target: "共同穀倉 (0, 0)",
        },
        {
          kind: "buildFacility",
          label: "施設建設",
          target: "共同穀倉 (0, 0)",
        },
        {
          kind: "maintainFacility",
          label: "施設維持",
          target: "共同穀倉 (0, 0)",
        },
        { kind: "deposit", label: "搬入", target: null },
      ],
      needs: [
        { kind: "hunger", label: "空腹", value: 100, max: 100, valueLabel: "100" },
        { kind: "fatigue", label: "疲労", value: 100, max: 100, valueLabel: "100" },
        { kind: "health", label: "健康", value: 100, max: 100, valueLabel: "100" },
      ],
      foodSecurity: "62%",
      rationStrain: "0%",
      society: {
        collectives: [
          {
            id: "collective-communalGranaryStore-150",
            name: "共同備蓄を求める集団",
            representative: "トネリコ",
            supporters: ["トネリコ", "シラカバ"],
            cohesion: "78%",
          },
        ],
        institutions: [
          {
            id: "institution-communalGranaryStore-200",
            name: "共同備蓄",
            supporters: ["トネリコ", "シラカバ"],
            opponents: ["スギ"],
          },
        ],
      },
      lastThought: "日暮れまでに木材を集める。\nそれから挨拶する。",
    });
  });
});

describe("generic inspect panel view models", () => {
  it("resolves facility and trail targets and returns null only for genuinely missing targets", () => {
    const agent = makeAgent({ rationStrain: 0.376 });
    const granary = {
      ...makeFacilityFixture("communalGranary", { x: 0, y: 0 }),
      id: "facility-granary",
      institutionId: "institution-communalGranaryStore-200",
      inventory: { wood: 0, food: 33.6 },
      statsToday: {
        ...makeFacilityFixture("communalGranary", { x: 0, y: 0 }).statsToday,
        visits: 4,
        foodPreserved: 4.8,
        maintenanceWork: 2,
      },
      siteRationale: {
        score: 0.75,
        contributions: [{ factor: "foodAccess" as const, value: 0.8, weightedScore: 0.2 }],
      },
    };
    const world = makeWorld([agent, makeAgent({ id: "birch", name: "シラカバ" })], {
      width: 2,
      height: 2,
      tiles: Array.from({ length: 4 }, () => ({
        terrain: "plains" as const,
        resource: null,
      })),
      buildings: [granary],
      trailCells: makeTrailCellsFixture(2, 2),
    });
    world.trailCells[3] = {
      ...requireTrailCell(world.trailCells, 3),
      level: "trail",
      wear: 9,
      passagesToday: 4,
      dominantPurpose: "facilityService",
      causedByFacilityIds: [granary.id],
      lastUsedAtTick: 100,
    };

    expect(resolveInspectPanelViewModel({ kind: "agent", agentId: agent.id }, world)).toEqual(
      expect.objectContaining({
        kind: "agent",
        name: "トネリコ",
        rationStrain: "38%",
        providerBadge: { label: "クロード", tone: "llm" },
        society: expect.any(Object),
      }),
    );
    expect(
      resolveInspectPanelViewModel({ kind: "facility", facilityId: granary.id }, world),
    ).toEqual(
      expect.objectContaining({
        kind: "facility",
        name: "共同穀倉",
        foundedBy: "共同備蓄",
        effects: expect.arrayContaining([expect.stringContaining("腐敗を防いだ")]),
      }),
    );
    expect(resolveInspectPanelViewModel({ kind: "trail", tileIndex: 3 }, world)).toEqual(
      expect.objectContaining({
        kind: "trail",
        name: "小道",
        linkedFacilities: ["共同穀倉"],
      }),
    );
    expect(
      resolveInspectPanelViewModel({ kind: "facility", facilityId: "missing" }, world),
    ).toBeNull();
    expect(resolveInspectPanelViewModel({ kind: "trail", tileIndex: 99 }, world)).toBeNull();

    world.trailCells[3] = {
      ...requireTrailCell(world.trailCells, 3),
      level: "none",
      wear: 0,
    };
    expect(resolveInspectPanelViewModel({ kind: "trail", tileIndex: 3 }, world)).toBeNull();
  });
});

let activeFakeElement: FakeElement | null = null;

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  className = "";
  hidden = false;
  id = "";
  max = 0;
  type = "";
  value = 0;
  replacementCount = 0;
  scrollTop = 0;
  private ownText = "";
  private readonly listeners = new Map<string, () => void>();

  get textContent(): string {
    return `${this.ownText}${this.children.map((child) => child.textContent).join("")}`;
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children.length = 0;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  click(): void {
    this.listeners.get("click")?.();
  }

  contains(target: FakeElement | null): boolean {
    return (
      target !== null && (target === this || this.children.some((child) => child.contains(target)))
    );
  }

  findByAttribute(name: string, value: string): FakeElement | null {
    if (this.attributes.get(name) === value) return this;
    for (const child of this.children) {
      const found = child.findByAttribute(name, value);
      if (found !== null) return found;
    }
    return null;
  }

  focus(): void {
    activeFakeElement = this;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === ".inspect-panel__close" && this.className === "inspect-panel__close")
      return this;
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found !== null) return found;
    }
    return null;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.replacementCount += 1;
    this.ownText = "";
    this.children.length = 0;
    this.children.push(...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

function installFakeDocument(): void {
  activeFakeElement = null;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get activeElement() {
        return activeFakeElement;
      },
      createElement: () => new FakeElement(),
    } as unknown as Document,
  });
}

describe("createInspectPanel", () => {
  it("renders all target variants into one root and closes from the shared button", () => {
    installFakeDocument();
    const agent = makeAgent({ rationStrain: 0.25 });
    const granary = {
      ...makeFacilityFixture("communalGranary", { x: 0, y: 0 }),
      id: "facility-granary",
      institutionId: "institution-communalGranaryStore-200",
      inventory: { wood: 0, food: 34 },
      statsToday: {
        ...makeFacilityFixture("communalGranary", { x: 0, y: 0 }).statsToday,
        visits: 4,
        foodPreserved: 4.8,
        maintenanceWork: 2,
      },
      siteRationale: {
        score: 0.75,
        contributions: [{ factor: "foodAccess" as const, value: 0.8, weightedScore: 0.2 }],
      },
    };
    const world = makeWorld([agent, makeAgent({ id: "birch", name: "シラカバ" })], {
      width: 2,
      height: 2,
      tiles: Array.from({ length: 4 }, () => ({
        terrain: "plains" as const,
        resource: null,
      })),
      buildings: [granary],
      trailCells: makeTrailCellsFixture(2, 2),
    });
    world.trailCells[3] = {
      ...requireTrailCell(world.trailCells, 3),
      level: "trail",
      wear: 9,
      passagesToday: 4,
      dominantPurpose: "facilityService",
      causedByFacilityIds: [granary.id],
      lastUsedAtTick: 100,
    };
    const root = new FakeElement();
    let closed = 0;
    const controller = createInspectPanel(root as unknown as HTMLElement, () => {
      closed += 1;
    });

    controller.show({ kind: "facility", facilityId: granary.id }, world);
    expect(root.textContent).toContain("共同穀倉");
    expect(root.textContent).toContain("共同備蓄");
    expect(root.textContent).toContain("敷地を選んだ理由");
    expect(root.textContent).toContain("腐敗を防いだ");
    expect(root.textContent).toContain("関連する小道");

    controller.show({ kind: "trail", tileIndex: 3 }, world);
    expect(root.textContent).toContain("小道");
    expect(root.textContent).toContain("本日の通行4回");
    expect(root.textContent).toContain("共同穀倉");
    expect(root.textContent).toContain("移動時間20.0%短縮");

    controller.show({ kind: "agent", agentId: "ash" }, world);
    expect(root.textContent).toContain("トネリコ");
    expect(root.textContent).toContain("クロード");
    expect(root.textContent).toContain("配給疲弊");
    expect(root.textContent).toContain("食料安定への関心");
    expect(root.textContent).toContain("集団");
    expect(root.textContent).toContain("制度");

    root.findByAttribute("aria-label", "観察パネルを閉じる")?.click();
    expect(closed).toBe(1);
  });

  it("closes for missing objects and trails that have decayed away", () => {
    installFakeDocument();
    const world = makeWorld([makeAgent()]);
    const root = new FakeElement();
    const controller = createInspectPanel(root as unknown as HTMLElement, () => undefined);

    controller.show({ kind: "trail", tileIndex: 0 }, world);
    expect(root.hidden).toBe(true);
    expect(root.textContent).toBe("");

    controller.show({ kind: "facility", facilityId: "missing" }, world);
    expect(root.hidden).toBe(true);
    expect(root.textContent).toBe("");
  });

  it("keeps an unchanged panel DOM intact across authoritative updates", () => {
    installFakeDocument();
    const world = makeWorld([makeAgent()]);
    const root = new FakeElement();
    const controller = createInspectPanel(root as unknown as HTMLElement, () => undefined);

    controller.show({ kind: "agent", agentId: "ash" }, world);
    const firstHeader = root.children[0];
    controller.show({ kind: "agent", agentId: "ash" }, { ...world });

    expect(root.replacementCount).toBe(1);
    expect(root.children[0]).toBe(firstHeader);
  });

  it("preserves close-button focus and scroll when displayed values change", () => {
    installFakeDocument();
    const agent = makeAgent();
    const world = makeWorld([agent]);
    const root = new FakeElement();
    const controller = createInspectPanel(root as unknown as HTMLElement, () => undefined);

    controller.show({ kind: "agent", agentId: agent.id }, world);
    const oldClose = root.querySelector(".inspect-panel__close");
    oldClose?.focus();
    root.scrollTop = 24;
    controller.show(
      { kind: "agent", agentId: agent.id },
      { ...world, agents: [{ ...agent, hunger: 99 }] },
    );

    const newClose = root.querySelector(".inspect-panel__close");
    expect(newClose).not.toBe(oldClose);
    expect(activeFakeElement).toBe(newClose);
    expect(root.scrollTop).toBe(24);
  });

  it("resets scroll when switching to a different inspect target", () => {
    installFakeDocument();
    const agents = [makeAgent(), makeAgent({ id: "birch", name: "カバ" })];
    const world = makeWorld(agents);
    const root = new FakeElement();
    const controller = createInspectPanel(root as unknown as HTMLElement, () => undefined);

    controller.show({ kind: "agent", agentId: "ash" }, world);
    root.scrollTop = 24;
    controller.show({ kind: "agent", agentId: "birch" }, world);

    expect(root.scrollTop).toBe(0);
  });

  it("resets scroll after closing and reopening the inspect panel", () => {
    installFakeDocument();
    const world = makeWorld([makeAgent()]);
    const root = new FakeElement();
    const controller = createInspectPanel(root as unknown as HTMLElement, () => undefined);

    controller.show({ kind: "agent", agentId: "ash" }, world);
    root.scrollTop = 24;
    controller.close();
    controller.show({ kind: "agent", agentId: "ash" }, world);

    expect(root.scrollTop).toBe(0);
  });
});

describe("updateThoughtBubbleSchedule", () => {
  it("schedules a six-second bubble only after a thought changes to a non-null value", () => {
    const initial = updateThoughtBubbleSchedule(
      createThoughtBubbleSchedule(),
      [makeAgent({ lastThought: "計画済み" })],
      1_000,
    );
    const unchanged = updateThoughtBubbleSchedule(
      initial,
      [makeAgent({ lastThought: "計画済み" })],
      2_000,
    );
    const changed = updateThoughtBubbleSchedule(
      unchanged,
      [makeAgent({ lastThought: "0123456789012345678901234567890123456789余分" })],
      3_000,
    );

    expect(initial.bubbles.size).toBe(0);
    expect(unchanged.bubbles.size).toBe(0);
    expect(changed.bubbles.get("ash")).toEqual({
      text: "0123456789012345678901234567890123456789…",
      expiresAt: 9_000,
    });
  });

  it("keeps an unchanged bubble deadline and removes the bubble when it expires", () => {
    const observedNull = updateThoughtBubbleSchedule(
      createThoughtBubbleSchedule(),
      [makeAgent({ lastThought: null })],
      100,
    );
    const scheduled = updateThoughtBubbleSchedule(
      observedNull,
      [makeAgent({ lastThought: "新しい計画" })],
      200,
    );
    const beforeExpiry = updateThoughtBubbleSchedule(
      scheduled,
      [makeAgent({ lastThought: "新しい計画" })],
      6_199,
    );
    const expired = updateThoughtBubbleSchedule(
      beforeExpiry,
      [makeAgent({ lastThought: "新しい計画" })],
      6_200,
    );

    expect(beforeExpiry.bubbles.get("ash")?.expiresAt).toBe(6_200);
    expect(expired.bubbles.has("ash")).toBe(false);
  });
});
