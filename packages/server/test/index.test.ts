import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startServer = vi.hoisted(() => vi.fn());

vi.mock("../src/net/wsServer.js", () => ({ startServer }));

const CONFIG_ENV_NAMES = [
  "LLM_AGENTS",
  "LLM_CLAUDE_MODEL",
  "LLM_COOLDOWN_TICKS",
  "LLM_MAX_CALLS_PER_HOUR",
  "LLM_PLANNER",
  "LLM_ROUTES",
  "PORT",
  "STATIC_DIR",
] as const;

beforeEach(() => {
  vi.resetModules();
  startServer.mockClear();
  for (const name of CONFIG_ENV_NAMES) vi.stubEnv(name, undefined);
  vi.stubEnv("PORT", "8790");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server startup configuration", () => {
  it("passes configured Claude model, cooldown, and hourly call budget to the server", async () => {
    vi.stubEnv("LLM_PLANNER", "1");
    vi.stubEnv("LLM_CLAUDE_MODEL", "sonnet");
    vi.stubEnv("LLM_COOLDOWN_TICKS", "2400");
    vi.stubEnv("LLM_MAX_CALLS_PER_HOUR", "12");

    await import("../src/index.js");

    expect(startServer).toHaveBeenCalledOnce();
    expect(startServer).toHaveBeenCalledWith({
      port: 8790,
      seed: expect.any(Number),
      llmPlannerEnabled: true,
      llmClaudeModel: "sonnet",
      llmCooldownTicks: 2400,
      llmMaxCallsPerHour: 12,
    });
  });

  it.each([
    ["LLM_COOLDOWN_TICKS", "0"],
    ["LLM_COOLDOWN_TICKS", "-1"],
    ["LLM_COOLDOWN_TICKS", "1.5"],
    ["LLM_MAX_CALLS_PER_HOUR", "many"],
    ["LLM_MAX_CALLS_PER_HOUR", ""],
    ["LLM_MAX_CALLS_PER_HOUR", "9007199254740992"],
  ] as const)("rejects invalid %s=%j with a clear startup error", async (name, value) => {
    vi.stubEnv(name, value);

    await expect(import("../src/index.js")).rejects.toThrow(
      `invalid ${name}: ${value}; expected a positive integer`,
    );
    expect(startServer).not.toHaveBeenCalled();
  });
});
