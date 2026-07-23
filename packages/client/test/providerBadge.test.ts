import type { AgentState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { buildProviderBadge, type ProviderBadge } from "../src/ui/providerBadge.js";

type ProviderState = Pick<AgentState, "planSource" | "llmProvider">;

const cases: [ProviderState, ProviderBadge][] = [
  [
    { planSource: "fake", llmProvider: null },
    { label: "FAKE", tone: "fake" },
  ],
  [
    { planSource: "llm", llmProvider: "claude" },
    { label: "CLAUDE", tone: "llm" },
  ],
  [
    { planSource: "llm", llmProvider: "codex" },
    { label: "CODEX", tone: "llm" },
  ],
  [
    { planSource: "fake", llmProvider: "claude" },
    { label: "CLAUDE → FAKE", tone: "fake" },
  ],
  [
    { planSource: "fake", llmProvider: "codex" },
    { label: "CODEX → FAKE", tone: "fake" },
  ],
];

describe("buildProviderBadge", () => {
  it.each(cases)("formats %j", (state, expected) => {
    expect(buildProviderBadge(state)).toEqual(expected);
  });
});
