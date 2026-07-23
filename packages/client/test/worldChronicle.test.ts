import type { WorldHistory } from "@agent-town/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindWorldChronicleEscape,
  buildWorldChronicleViewModel,
  createWorldChronicle,
} from "../src/ui/worldChronicle.js";

let focusedElement: FakeElement | null = null;

afterEach(() => {
  focusedElement = null;
  vi.unstubAllGlobals();
});

class FakeElement {
  className = "";
  hidden = false;
  textContent: string | null = null;
  readonly children: FakeElement[] = [];
  readonly style = { setProperty: () => undefined };
  attributeWrites = 0;
  listenerWrites = 0;

  constructor(readonly tagName: string) {}

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(): void {
    this.attributeWrites += 1;
  }

  addEventListener(): void {
    this.listenerWrites += 1;
  }

  focus(): void {
    focusedElement = this;
  }

  findByClass(className: string): FakeElement | null {
    if (this.className === className) return this;
    for (const child of this.children) {
      const match = child.findByClass(className);
      if (match !== null) return match;
    }
    return null;
  }

  allText(): string {
    return [this.textContent ?? "", ...this.children.map((child) => child.allText())].join(" ");
  }
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
  };
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
});
