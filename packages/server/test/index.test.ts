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
  "SEED",
  "STATIC_DIR",
] as const;

beforeEach(() => {
  vi.resetModules();
  startServer.mockClear();
  for (const name of CONFIG_ENV_NAMES) vi.stubEnv(name, undefined);
  vi.stubEnv("PORT", "8790");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("server startup configuration", () => {
  it("passes a configured positive SEED to the nation server", async () => {
    vi.stubEnv("SEED", "4242");
    vi.stubEnv("STATIC_DIR", "packages/client/dist");

    await import("../src/index.js");

    expect(startServer).toHaveBeenCalledOnce();
    expect(startServer).toHaveBeenCalledWith({
      port: 8790,
      seed: 4242,
      staticDir: "packages/client/dist",
    });
  });

  it("keeps a time-based seed when SEED is unset", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_147_483_649);

    await import("../src/index.js");

    expect(startServer).toHaveBeenCalledWith({
      port: 8790,
      seed: 1,
    });
  });

  it.each(["0", "-1", "1.5", "many", "", "9007199254740992"])(
    "rejects invalid SEED=%j with a clear startup error",
    async (value) => {
      vi.stubEnv("SEED", value);

      await expect(import("../src/index.js")).rejects.toThrow(
        `invalid SEED: ${value}; expected a positive integer`,
      );
      expect(startServer).not.toHaveBeenCalled();
    },
  );
});
