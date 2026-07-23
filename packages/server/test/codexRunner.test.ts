import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  CliCodexRunner,
  CODEX_AGENT_MESSAGE_MAX_BYTES,
  CODEX_FINAL_REAP_MS,
  CODEX_STDERR_MAX_BYTES,
  CODEX_STDOUT_MAX_BYTES,
  CODEX_TERMINATION_GRACE_MS,
} from "../src/llm/codexRunner.js";
import type { LlmRunner } from "../src/llm/llmRunner.js";

const { rmSyncMock } = vi.hoisted(() => ({
  rmSyncMock: vi.fn<(path: string, options: { recursive: true; force: true }) => void>(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  rmSyncMock.mockImplementation((path, options) => {
    original.rmSync(path, options);
  });
  return { ...original, rmSync: rmSyncMock };
});

function createFakeChild(): ChildProcessWithoutNullStreams {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  }) as unknown as ChildProcessWithoutNullStreams;
}

function emitSuccessfulTurn(child: ChildProcessWithoutNullStreams, text: string): void {
  child.stdout.write(
    `${JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text },
    })}\n`,
  );
  child.stdout.write(`${JSON.stringify({ type: "turn.completed" })}\n`);
  child.emit("close", 0);
}

async function expectPending(resultPromise: Promise<unknown>): Promise<void> {
  let settled = false;
  void resultPromise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
}

