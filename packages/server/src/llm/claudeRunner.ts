import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { LLM_TIMEOUT_MS } from "@agent-town/shared";

import type { LlmRunner, RunnerResult } from "./llmRunner.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseWrapper(raw: string): RunnerResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `invalid claude wrapper JSON: ${errorMessage(error)}` };
  }
  if (typeof value !== "object" || value === null || !("result" in value)) {
    return { ok: false, error: "claude wrapper has no result field" };
  }
  return typeof value.result === "string"
    ? { ok: true, text: value.result }
    : { ok: false, error: "claude wrapper result must be a string" };
}

export class CliClaudeRunner implements LlmRunner {
  private readonly spawnFn: typeof spawn;
  private readonly timeoutMs: number;

  constructor(opts: { spawnFn?: typeof spawn; timeoutMs?: number } = {}) {
    this.spawnFn = opts.spawnFn ?? spawn;
    this.timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  }

  run(prompt: string): Promise<RunnerResult> {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnFn("claude", ["-p", "--output-format", "json"]);
    } catch (error) {
      return Promise.resolve({
        ok: false,
        error: `failed to spawn claude: ${errorMessage(error)}`,
      });
    }

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: RunnerResult): void => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        resolve(result);
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        finish({ ok: false, error: `claude process error: ${errorMessage(error)}` });
      });
      child.on("close", (code) => {
        if (code !== 0) {
          const details = stderr.trim();
          finish({
            ok: false,
            error: `claude exited with code ${String(code)}${details === "" ? "" : `: ${details}`}`,
          });
          return;
        }
        finish(parseWrapper(stdout));
      });
      timeout = setTimeout(() => {
        finish({ ok: false, error: `claude timed out after ${this.timeoutMs}ms` });
        child.kill();
      }, this.timeoutMs);
      child.stdin.end(prompt);
    });
  }
}
