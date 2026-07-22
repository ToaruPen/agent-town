import type { AgentState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  buildInspectPanelViewModel,
  createThoughtBubbleSchedule,
  updateThoughtBubbleSchedule,
} from "../src/ui/inspectPanel.js";

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "ash",
    name: "Ash",
    pos: { x: 2, y: 3 },
    carrying: null,
    activity: { kind: "moving", path: [{ x: 3, y: 3 }], ticksIntoStep: 1 },
    tasks: [
      { kind: "moveTo", dest: { x: 4, y: 5 } },
      { kind: "gather", resource: "wood", target: { x: 6, y: 7 } },
      { kind: "deposit" },
    ],
    planSource: "llm",
    thinking: false,
    lastThought: 'Gather <wood> before dusk.\nThen say "hello".',
    hunger: 100,
    fatigue: 100,
    health: 100,
    ...overrides,
  };
}

describe("buildInspectPanelViewModel", () => {
  it("formats activity and task targets while preserving lastThought verbatim", () => {
    expect(
      buildInspectPanelViewModel(
        makeAgent({
          tasks: [
            { kind: "moveTo", dest: { x: 4, y: 5 } },
            { kind: "gather", resource: "wood", target: { x: 6, y: 7 } },
            { kind: "forage", target: { x: 8, y: 9 } },
            { kind: "build", pos: { x: 10, y: 11 } },
            { kind: "deposit" },
          ],
        }),
      ),
    ).toEqual({
      name: "Ash",
      planSource: "llm",
      activityKind: "moving",
      tasks: [
        { kind: "moveTo", target: "(4, 5)" },
        { kind: "gather", target: "(6, 7)" },
        { kind: "forage", target: "(8, 9)" },
        { kind: "build", target: "(10, 11)" },
        { kind: "deposit", target: null },
      ],
      needs: [
        { kind: "hunger", label: "Hunger", value: 100, max: 100, valueLabel: "100" },
        { kind: "fatigue", label: "Fatigue", value: 100, max: 100, valueLabel: "100" },
        { kind: "health", label: "Health", value: 100, max: 100, valueLabel: "100" },
      ],
      lastThought: 'Gather <wood> before dusk.\nThen say "hello".',
    });
  });
});

describe("updateThoughtBubbleSchedule", () => {
  it("schedules a six-second bubble only after a thought changes to a non-null value", () => {
    const initial = updateThoughtBubbleSchedule(
      createThoughtBubbleSchedule(),
      [makeAgent({ lastThought: "Already planned" })],
      1_000,
    );
    const unchanged = updateThoughtBubbleSchedule(
      initial,
      [makeAgent({ lastThought: "Already planned" })],
      2_000,
    );
    const changed = updateThoughtBubbleSchedule(
      unchanged,
      [makeAgent({ lastThought: "0123456789012345678901234567890123456789extra" })],
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
      [makeAgent({ lastThought: "A new plan" })],
      200,
    );
    const beforeExpiry = updateThoughtBubbleSchedule(
      scheduled,
      [makeAgent({ lastThought: "A new plan" })],
      6_199,
    );
    const expired = updateThoughtBubbleSchedule(
      beforeExpiry,
      [makeAgent({ lastThought: "A new plan" })],
      6_200,
    );

    expect(beforeExpiry.bubbles.get("ash")?.expiresAt).toBe(6_200);
    expect(expired.bubbles.has("ash")).toBe(false);
  });
});