describe("CliCodexRunner", () => {
  it("runs codex in an isolated non-interactive mode and returns its agent message", async () => {
    const child = createFakeChild();
    const spawnMock = vi.fn(() => child);
    const spawnFn = spawnMock as unknown as typeof spawn;
    let stdin = "";
    child.stdin.on("data", (chunk: Buffer) => {
      stdin += chunk.toString();
    });

    const runner: LlmRunner = new CliCodexRunner({
      spawnFn,
      workingDirectory: "test-codex-cwd",
    });
    const resultPromise = runner.run("Plan トネリコ's day.");
    child.stdout.write(`${JSON.stringify({ type: "thread.started" })}\n`);
    child.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: '{"reasoning":"働く。","plan":[]}' },
      })}\n`,
    );
    child.stdout.write(`${JSON.stringify({ type: "turn.completed" })}\n`);
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      text: '{"reasoning":"働く。","plan":[]}',
    });
    expect(spawnMock).toHaveBeenCalledOnce();
    const spawnCall = spawnMock.mock.calls[0];
    expect(spawnCall?.[0]).toBe("codex");
    expect(spawnCall?.[1]).toEqual([
      "exec",
      "--strict-config",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--disable",
      "hooks",
      "--disable",
      "plugins",
      "--disable",
      "apps",
      "--disable",
      "remote_plugin",
      "--disable",
      "tool_suggest",
      "--disable",
      "multi_agent",
      "--disable",
      "shell_tool",
      "--disable",
      "unified_exec",
      "--disable",
      "image_generation",
      "--disable",
      "browser_use",
      "--disable",
      "browser_use_external",
      "--disable",
      "browser_use_full_cdp_access",
      "--disable",
      "computer_use",
      "--disable",
      "in_app_browser",
      "--disable",
      "standalone_web_search",
      "-c",
      'web_search="disabled"',
      "-c",
      "skills.include_instructions=false",
      "-c",
      "skills.bundled.enabled=false",
      "-c",
      "include_apps_instructions=false",
      "-c",
      "include_collaboration_mode_instructions=false",
      "-c",
      "include_environment_context=false",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--json",
      "-",
    ]);
    const spawnOptions = spawnCall?.[2];
    expect(spawnOptions?.cwd).toBe("test-codex-cwd");
    expect(typeof spawnOptions?.env).toBe("object");
    expect(stdin).toBe("Plan トネリコ's day.");
  });

  it("passes only allowlisted environment variables to codex", async () => {
    vi.stubEnv("PATH", "test-bin-path");
    vi.stubEnv("CODEX_HOME", "test-codex-home");
    vi.stubEnv("CODEX_API_KEY", "test-codex-key");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_ORG", "test-openai-org");
    vi.stubEnv("OPENAI_ORG_ID", "test-openai-org-id");
    vi.stubEnv("OPENAI_ORGANIZATION", "test-openai-organization");
    vi.stubEnv("OPENAI_PROJECT", "test-openai-project");
    vi.stubEnv("OPENAI_PROJECT_ID", "test-openai-project-id");
    vi.stubEnv("OPENAI_BASE_URL", "https://test-openai.invalid");
    vi.stubEnv("LC_TEST", "test-locale");
    vi.stubEnv("HTTP_PROXY", "http://test-proxy.invalid");
    vi.stubEnv("HTTPS_PROXY", "https://test-proxy.invalid");
    vi.stubEnv("ALL_PROXY", "socks5://test-proxy.invalid");
    vi.stubEnv("NO_PROXY", "localhost");
    vi.stubEnv("SystemRoot", "test-windows-root");
    vi.stubEnv("ANTHROPIC_API_KEY", "must-not-leak");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "must-not-leak");
    vi.stubEnv("APP_SECRET", "must-not-leak");
    vi.stubEnv("NODE_OPTIONS", "--require=must-not-load");
    vi.stubEnv("LD_PRELOAD", "must-not-load");
    vi.stubEnv("DYLD_INSERT_LIBRARIES", "must-not-load");
    try {
      const child = createFakeChild();
      const spawnMock = vi.fn(() => child);
      const spawnFn = spawnMock as unknown as typeof spawn;
      const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

      const resultPromise = runner.run("prompt");
      emitSuccessfulTurn(child, "done");
      await resultPromise;

      const spawnOptions = spawnMock.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv };
      expect(spawnOptions.env.PATH).toBe("test-bin-path");
      expect(spawnOptions.env.CODEX_HOME).toBe("test-codex-home");
      expect(spawnOptions.env.CODEX_API_KEY).toBe("test-codex-key");
      expect(spawnOptions.env.OPENAI_API_KEY).toBe("test-openai-key");
      expect(spawnOptions.env.OPENAI_ORG).toBe("test-openai-org");
      expect(spawnOptions.env.OPENAI_ORG_ID).toBe("test-openai-org-id");
      expect(spawnOptions.env.OPENAI_ORGANIZATION).toBe("test-openai-organization");
      expect(spawnOptions.env.OPENAI_PROJECT).toBe("test-openai-project");
      expect(spawnOptions.env.OPENAI_PROJECT_ID).toBe("test-openai-project-id");
      expect(spawnOptions.env.OPENAI_BASE_URL).toBe("https://test-openai.invalid");
      expect(spawnOptions.env.LC_TEST).toBe("test-locale");
      expect(spawnOptions.env.HTTP_PROXY).toBe("http://test-proxy.invalid");
      expect(spawnOptions.env.HTTPS_PROXY).toBe("https://test-proxy.invalid");
      expect(spawnOptions.env.ALL_PROXY).toBe("socks5://test-proxy.invalid");
      expect(spawnOptions.env.NO_PROXY).toBe("localhost");
      expect(spawnOptions.env.SystemRoot).toBe("test-windows-root");
      expect(spawnOptions.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(spawnOptions.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(spawnOptions.env.APP_SECRET).toBeUndefined();
      expect(spawnOptions.env.NODE_OPTIONS).toBeUndefined();
      expect(spawnOptions.env.LD_PRELOAD).toBeUndefined();
      expect(spawnOptions.env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns the last completed agent message", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "first" },
      })}\n`,
    );
    emitSuccessfulTurn(child, "last");

    await expect(resultPromise).resolves.toEqual({ ok: true, text: "last" });
  });

  it("accepts a final agent message exactly at its UTF-8 byte limit", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });
    const message = "é".repeat(CODEX_AGENT_MESSAGE_MAX_BYTES / 2);

    const resultPromise = runner.run("prompt");
    emitSuccessfulTurn(child, message);

    await expect(resultPromise).resolves.toEqual({ ok: true, text: message });
  });

  it("rejects a final agent message over its UTF-8 byte limit", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });
    const message = `${"é".repeat(CODEX_AGENT_MESSAGE_MAX_BYTES / 2)}a`;

    const resultPromise = runner.run("prompt");
    emitSuccessfulTurn(child, message);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: `codex agent message exceeded ${CODEX_AGENT_MESSAGE_MAX_BYTES} bytes`,
    });
  });

  it.each([
    ["item.started", "command_execution"],
    ["item.completed", "file_change"],
    ["item.completed", "mcp_tool_call"],
  ])("rejects the %s %s action item", async (eventType, itemType) => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(`${JSON.stringify({ type: eventType, item: { type: itemType } })}\n`);
    emitSuccessfulTurn(child, "must not be accepted");

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: `codex emitted forbidden action item: ${itemType}`,
    });
  });

  it("allows reasoning items in a normal text-only turn", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(
      `${JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "thinking" } })}\n`,
    );
    emitSuccessfulTurn(child, "done");

    await expect(resultPromise).resolves.toEqual({ ok: true, text: "done" });
  });

  it("rejects any item event after turn completion", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "done" },
      })}\n`,
    );
    child.stdout.write(`${JSON.stringify({ type: "turn.completed" })}\n`);
    child.stdout.write(
      `${JSON.stringify({ type: "item.completed", item: { type: "reasoning" } })}\n`,
    );
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: "codex item event was emitted after turn.completed",
    });
  });

  it("rejects an agent message emitted after turn completion", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(`${JSON.stringify({ type: "turn.completed" })}\n`);
    child.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "too late" },
      })}\n`,
    );
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("after turn.completed"),
    });
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["an event without a string type", JSON.stringify({ type: 42 })],
  ])("rejects %s in JSONL output", async (_description, line) => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(`${line}\n`);
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("invalid codex JSONL"),
    });
  });

  it("rejects turn completion without an agent message", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(`${JSON.stringify({ type: "turn.completed" })}\n`);
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("agent message"),
    });
  });

  it("rejects an agent message without turn completion", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "unfinished" },
      })}\n`,
    );
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("turn.completed"),
    });
  });

  it("returns a turn.failed message", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(
      `${JSON.stringify({ type: "turn.failed", error: { message: "model overloaded" } })}\n`,
    );
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("model overloaded"),
    });
  });

  it("returns a top-level error event message", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(`${JSON.stringify({ type: "error", message: "authentication failed" })}\n`);
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("authentication failed"),
    });
  });

  it("surfaces the exit code and trimmed stderr on nonzero exit", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stderr.write("  authentication failed  \n");
    child.emit("close", 7);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: "codex exited with code 7: authentication failed",
    });
  });

  it("kills codex on timeout but waits for close before cleanup and settlement", async () => {
    vi.useFakeTimers();
    let workingDirectory = "";
    try {
      const child = createFakeChild();
      const spawnFn = vi.fn((_command, _args, options) => {
        workingDirectory = String(options?.cwd);
        return child;
      }) as unknown as typeof spawn;
      const runner = new CliCodexRunner({ spawnFn, timeoutMs: 25 });

      const resultPromise = runner.run("prompt");
      await vi.advanceTimersByTimeAsync(25);

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(existsSync(workingDirectory)).toBe(true);
      await expectPending(resultPromise);

      const cleanupCalls = rmSyncMock.mock.calls.length;
      child.emit("close", null);
      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: "codex timed out after 25ms",
      });
      expect(existsSync(workingDirectory)).toBe(false);
      expect(rmSyncMock).toHaveBeenCalledTimes(cleanupCalls + 1);
      expect(vi.getTimerCount()).toBe(0);
      expect(child.listenerCount("error")).toBe(0);
      expect(child.stdout.listenerCount("data")).toBe(0);
      expect(child.stdout.listenerCount("error")).toBe(0);
      expect(child.stderr.listenerCount("data")).toBe(0);
      expect(child.stderr.listenerCount("error")).toBe(0);
      expect(child.stdin.listenerCount("error")).toBe(0);
      child.emit("close", null);
      expect(rmSyncMock).toHaveBeenCalledTimes(cleanupCalls + 1);
    } finally {
      if (workingDirectory !== "") rmSync(workingDirectory, { recursive: true, force: true });
      vi.useRealTimers();
    }
  });

  it("escalates a stopped process to SIGKILL after the termination grace period", async () => {
    vi.useFakeTimers();
    let workingDirectory = "";
    try {
      const child = createFakeChild();
      const spawnFn = vi.fn((_command, _args, options) => {
        workingDirectory = String(options?.cwd);
        return child;
      }) as unknown as typeof spawn;
      const runner = new CliCodexRunner({ spawnFn, timeoutMs: 25 });

      const resultPromise = runner.run("prompt");
      await vi.advanceTimersByTimeAsync(25 + CODEX_TERMINATION_GRACE_MS);

      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
      expect(existsSync(workingDirectory)).toBe(true);
      await expectPending(resultPromise);
      child.emit("close", null);
      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: "codex timed out after 25ms",
      });
      expect(existsSync(workingDirectory)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (workingDirectory !== "") rmSync(workingDirectory, { recursive: true, force: true });
      vi.useRealTimers();
    }
  });

  it("still settles with a failure when killing a timed-out process throws", async () => {
    vi.useFakeTimers();
    try {
      const child = createFakeChild();
      vi.mocked(child.kill).mockImplementation(() => {
        throw new Error("termination failed");
      });
      const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
      const runner = new CliCodexRunner({
        spawnFn,
        timeoutMs: 25,
        workingDirectory: "test-codex-cwd",
      });

      const resultPromise = runner.run("prompt");
      await vi.advanceTimersByTimeAsync(25);

      await expectPending(resultPromise);
      child.emit("close", null);
      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error:
          "codex timed out after 25ms; failed to signal codex with SIGTERM: termination failed",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports when SIGTERM cannot be sent and still waits for close", async () => {
    vi.useFakeTimers();
    try {
      const child = createFakeChild();
      vi.mocked(child.kill).mockReturnValue(false);
      const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
      const runner = new CliCodexRunner({
        spawnFn,
        timeoutMs: 25,
        workingDirectory: "test-codex-cwd",
      });

      const resultPromise = runner.run("prompt");
      await vi.advanceTimersByTimeAsync(25);

      await expectPending(resultPromise);
      child.emit("close", null);
      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: "codex timed out after 25ms; failed to signal codex with SIGTERM: returned false",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles without cleaning its cwd when termination remains unconfirmed", async () => {
    vi.useFakeTimers();
    let workingDirectory = "";
    try {
      const child = createFakeChild();
      vi.mocked(child.kill).mockImplementation((signal) => {
        if (signal === "SIGTERM") throw new Error("term failed");
        return false;
      });
      const spawnFn = vi.fn((_command, _args, options) => {
        workingDirectory = String(options?.cwd);
        return child;
      }) as unknown as typeof spawn;
      const runner = new CliCodexRunner({ spawnFn, timeoutMs: 25 });

      const resultPromise = runner.run("prompt");
      await vi.advanceTimersByTimeAsync(25 + CODEX_TERMINATION_GRACE_MS + CODEX_FINAL_REAP_MS);

      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error:
          "codex timed out after 25ms; failed to signal codex with SIGTERM: term failed; " +
          "failed to signal codex with SIGKILL: returned false; " +
          "codex termination is unconfirmed after SIGKILL; " +
          "codex cwd retained because termination is unconfirmed",
      });
      expect(existsSync(workingDirectory)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(child.stdout.listenerCount("data")).toBe(0);
      expect(child.stderr.listenerCount("data")).toBe(0);
      expect(() => child.stdout.emit("error", new Error("late stdout error"))).not.toThrow();
      expect(() => child.stderr.emit("error", new Error("late stderr error"))).not.toThrow();
      expect(() => child.stdin.emit("error", new Error("late stdin error"))).not.toThrow();
      expect(() => child.emit("error", new Error("late process error"))).not.toThrow();

      await vi.advanceTimersByTimeAsync(CODEX_FINAL_REAP_MS * 2);
      expect(vi.getTimerCount()).toBe(0);
      expect(existsSync(workingDirectory)).toBe(true);
    } finally {
      if (workingDirectory !== "") rmSync(workingDirectory, { recursive: true, force: true });
      vi.useRealTimers();
    }
  });

  it("returns a failure when spawn throws synchronously", async () => {
    const spawnFn = vi.fn(() => {
      throw new Error("command unavailable");
    }) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    await expect(runner.run("prompt")).resolves.toEqual({
      ok: false,
      error: "failed to spawn codex: command unavailable",
    });
  });

  it("removes its temporary working directory after spawn throws", async () => {
    let workingDirectory = "";
    const spawnFn = vi.fn((_command, _args, options) => {
      workingDirectory = String(options?.cwd);
      throw new Error("command unavailable");
    }) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn });

    await runner.run("prompt");

    expect(workingDirectory).toContain("agent-town-codex-");
    expect(existsSync(workingDirectory)).toBe(false);
  });

  it("preserves a spawn failure when temporary-directory cleanup also fails", async () => {
    let workingDirectory = "";
    const spawnFn = vi.fn((_command, _args, options) => {
      workingDirectory = String(options?.cwd);
      throw new Error("command unavailable");
    }) as unknown as typeof spawn;
    rmSyncMock.mockImplementationOnce(() => {
      throw new Error("permission denied");
    });
    const runner = new CliCodexRunner({ spawnFn });

    try {
      await expect(runner.run("prompt")).resolves.toEqual({
        ok: false,
        error:
          "failed to spawn codex: command unavailable; failed to clean codex cwd: permission denied",
      });
      expect(existsSync(workingDirectory)).toBe(true);
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("returns a failure when the child emits a process error", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.emit("error", new Error("lost executable"));

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await expectPending(resultPromise);
    child.emit("close", null);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: "codex process error: lost executable",
    });
  });

  it("returns a failure when writing the prompt emits a stdin error", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdin.emit("error", new Error("broken pipe"));

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await expectPending(resultPromise);
    child.emit("close", null);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: "codex stdin error: broken pipe",
    });
  });

  it.each([
    ["stdout", "codex stdout error: broken output"],
    ["stderr", "codex stderr error: broken output"],
  ] as const)("returns a failure when %s emits an error", async (streamName, expectedError) => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child[streamName].emit("error", new Error("broken output"));

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await expectPending(resultPromise);
    child.emit("close", null);
    await expect(resultPromise).resolves.toEqual({ ok: false, error: expectedError });
  });

  it("accepts stdout at its byte limit", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });
    const events = `${JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "done" },
    })}\n${JSON.stringify({ type: "turn.completed" })}\n`;
    const paddingBytes = CODEX_STDOUT_MAX_BYTES - Buffer.byteLength(events) - 1;

    const resultPromise = runner.run("prompt");
    child.stdout.write(`${" ".repeat(paddingBytes)}\n${events}`);
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({ ok: true, text: "done" });
  });

  it("stops codex when stdout exceeds its byte limit", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stdout.write(Buffer.alloc(CODEX_STDOUT_MAX_BYTES + 1, 0x20));

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await expectPending(resultPromise);
    child.emit("close", null);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: `codex stdout exceeded ${CODEX_STDOUT_MAX_BYTES} bytes`,
    });
  });

  it("accepts stderr at its byte limit", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stderr.write(Buffer.alloc(CODEX_STDERR_MAX_BYTES, 0x20));
    child.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: "codex exited with code 1",
    });
  });

  it("stops codex when stderr exceeds its byte limit", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn, workingDirectory: "test-codex-cwd" });

    const resultPromise = runner.run("prompt");
    child.stderr.write(Buffer.alloc(CODEX_STDERR_MAX_BYTES + 1, 0x20));

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await expectPending(resultPromise);
    child.emit("close", null);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: `codex stderr exceeded ${CODEX_STDERR_MAX_BYTES} bytes`,
    });
  });

  it("does not remove a provided working directory", async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), "agent-town-codex-test-provided-"));
    try {
      const child = createFakeChild();
      const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
      const runner = new CliCodexRunner({ spawnFn, workingDirectory });

      const resultPromise = runner.run("prompt");
      emitSuccessfulTurn(child, "done");
      await resultPromise;

      expect(existsSync(workingDirectory)).toBe(true);
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("removes only the temporary working directory it creates", async () => {
    const child = createFakeChild();
    const spawnMock = vi.fn(() => child);
    const spawnFn = spawnMock as unknown as typeof spawn;
    const runner = new CliCodexRunner({ spawnFn });

    const resultPromise = runner.run("prompt");
    emitSuccessfulTurn(child, "done");
    await resultPromise;

    const spawnOptions = spawnMock.mock.calls[0]?.[2] as { cwd: string };
    expect(spawnOptions.cwd).toContain("agent-town-codex-");
    expect(existsSync(spawnOptions.cwd)).toBe(false);
  });
});
