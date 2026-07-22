import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { LLM_TIMEOUT_MS } from "@agent-town/shared";

import type { LlmRunner, RunnerResult } from "./llmRunner.js";

// Planning keeps subscription auth but disables tools, project instructions, MCP, and sessions.
const CLAUDE_ARGS = [
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
];

export const CLAUDE_STDOUT_MAX_BYTES = 65_536;
export const CLAUDE_STDERR_MAX_BYTES = 65_536;
export const CLAUDE_RESULT_MAX_BYTES = 32_768;
export const CLAUDE_TERMINATION_GRACE_MS = 1_000;
export const CLAUDE_FINAL_REAP_MS = 1_000;

const CLAUDE_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
]);

interface CollectedOutput {
  chunks: Buffer[];
  byteLength: number;
  maxBytes: number;
}

type MonitorPhase = "running" | "stopping" | "settled";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function claudeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && CLAUDE_ENV_KEYS.has(key.toUpperCase())) {
      environment[key] = value;
    }
  }
  return environment;
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
  if (typeof value.result !== "string") {
    return { ok: false, error: "claude wrapper result must be a string" };
  }
  return Buffer.byteLength(value.result, "utf8") <= CLAUDE_RESULT_MAX_BYTES
    ? { ok: true, text: value.result }
    : {
        ok: false,
        error: `claude wrapper result exceeded ${CLAUDE_RESULT_MAX_BYTES} bytes`,
      };
}

function appendFailure(result: RunnerResult, failure: string): RunnerResult {
  return result.ok
    ? { ok: false, error: failure }
    : { ok: false, error: `${result.error}; ${failure}` };
}

function signalChild(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): string | undefined {
  try {
    return child.kill(signal)
      ? undefined
      : `failed to signal claude with ${signal}: returned false`;
  } catch (error) {
    return `failed to signal claude with ${signal}: ${errorMessage(error)}`;
  }
}

function collectOutput(output: CollectedOutput, chunk: Buffer | string): boolean {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (buffer.byteLength > output.maxBytes - output.byteLength) return false;
  output.chunks.push(buffer);
  output.byteLength += buffer.byteLength;
  return true;
}

function outputText(output: CollectedOutput): string {
  return Buffer.concat(output.chunks, output.byteLength).toString("utf8");
}

function ignoreLateError(error: Error): void {
  void error;
}

function exitFailure(code: number | null, stderr: string): RunnerResult {
  const details = stderr.trim();
  return {
    ok: false,
    error: `claude exited with code ${String(code)}${details === "" ? "" : `: ${details}`}`,
  };
}

