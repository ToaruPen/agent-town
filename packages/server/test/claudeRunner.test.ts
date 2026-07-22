import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { CliClaudeRunner } from "../src/llm/claudeRunner.js";

function createFakeChild(): ChildProcessWithoutNullStreams {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  }) as unknown as ChildProcessWithoutNullStreams;
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

    const resultPromise = new CliClaudeRunner({ spawnFn }).run("Plan Ash's day.");
    child.stdout.write(JSON.stringify({ result: '{"reasoning":"Work.","plan":[]}' }));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      text: '{"reasoning":"Work.","plan":[]}',
    });
    expect(spawnMock).toHaveBeenCalledWith("claude", ["-p", "--output-format", "json"]);
    expect(stdin).toBe("Plan Ash's day.");
  });

  it("returns an error when claude exits non-zero", async () => {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;

    const resultPromise = new CliClaudeRunner({ spawnFn }).run("Plan Ash's day.");
    child.stdout.write(JSON.stringify({ result: "valid despite the exit status" }));
    child.stderr.write("authentication failed");
    child.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("1"),
    });
  });

  it("kills claude and returns an error on timeout", async () => {
    vi.useFakeTimers();
    try {
      const child = createFakeChild();
      const spawnFn = vi.fn(() => child) as unknown as typeof spawn;

      const resultPromise = new CliClaudeRunner({ spawnFn, timeoutMs: 25 }).run("Plan Ash's day.");
      await vi.advanceTimersByTimeAsync(25);

      expect(child.kill).toHaveBeenCalledOnce();
      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: expect.stringContaining("timed out"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
