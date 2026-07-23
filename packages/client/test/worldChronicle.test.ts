import type { WorldHistory } from "@agent-town/shared";
import { describe, expect, it, vi } from "vitest";

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
          { value: "order", weight: 0.8, changedByEventIds: [] },
          { value: "valor", weight: 0.4, changedByEventIds: ["event-war"] },
        ],
        foundingMyth: "The first wardens shared one fire through a winter siege.",
        formativeTraumaEventIds: ["event-war"],
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
  it("resolves the homeland, inherited values, trauma titles, and event causes", async () => {
    const { buildWorldChronicleViewModel } = await import("../src/ui/worldChronicle.js");
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
        values: ["Mutual aid", "Order", "Valor"],
        traumaTitles: ["The Ashen Border War"],
      }),
    );
    expect(view.events.at(-1)).toEqual(
      expect.objectContaining({
        kind: "migration",
        causes: ["The Ashen Border War"],
      }),
    );
  });
});

describe("createWorldChronicle", () => {
  it("opens a text-safe chronicle and clears it when closed", async () => {
    const module = await import("../src/ui/worldChronicle.js");
    const factory = Reflect.get(module, "createWorldChronicle");
    const root = new FakeElement("aside");
    root.hidden = true;
    vi.stubGlobal("document", {
      createElement: (tagName: string) => new FakeElement(tagName),
    });

    expect(typeof factory).toBe("function");
    const controller = factory(root as unknown as HTMLElement, vi.fn()) as {
      show(history: WorldHistory): void;
      close(): void;
      isOpen(): boolean;
    };
    controller.show(historyFixture());

    expect(controller.isOpen()).toBe(true);
    expect(root.hidden).toBe(false);
    expect(root.allText()).toContain("The Sable March");
    expect(root.allText()).toContain("The Ashen Border War");

    controller.close();
    expect(controller.isOpen()).toBe(false);
    expect(root.hidden).toBe(true);
    expect(root.children).toEqual([]);
    vi.unstubAllGlobals();
  });
});
