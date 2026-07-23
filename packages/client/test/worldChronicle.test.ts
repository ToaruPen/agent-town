import {
  WORLD_MAP_CELL_SIZE_PX,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_WIDTH,
  type WorldHistory,
  type WorldMap,
} from "@agent-town/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindWorldChronicleEscape,
  buildWorldChronicleViewModel,
  createWorldChronicle,
} from "../src/ui/worldChronicle.js";
import { makeWorldMapFixture } from "./worldMapFixture.js";

let focusedElement: FakeElement | null = null;

afterEach(() => {
  focusedElement = null;
  vi.unstubAllGlobals();
});

class FakeElement {
  className = "";
  hidden = false;
  id = "";
  textContent: string | null = null;
  type = "";
  width = 0;
  height = 0;
  readonly children: FakeElement[] = [];
  readonly style = { setProperty: () => undefined };
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly context = new FakeCanvasContext();
  attributeWrites = 0;
  listenerWrites = 0;

  constructor(readonly tagName: string) {}

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    this.attributeWrites += 1;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
    this.listenerWrites += 1;
  }

  dispatch(type: string, event: FakeEvent = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {
    focusedElement = this;
  }

  findByClass(className: string): FakeElement | null {
    if (this.className.split(" ").includes(className)) return this;
    for (const child of this.children) {
      const match = child.findByClass(className);
      if (match !== null) return match;
    }
    return null;
  }

  allText(): string {
    return [this.textContent ?? "", ...this.children.map((child) => child.allText())].join(" ");
  }

  getBoundingClientRect(): Pick<DOMRect, "left" | "top" | "width" | "height"> {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }

  getContext(contextId: string): FakeCanvasContext | null {
    return contextId === "2d" ? this.context : null;
  }
}

interface FakeEvent {
  clientX?: number;
  clientY?: number;
}

class FakeCanvasContext {
  fillStyle = "";
  globalAlpha = 1;
  imageSmoothingEnabled = true;
  lineCap = "butt";
  lineWidth = 1;
  strokeStyle = "";
  textBaseline = "alphabetic";
  readonly calls: string[] = [];

  arc(): void {
    this.calls.push("arc");
  }

  beginPath(): void {
    this.calls.push("beginPath");
  }

  closePath(): void {
    this.calls.push("closePath");
  }

  fill(): void {
    this.calls.push("fill");
  }

  fillRect(): void {
    this.calls.push("fillRect");
  }

  fillText(text: string): void {
    this.calls.push(`fillText:${text}`);
  }

  lineTo(): void {
    this.calls.push("lineTo");
  }

  moveTo(): void {
    this.calls.push("moveTo");
  }

  stroke(): void {
    this.calls.push("stroke");
  }
}

function richWorldMapFixture(): WorldMap {
  const map = makeWorldMapFixture();
  map.cells[1 * WORLD_MAP_WIDTH + 1] = {
    terrain: "plains",
    polityId: "polity-1",
  };
  map.cells[1 * WORLD_MAP_WIDTH + 2] = {
    terrain: "forest",
    polityId: "polity-2",
  };
  map.cells[2 * WORLD_MAP_WIDTH + 3] = {
    terrain: "plains",
    polityId: null,
  };
  map.cities = [
    {
      id: "city-polity-1-1",
      name: "黒貂府",
      pos: { x: 1, y: 1 },
      polityId: "polity-1",
      isCapital: true,
      foundedByEventId: "event-war",
    },
    {
      id: "city-polity-2-1",
      name: "金環府",
      pos: { x: 2, y: 1 },
      polityId: "polity-2",
      isCapital: true,
      foundedByEventId: "event-trade",
    },
  ];
  map.tradeRoutes = [
    {
      id: "route-event-trade",
      cityIds: ["city-polity-1-1", "city-polity-2-1"],
      establishedByEventId: "event-trade",
    },
  ];
  map.borderChanges = [
    {
      id: "border-event-war-1",
      pos: { x: 2, y: 1 },
      formerPolityId: "polity-1",
      currentPolityId: "polity-2",
      establishedByEventId: "event-war",
    },
  ];
  map.settlementFrontierPos = { x: 3, y: 2 };
  return map;
}

