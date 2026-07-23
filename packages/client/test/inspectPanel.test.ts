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
      name: "トネリコ",
      providerBadge: { label: "クロード", tone: "llm" },
      activityKind: "moving",
      activityLabel: "移動中",
      tasks: [
        { kind: "moveTo", label: "移動", target: "(4, 5)" },
        { kind: "gather", label: "採集", target: "(6, 7)" },
        { kind: "forage", label: "採食", target: "(8, 9)" },
        { kind: "build", label: "建設", target: "(10, 11)" },
        { kind: "deposit", label: "搬入", target: null },
      ],
      needs: [
        { kind: "hunger", label: "空腹", value: 100, max: 100, valueLabel: "100" },
        { kind: "fatigue", label: "疲労", value: 100, max: 100, valueLabel: "100" },
        { kind: "health", label: "健康", value: 100, max: 100, valueLabel: "100" },
      ],
      lastThought: "日暮れまでに木材を集める。\nそれから挨拶する。",
    });
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
