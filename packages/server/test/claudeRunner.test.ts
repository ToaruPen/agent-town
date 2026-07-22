import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  CLAUDE_FINAL_REAP_MS,
  CLAUDE_RESULT_MAX_BYTES,
  CLAUDE_STDERR_MAX_BYTES,
  CLAUDE_STDOUT_MAX_BYTES,
  CLAUDE_TERMINATION_GRACE_MS,
  CliClaudeRunner,
} from "../src/llm/claudeRunner.js";
import type { LlmRunner } from "../src/llm/llmRunner.js";

function createFakeChild(): ChildProcessWithoutNullStreams {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  }) as unknown as ChildProcessWithoutNullStreams;
}

async function expectPending(resultPromise: Promise<unknown>): Promise<void> {
  let settled = false;
  void resultPromise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
}

describe("CliClaudeRunner", () => {
  it("spawns claude in print JSON mode and returns the wrapper result", async () => {
    const child = createFakeChild();
    const spawnMock = vi.fn(() => child);
    const spawnFn = spawnMock as unknown as typeof spawn;
    let stdin = "";
    child.stdin.on("data", (chunk: Buffer) => {
      stdin += chunk.toString();
    });

    const runner: LlmRunner = new CliClaudeRunner({ spawnFn });
    const resultPromise = runner.run("Plan Ash's day.");
    child.stdout.write(JSON.stringify({ result: '{"reasoning":"Work.","plan":[]}' }));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      text: '{"reasoning":"Work.","plan":[]}',
    });
    expect(spawnMock).toHaveBeenCalledOnce();
    const spawnCall = spawnMock.mock.calls[0];
    expect(spawnCall?.[0]).toBe("claude");
    expect(spawnCall?.[1]).toEqual([
      "-p",
      "--output-format",
      "json",
      "--safe-mode",
      "--tools",
      "",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-chrome",
      "--no-session-persistence",
    ]);
    const spawnOptions = spawnCall?.[2];
    expect(spawnOptions?.cwd).toBeUndefined();
    expect(typeof spawnOptions?.env).toBe("object");
    expect(stdin).toBe("Plan Ash's day.");
  });

  it("passes only allowlisted environment variables to claude", async () => {
    vi.stubEnv("PATH", "test-bin-path");
    vi.stubEnv("HOME", "test-home");
    vi.stubEnv("LANG", "ja_JP.UTF-8");
    vi.stubEnv("LC_CTYPE", "ja_JP.UTF-8");
    vi.stubEnv("HTTP_PROXY", "http://test-proxy.invalid");
    vi.stubEnv("HTTPS_PROXY", "https://test-proxy.invalid");
    vi.stubEnv("ALL_PROXY", "socks5://test-proxy.invalid");
    vi.stubEnv("NO_PROXY", "localhost");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "test-oauth-token");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "test-anthropic-auth-token");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://test-anthropic.invalid");
    vi.stubEnv("CLAUDE_CONFIG_DIR", "test-claude-config");
    vi.stubEnv("OPENAI_API_KEY", "must-not-leak");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "must-not-leak");
    vi.stubEnv("APP_SECRET", "must-not-leak");
    vi.stubEnv("NODE_OPTIONS", "--require=must-not-load");
    vi.stubEnv("LD_PRELOAD", "must-not-load");
    vi.stubEnv("DYLD_INSERT_LIBRARIES", "must-not-load");
    try {
      const child = createFakeChild();
      const spawnMock = vi.fn(() => child);
      const spawnFn = spawnMock as unknown as typeof spawn;
      const runner = new CliClaudeRunner({ spawnFn });

      const resultPromise = runner.run("prompt");
      child.stdout.write(JSON.stringify({ result: "done" }));
      child.emit("close", 0);
      await resultPromise;

      const spawnOptions = spawnMock.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv };
      expect(spawnOptions.env.PATH).toBe("test-bin-path");
      expect(spawnOptions.env.HOME).toBe("test-home");
      expect(spawnOptions.env.LANG).toBe("ja_JP.UTF-8");
      expect(spawnOptions.env.LC_CTYPE).toBe("ja_JP.UTF-8");
      expect(spawnOptions.env.HTTP_PROXY).toBe("http://test-proxy.invalid");
      expect(spawnOptions.env.HTTPS_PROXY).toBe("https://test-proxy.invalid");
      expect(spawnOptions.env.ALL_PROXY).toBe("socks5://test-proxy.invalid");
      expect(spawnOptions.env.NO_PROXY).toBe("localhost");
      expect(spawnOptions.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("test-oauth-token");
      expect(spawnOptions.env.ANTHROPIC_API_KEY).toBe("test-anthropic-key");
      expect(spawnOptions.env.ANTHROPIC_AUTH_TOKEN).toBe("test-anthropic-auth-token");
      expect(spawnOptions.env.ANTHROPIC_BASE_URL).toBe("https://test-anthropic.invalid");
      expect(spawnOptions.env.CLAUDE_CONFIG_DIR).toBe("test-claude-config");
      expect(spawnOptions.env.OPENAI_API_KEY).toBeUndefined();
      expect(spawnOptions.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(spawnOptions.env.APP_SECRET).toBeUndefined();
      expect(spawnOptions.env.NODE_OPTIONS).toBeUndefined();
      expect(spawnOptions.env.LD_PRELOAD).toBeUndefined();
      expect(spawnOptions.env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts a wrapper result exactly at its UTF-8 byte limit", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const message = "é".repeat(CLAUDE_RESULT_MAX_BYTES / 2);
    const resultPromise = new CliClaudeRunner({ spawnFn }).run("prompt");

    child.stdout.write(JSON.stringify({ result: message }));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({ ok: true, text: message });
  });

  it("rejects a wrapper result over its UTF-8 byte limit", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const message = `${"é".repeat(CLAUDE_RESULT_MAX_BYTES / 2)}a`;
    const resultPromise = new CliClaudeRunner({ spawnFn }).run("prompt");

    child.stdout.write(JSON.stringify({ result: message }));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: `claude wrapper result exceeded ${CLAUDE_RESULT_MAX_BYTES} bytes`,
    });
  });

  it("returns an error when claude exits non-zero", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;

    const runner: LlmRunner = new CliClaudeRunner({ spawnFn });
    const resultPromise = runner.run("Plan Ash's day.");
    child.stdout.write(JSON.stringify({ result: "valid despite the exit status" }));
    child.stderr.write("authentication failed");
    child.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("1"),
    });
  });

  it("kills claude on timeout and waits for close before settlement", async () => {
    vi.useFakeTimers();
    try {
      const child = createFakeChild();
      const spawnFn = vi.fn(() => child) as unknown as typeof spawn;

      const runner: LlmRunner = new CliClaudeRunner({ spawnFn, timeoutMs: 25 });
      const resultPromise = runner.run("Plan Ash's day.");
      await vi.advanceTimersByTimeAsync(25);

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      await expectPending(resultPromise);
      child.emit("close", null);
      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: "claude timed out after 25ms",
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(child.listenerCount("close")).toBe(0);
      expect(child.listenerCount("error")).toBe(0);
      expect(child.stdout.listenerCount("data")).toBe(0);
      expect(child.stdout.listenerCount("error")).toBe(0);
      expect(child.stderr.listenerCount("data")).toBe(0);
      expect(child.stderr.listenerCount("error")).toBe(0);
      expect(child.stdin.listenerCount("error")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles after bounded termination when close never arrives and ignores a late close", async () => {
    vi.useFakeTimers();
    try {
      const child = createFakeChild();
      const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
      const runner = new CliClaudeRunner({ spawnFn, timeoutMs: 25 });

      const resultPromise = runner.run("prompt");
      await vi.advanceTimersByTimeAsync(25 + CLAUDE_TERMINATION_GRACE_MS + CLAUDE_FINAL_REAP_MS);

      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: "claude timed out after 25ms; claude termination is unconfirmed after SIGKILL",
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(child.listenerCount("close")).toBe(0);
      expect(child.stdout.listenerCount("data")).toBe(0);
      expect(child.stderr.listenerCount("data")).toBe(0);
      expect(() => child.emit("close", null)).not.toThrow();
      expect(() => child.emit("error", new Error("late process error"))).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["stdout", CLAUDE_STDOUT_MAX_BYTES],
    ["stderr", CLAUDE_STDERR_MAX_BYTES],
  ] as const)("stops claude when %s exceeds its UTF-8 byte limit", async (streamName, maxBytes) => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const resultPromise = new CliClaudeRunner({ spawnFn }).run("prompt");

    child[streamName].write(Buffer.alloc(maxBytes + 1, 0x20));

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await expectPending(resultPromise);
    child.emit("close", null);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: `claude ${streamName} exceeded ${maxBytes} bytes`,
    });
  });

  it("terminates and waits for close after a process error", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const resultPromise = new CliClaudeRunner({ spawnFn }).run("prompt");

    child.emit("error", new Error("lost executable"));

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await expectPending(resultPromise);
    child.emit("close", null);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: "claude process error: lost executable",
    });
  });

  it("terminates and waits for close after an output stream error", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const resultPromise = new CliClaudeRunner({ spawnFn }).run("prompt");

    child.stdout.emit("error", new Error("broken output"));

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await expectPending(resultPromise);
    child.emit("close", null);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: "claude stdout error: broken output",
    });
  });
});