function historyFixture(): WorldHistory {
  return {
    startYear: -200,
    currentYear: 0,
    polities: [
      {
        id: "polity-1",
        name: "黒貂辺境国",
        adjective: "黒貂",
        color: 0x6f7f88,
        values: [
          { value: "mutualAid", weight: 0.9, changedByEventIds: ["event-war"] },
          { value: "order", weight: 0.8, changedByEventIds: ["event-trade"] },
          { value: "valor", weight: 0.4, changedByEventIds: ["event-war"] },
        ],
        foundingMyth: "冬の包囲戦で、最初の守人たちはひとつの火を分かち合った。",
        formativeTraumaEventIds: ["event-war", "event-war-repeat"],
        taboo: "隣人の亡骸を葬らずに放置すること。",
        ambition: "西の峠をすべて守り固める。",
        governance: "守人たちが村会の代表と合議する。",
      },
      {
        id: "polity-2",
        name: "金環盟約国",
        adjective: "金環",
        color: 0xc49a4b,
        values: [
          { value: "commerce", weight: 0.85, changedByEventIds: [] },
          { value: "knowledge", weight: 0.7, changedByEventIds: [] },
        ],
        foundingMyth: "七つの市がひと組の分銅を共有して和平を結んだ。",
        formativeTraumaEventIds: [],
        taboo: "証人のいる契約を破ること。",
        ambition: "東の街道を再び開く。",
        governance: "組合が持ち回りの代表を選ぶ。",
      },
    ],
    events: [
      {
        id: "event-departure",
        year: -1,
        kind: "migration",
        title: "黒貂の旅立ち",
        summary: "いくつかの家族が古い辺境を離れた。",
        polityIds: ["polity-1"],
        causeIds: ["event-war"],
        effects: [{ kind: "population", targetId: "polity-1", delta: -3 }],
      },
      {
        id: "event-war",
        year: -80,
        kind: "war",
        title: "黒貂・金環国境戦争",
        summary: "国境の農地が焼け落ちた。",
        polityIds: ["polity-1", "polity-2"],
        causeIds: [],
        effects: [
          { kind: "population", targetId: "polity-1", delta: -11 },
          { kind: "culture", targetId: "polity-1", value: "valor", delta: 0.08 },
        ],
      },
      {
        id: "event-war-repeat",
        year: -60,
        kind: "war",
        title: "黒貂・金環国境戦争",
        summary: "争いの絶えない境界が再び炎に包まれた。",
        polityIds: ["polity-1", "polity-2"],
        causeIds: ["event-war"],
        effects: [{ kind: "population", targetId: "polity-1", delta: -4 }],
      },
      {
        id: "event-trade",
        year: -40,
        kind: "trade",
        title: "黒貂・金環盟約",
        summary: "商人たちが脇街道を再び開いた。",
        polityIds: ["polity-1", "polity-2"],
        causeIds: [],
        effects: [{ kind: "population", targetId: "polity-1", delta: 2 }],
      },
    ],
    landmarks: [],
    settlementOrigin: {
      homelandPolityId: "polity-1",
      departureEventId: "event-departure",
      reason: "国境戦争の後、最後の穀倉が尽きた。",
      inheritedValues: ["mutualAid", "order"],
    },
    worldMap: richWorldMapFixture(),
  };
}

function installFakeDocument(): Map<
  string,
  (event: { key: string; preventDefault(): void }) => void
> {
  const documentListeners = new Map<
    string,
    (event: { key: string; preventDefault(): void }) => void
  >();
  vi.stubGlobal("document", {
    createElement: (tagName: string) => new FakeElement(tagName),
    addEventListener: (
      type: string,
      listener: (event: { key: string; preventDefault(): void }) => void,
    ) => documentListeners.set(type, listener),
    removeEventListener: (type: string) => documentListeners.delete(type),
  });
  return documentListeners;
}

describe("buildWorldChronicleViewModel", () => {
  it("resolves the homeland, inherited values, trauma titles, and event causes", () => {
    const view = buildWorldChronicleViewModel(historyFixture());

    expect(view.eraLabel).toBe("開拓以前の200年間");
    expect(view.origin).toEqual({
      homelandName: "黒貂辺境国",
      reason: "国境戦争の後、最後の穀倉が尽きた。",
      inheritedValues: ["相互扶助", "秩序"],
    });
    expect(view.polities[0]).toEqual(
      expect.objectContaining({
        name: "黒貂辺境国",
        isHomeland: true,
        values: [
          {
            label: "相互扶助",
            strengthenedBy: [{ year: -80, title: "黒貂・金環国境戦争" }],
          },
          {
            label: "秩序",
            strengthenedBy: [{ year: -40, title: "黒貂・金環盟約" }],
          },
          {
            label: "武勇",
            strengthenedBy: [{ year: -80, title: "黒貂・金環国境戦争" }],
          },
        ],
        traumaTitles: ["黒貂・金環国境戦争"],
      }),
    );
    expect(view.events.at(-1)).toEqual(
      expect.objectContaining({
        kind: "migration",
        causes: ["黒貂・金環国境戦争"],
      }),
    );
    expect(view.events.some(({ title }) => title === "黒貂・金環盟約")).toBe(true);
  });
});

