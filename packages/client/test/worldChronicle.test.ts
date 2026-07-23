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
        name: "The Sable March",
        adjective: "Sable",
        color: 0x6f7f88,
        values: [
          { value: "mutualAid", weight: 0.9, changedByEventIds: ["event-war"] },
          { value: "order", weight: 0.8, changedByEventIds: ["event-trade"] },
          { value: "valor", weight: 0.4, changedByEventIds: ["event-war"] },
        ],
        foundingMyth: "The first wardens shared one fire through a winter siege.",
        formativeTraumaEventIds: ["event-war", "event-war-repeat"],
        taboo: "Leaving a neighbor unburied.",
        ambition: "Secure every western pass.",
        governance: "Wardens bargain with village moot speakers.",
      },
      {
        id: "polity-2",
        name: "The Auric League",
        adjective: "Auric",
        color: 0xc49a4b,
        values: [
          { value: "commerce", weight: 0.85, changedByEventIds: [] },
          { value: "knowledge", weight: 0.7, changedByEventIds: [] },
        ],
        foundingMyth: "Seven markets agreed on one set of weights.",
        formativeTraumaEventIds: [],
        taboo: "Breaking a witnessed contract.",
        ambition: "Reopen the eastern road.",
        governance: "Guilds elect a rotating speaker.",
      },
    ],
    events: [
      {
        id: "event-departure",
        year: -1,
        kind: "migration",
        title: "The Sable Departure",
        summary: "Several households left the old border.",
        polityIds: ["polity-1"],
        causeIds: ["event-war"],
        effects: [{ kind: "population", targetId: "polity-1", delta: -3 }],
      },
      {
        id: "event-war",
        year: -80,
        kind: "war",
        title: "The Ashen Border War",
        summary: "The border farms burned.",
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
        title: "The Ashen Border War",
        summary: "The same disputed line burned again.",
        polityIds: ["polity-1", "polity-2"],
        causeIds: ["event-war"],
        effects: [{ kind: "population", targetId: "polity-1", delta: -4 }],
      },
      {
        id: "event-trade",
        year: -40,
        kind: "trade",
        title: "The Sable-Auric Compact",
        summary: "Merchants reopened a minor road.",
        polityIds: ["polity-1", "polity-2"],
        causeIds: [],
        effects: [{ kind: "population", targetId: "polity-1", delta: 2 }],
      },
    ],
    landmarks: [],
    settlementOrigin: {
      homelandPolityId: "polity-1",
      departureEventId: "event-departure",
      reason: "The last granaries failed after the border war.",
      inheritedValues: ["mutualAid", "order"],
    },
  };
}

describe("buildWorldChronicleViewModel", () => {
  it("resolves the homeland, inherited values, trauma titles, and event causes", () => {
    const view = buildWorldChronicleViewModel(historyFixture());

    expect(view.eraLabel).toBe("200 years before settlement");
    expect(view.origin).toEqual({
      homelandName: "The Sable March",
      reason: "The last granaries failed after the border war.",
      inheritedValues: ["Mutual aid", "Order"],
    });
    expect(view.polities[0]).toEqual(
      expect.objectContaining({
        name: "The Sable March",
        isHomeland: true,
        values: [
          {
            label: "Mutual aid",
            strengthenedBy: [{ year: -80, title: "The Ashen Border War" }],
          },
          {
            label: "Order",
            strengthenedBy: [{ year: -40, title: "The Sable-Auric Compact" }],
          },
          {
            label: "Valor",
            strengthenedBy: [{ year: -80, title: "The Ashen Border War" }],
          },
        ],
        traumaTitles: ["The Ashen Border War"],
      }),
    );
    expect(view.events.at(-1)).toEqual(
      expect.objectContaining({
        kind: "migration",
        causes: ["The Ashen Border War"],
      }),
    );
    expect(view.events.some(({ title }) => title === "The Sable-Auric Compact")).toBe(true);
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
    expect(root.allText()).toContain("The Sable March");
    expect(root.allText()).toContain("The Ashen Border War");
    expect(root.allText()).toContain("Strengthened by −40 · The Sable-Auric Compact");

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