class ClaudeChildMonitor {
  private phase: MonitorPhase = "running";
  private readonly stdout: CollectedOutput = {
    chunks: [],
    byteLength: 0,
    maxBytes: CLAUDE_STDOUT_MAX_BYTES,
  };
  private readonly stderr: CollectedOutput = {
    chunks: [],
    byteLength: 0,
    maxBytes: CLAUDE_STDERR_MAX_BYTES,
  };
  private stopResult: RunnerResult | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private escalationTimeout: ReturnType<typeof setTimeout> | undefined;
  private reapTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly prompt: string,
    private readonly timeoutMs: number,
    private readonly resolve: (result: RunnerResult) => void,
  ) {}

  start(): void {
    this.child.stdout.on("data", this.onStdoutData);
    this.child.stdout.on("error", this.onStdoutError);
    this.child.stderr.on("data", this.onStderrData);
    this.child.stderr.on("error", this.onStderrError);
    this.child.stdin.on("error", this.onStdinError);
    this.child.on("error", this.onProcessError);
    this.child.once("close", this.onClose);
    this.timeout = setTimeout(this.onTimeout, this.timeoutMs);
    try {
      this.child.stdin.end(this.prompt);
    } catch (error) {
      this.requestStop({ ok: false, error: `claude stdin error: ${errorMessage(error)}` });
    }
  }

  private readonly onStdoutData = (chunk: Buffer | string): void => {
    this.handleOutput("stdout", this.stdout, chunk);
  };

  private readonly onStderrData = (chunk: Buffer | string): void => {
    this.handleOutput("stderr", this.stderr, chunk);
  };

  private readonly onStdoutError = (error: Error): void => {
    this.requestStop({ ok: false, error: `claude stdout error: ${errorMessage(error)}` });
  };

  private readonly onStderrError = (error: Error): void => {
    this.requestStop({ ok: false, error: `claude stderr error: ${errorMessage(error)}` });
  };

  private readonly onStdinError = (error: Error): void => {
    this.requestStop({ ok: false, error: `claude stdin error: ${errorMessage(error)}` });
  };

  private readonly onProcessError = (error: Error): void => {
    this.requestStop({ ok: false, error: `claude process error: ${errorMessage(error)}` });
  };

  private readonly onTimeout = (): void => {
    this.timeout = undefined;
    this.requestStop({ ok: false, error: `claude timed out after ${this.timeoutMs}ms` });
  };

  private readonly onEscalationTimeout = (): void => {
    this.escalationTimeout = undefined;
    if (this.phase !== "stopping" || this.stopResult === undefined) return;
    const failure = signalChild(this.child, "SIGKILL");
    if (this.phase === "stopping" && failure !== undefined) {
      this.stopResult = appendFailure(this.stopResult, failure);
    }
    if (this.phase === "stopping") {
      this.reapTimeout = setTimeout(this.onReapTimeout, CLAUDE_FINAL_REAP_MS);
    }
  };

  private readonly onReapTimeout = (): void => {
    this.reapTimeout = undefined;
    if (this.phase !== "stopping" || this.stopResult === undefined) return;
    const result = appendFailure(
      this.stopResult,
      "claude termination is unconfirmed after SIGKILL",
    );
    this.phase = "settled";
    this.clearTimers();
    this.guardUnconfirmedProcess();
    this.resolve(result);
  };

  private readonly onClose = (code: number | null): void => {
    if (this.phase === "settled") return;
    const result = this.stopResult ?? this.normalResult(code);
    this.phase = "settled";
    this.clearTimers();
    this.detachListeners();
    this.resolve(result);
  };

  private handleOutput(
    name: "stdout" | "stderr",
    output: CollectedOutput,
    chunk: Buffer | string,
  ): void {
    if (this.phase !== "running") return;
    if (collectOutput(output, chunk)) return;
    this.requestStop({
      ok: false,
      error: `claude ${name} exceeded ${output.maxBytes} bytes`,
    });
  }

  private requestStop(result: RunnerResult): void {
    if (this.phase !== "running") return;
    this.phase = "stopping";
    this.stopResult = result;
    this.clearRuntimeTimeout();
    const failure = signalChild(this.child, "SIGTERM");
    if (this.phase !== "stopping") return;
    if (failure !== undefined) this.stopResult = appendFailure(this.stopResult, failure);
    this.escalationTimeout = setTimeout(this.onEscalationTimeout, CLAUDE_TERMINATION_GRACE_MS);
  }

  private normalResult(code: number | null): RunnerResult {
    return code === 0
      ? parseWrapper(outputText(this.stdout))
      : exitFailure(code, outputText(this.stderr));
  }

  private clearRuntimeTimeout(): void {
    if (this.timeout === undefined) return;
    clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  private clearTimers(): void {
    this.clearRuntimeTimeout();
    if (this.escalationTimeout !== undefined) {
      clearTimeout(this.escalationTimeout);
      this.escalationTimeout = undefined;
    }
    if (this.reapTimeout !== undefined) {
      clearTimeout(this.reapTimeout);
      this.reapTimeout = undefined;
    }
  }

  private detachListeners(): void {
    this.child.stdout.off("data", this.onStdoutData);
    this.child.stdout.off("error", this.onStdoutError);
    this.child.stderr.off("data", this.onStderrData);
    this.child.stderr.off("error", this.onStderrError);
    this.child.stdin.off("error", this.onStdinError);
    this.child.off("error", this.onProcessError);
    this.child.off("close", this.onClose);
  }

  private guardUnconfirmedProcess(): void {
    this.detachListeners();
    this.child.stdout.on("error", ignoreLateError);
    this.child.stderr.on("error", ignoreLateError);
    this.child.stdin.on("error", ignoreLateError);
    this.child.on("error", ignoreLateError);
  }
}

function monitorChild(
  child: ChildProcessWithoutNullStreams,
  prompt: string,
  timeoutMs: number,
): Promise<RunnerResult> {
  return new Promise((resolve) => {
    new ClaudeChildMonitor(child, prompt, timeoutMs, resolve).start();
  });
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
      child = this.spawnFn("claude", CLAUDE_ARGS, { env: claudeEnvironment(process.env) });
    } catch (error) {
      return Promise.resolve({
        ok: false,
        error: `failed to spawn claude: ${errorMessage(error)}`,
      });
    }
    return monitorChild(child, prompt, this.timeoutMs);
  }
}