describe("createWorldChronicle", () => {
  it("moves focus into a text-safe chronicle and returns it when closed with Escape", () => {
    const root = new FakeElement("aside");
    const toggle = new FakeElement("button");
    root.hidden = true;
    const documentListeners = installFakeDocument();

    const controller = createWorldChronicle(
      root as unknown as HTMLElement,
      vi.fn(),
      toggle as unknown as HTMLElement,
    );
    controller.show(historyFixture());

    expect(controller.isOpen()).toBe(true);
    expect(root.hidden).toBe(false);
    expect(focusedElement).toBe(root.findByClass("world-chronicle__close"));
    expect(root.allText()).toContain("黒貂辺境国");
    expect(root.allText()).toContain("黒貂・金環国境戦争");
    expect(root.allText()).toContain("影響 −40 · 黒貂・金環盟約");
    expect(root.allText()).not.toMatch(/[A-Za-z]/);

    const release = bindWorldChronicleEscape(controller, () => controller.close());
    let prevented = 0;
    documentListeners.get("keydown")?.({
      key: "Escape",
      preventDefault: () => {
        prevented += 1;
      },
    });

    expect(prevented).toBe(1);
    expect(controller.isOpen()).toBe(false);
    expect(root.hidden).toBe(true);
    expect(root.children).toEqual([]);
    expect(focusedElement).toBe(toggle);
    release();
    expect(documentListeners.has("keydown")).toBe(false);
  });

  it("opens on the map, reuses the polity card after selection, and switches to the chronicle", () => {
    const root = new FakeElement("aside");
    const toggle = new FakeElement("button");
    root.hidden = true;
    const documentListeners = installFakeDocument();
    const controller = createWorldChronicle(
      root as unknown as HTMLElement,
      vi.fn(),
      toggle as unknown as HTMLElement,
    );

    controller.show(historyFixture());

    const mapTab = root.findByClass("world-chronicle__tab--map");
    const chronicleTab = root.findByClass("world-chronicle__tab--chronicle");
    const mapPanel = root.findByClass("world-chronicle__map-panel");
    const chroniclePanel = root.findByClass("world-chronicle__chronicle-panel");
    const canvas = root.findByClass("world-chronicle__map-canvas");
    expect(root.allText()).toContain("世界地図");
    expect(root.allText()).toContain("年代記");
    expect(root.allText()).toContain("現在地");
    expect(root.allText()).not.toMatch(/[A-Za-z]/);
    expect(mapTab?.attributes.get("aria-selected")).toBe("true");
    expect(chronicleTab?.attributes.get("aria-selected")).toBe("false");
    expect(mapPanel?.hidden).toBe(false);
    expect(chroniclePanel?.hidden).toBe(true);
    expect(canvas?.width).toBe(WORLD_MAP_WIDTH * WORLD_MAP_CELL_SIZE_PX);
    expect(canvas?.height).toBe(WORLD_MAP_HEIGHT * WORLD_MAP_CELL_SIZE_PX);
    expect(canvas?.context.calls).toContain("fillText:現在地");

    canvas?.dispatch("pointerup", { clientX: 9, clientY: 9 });

    const selectedCard = root.findByClass("world-chronicle__map-selection");
    expect(selectedCard?.allText()).toContain("黒貂辺境国");
    expect(selectedCard?.allText()).toContain("建国譚");
    expect(selectedCard?.allText()).toContain("統治");
    expect(selectedCard?.allText()).toContain("禁忌");
    expect(selectedCard?.allText()).toContain("悲願");
    expect(selectedCard?.allText()).toContain("刻まれた傷");

    chronicleTab?.dispatch("click");

    expect(mapTab?.attributes.get("aria-selected")).toBe("false");
    expect(chronicleTab?.attributes.get("aria-selected")).toBe("true");
    expect(mapPanel?.hidden).toBe(true);
    expect(chroniclePanel?.hidden).toBe(false);
    expect(chroniclePanel?.allText()).toContain("黒貂の旅立ち");
    expect(chroniclePanel?.allText()).toContain("黒貂・金環国境戦争");

    const release = bindWorldChronicleEscape(controller, () => controller.close());
    documentListeners.get("keydown")?.({
      key: "Escape",
      preventDefault: vi.fn(),
    });

    expect(controller.isOpen()).toBe(false);
    expect(focusedElement).toBe(toggle);
    release();
  });
});
