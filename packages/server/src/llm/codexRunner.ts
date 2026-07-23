import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LLM_TIMEOUT_MS } from "@agent-town/shared";

import type { LlmRunner, RunnerResult } from "./llmRunner.js";

// Confidentiality boundary: read-only prevents writes, not host reads, so planning disables
// shell/tool surfaces and user-provided instruction sources.
const CODEX_ARGS = [
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
];

export const CODEX_STDOUT_MAX_BYTES = 1_048_576;
export const CODEX_STDERR_MAX_BYTES = 65_536;
export const CODEX_AGENT_MESSAGE_MAX_BYTES = 32_768;
export const CODEX_TERMINATION_GRACE_MS = 1_000;
export const CODEX_FINAL_REAP_MS = 1_000;

const CODEX_ENV_KEYS = new Set([
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
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "CODEX_HOME",
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_ORG",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "OPENAI_PROJECT_ID",
  "OPENAI_BASE_URL",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
]);

export interface CodexRunnerOptions {
  spawnFn?: typeof spawn;
  timeoutMs?: number;
  workingDirectory?: string;
}

interface CodexEvent {
  type: string;
  [key: string]: unknown;
}

interface WorkingDirectory {
  path: string;
  owned: boolean;
}

interface ParseState {
  turnCompleted: boolean;
  lastAgentMessage?: string;
}

interface CollectedOutput {
  chunks: Buffer[];
  byteLength: number;
  maxBytes: number;
}

type MonitorPhase = "running" | "stopping" | "settled";

type WorkingDirectoryResult =
  | { ok: true; value: WorkingDirectory }
  | { ok: false; result: RunnerResult };

type ParsedEventResult = { ok: true; event: CodexEvent } | { ok: false; result: RunnerResult };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAllowedEnvironmentKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return CODEX_ENV_KEYS.has(normalized) || normalized.startsWith("LC_");
}

function codexEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && isAllowedEnvironmentKey(key)) environment[key] = value;
  }
  return environment;
}

function prepareWorkingDirectory(provided: string | undefined): WorkingDirectoryResult {
  if (provided !== undefined) return { ok: true, value: { path: provided, owned: false } };
  try {
    return {
      ok: true,
      value: {
        path: mkdtempSync(join(tmpdir(), "agent-town-codex-")),
        owned: true,
      },
    };
  } catch (error) {
    return {
      ok: false,
      result: { ok: false, error: `failed to prepare codex cwd: ${errorMessage(error)}` },
    };
  }
}

function cleanupError(workingDirectory: WorkingDirectory): string | undefined {
  if (!workingDirectory.owned) return undefined;
  try {
    rmSync(workingDirectory.path, { recursive: true, force: true });
    return undefined;
  } catch (error) {
    return `failed to clean codex cwd: ${errorMessage(error)}`;
  }
}

function appendFailure(result: RunnerResult, failure: string): RunnerResult {
  return result.ok
    ? { ok: false, error: failure }
    : { ok: false, error: `${result.error}; ${failure}` };
}

function withCleanup(result: RunnerResult, workingDirectory: WorkingDirectory): RunnerResult {
  const cleanupFailure = cleanupError(workingDirectory);
  if (cleanupFailure === undefined) return result;
  return appendFailure(result, cleanupFailure);
}

function signalChild(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): string | undefined {
  try {
    return child.kill(signal) ? undefined : `failed to signal codex with ${signal}: returned false`;
  } catch (error) {
    return `failed to signal codex with ${signal}: ${errorMessage(error)}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(line: string, lineNumber: number): ParsedEventResult {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    return {
      ok: false,
      result: {
        ok: false,
        error: `invalid codex JSONL at line ${lineNumber}: ${errorMessage(error)}`,
      },
    };
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    return {
      ok: false,
      result: { ok: false, error: `invalid codex JSONL event at line ${lineNumber}` },
    };
  }
  return { ok: true, event: value as CodexEvent };
}

function eventMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return isRecord(value) && typeof value.message === "string" ? value.message : undefined;
}

function eventFailure(event: CodexEvent): RunnerResult | undefined {
  if (event.type === "turn.failed") {
    const detail = eventMessage(event.error) ?? eventMessage(event.message);
    return {
      ok: false,
      error: detail === undefined ? "codex turn failed" : `codex turn failed: ${detail}`,
    };
  }
  if (event.type === "error") {
    const detail = eventMessage(event.error) ?? eventMessage(event.message);
    return {
      ok: false,
      error: detail === undefined ? "codex error event" : `codex error: ${detail}`,
    };
  }
  return undefined;
}

function completedAgentMessage(
  event: CodexEvent,
  lineNumber: number,
): string | RunnerResult | undefined {
  if (event.type !== "item.completed") return undefined;
  if (!isRecord(event.item) || typeof event.item.type !== "string") {
    return { ok: false, error: `invalid codex JSONL event at line ${lineNumber}` };
  }
  if (event.item.type !== "agent_message") return undefined;
  if (typeof event.item.text !== "string") {
    return { ok: false, error: `invalid codex JSONL event at line ${lineNumber}` };
  }
  return Buffer.byteLength(event.item.text, "utf8") <= CODEX_AGENT_MESSAGE_MAX_BYTES
    ? event.item.text
    : {
        ok: false,
        error: `codex agent message exceeded ${CODEX_AGENT_MESSAGE_MAX_BYTES} bytes`,
      };
}

function itemEventFailure(
  event: CodexEvent,
  lineNumber: number,
  turnCompleted: boolean,
): RunnerResult | undefined {
  if (!event.type.startsWith("item.")) return undefined;
  if (turnCompleted) {
    return { ok: false, error: "codex item event was emitted after turn.completed" };
  }
  if (!isRecord(event.item) || typeof event.item.type !== "string") {
    return { ok: false, error: `invalid codex JSONL event at line ${lineNumber}` };
  }
  return event.item.type === "agent_message" || event.item.type === "reasoning"
    ? undefined
    : { ok: false, error: `codex emitted forbidden action item: ${event.item.type}` };
}

function applyEvent(
  event: CodexEvent,
  lineNumber: number,
  state: ParseState,
): RunnerResult | undefined {
  const failure = eventFailure(event);
  if (failure !== undefined) return failure;
  const itemFailure = itemEventFailure(event, lineNumber, state.turnCompleted);
  if (itemFailure !== undefined) return itemFailure;
  if (event.type === "turn.completed") state.turnCompleted = true;
  const message = completedAgentMessage(event, lineNumber);
  if (typeof message === "object") return message;
  if (message !== undefined && state.turnCompleted) {
    return { ok: false, error: "codex agent message was emitted after turn.completed" };
  }
  if (message !== undefined) state.lastAgentMessage = message;
  return undefined;
}

function parseJsonLines(stdout: string): RunnerResult {
  const state: ParseState = { turnCompleted: false };
  const lines = stdout.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    const parsed = parseEvent(line, index + 1);
    if (!parsed.ok) return parsed.result;
    const failure = applyEvent(parsed.event, index + 1, state);
    if (failure !== undefined) return failure;
  }
  if (!state.turnCompleted) return { ok: false, error: "codex output is missing turn.completed" };
  return state.lastAgentMessage === undefined
    ? { ok: false, error: "codex output is missing an agent message" }
    : { ok: true, text: state.lastAgentMessage };
}

function exitFailure(code: number | null, stderr: string): RunnerResult {
  const details = stderr.trim();
  return {
    ok: false,
    error: `codex exited with code ${String(code)}${details === "" ? "" : `: ${details}`}`,
  };
}

class CodexChildMonitor {
  private phase: MonitorPhase = "running";
  private readonly stdout: CollectedOutput = {
    chunks: [],
    byteLength: 0,
    maxBytes: CODEX_STDOUT_MAX_BYTES,
  };
  private readonly stderr: CollectedOutput = {
    chunks: [],
    byteLength: 0,
    maxBytes: CODEX_STDERR_MAX_BYTES,
  };
  private stopResult: RunnerResult | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private escalationTimeout: ReturnType<typeof setTimeout> | undefined;
  private reapTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly prompt: string,
    private readonly timeoutMs: number,
    private readonly workingDirectory: WorkingDirectory,
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
      this.requestStop({ ok: false, error: `codex stdin error: ${errorMessage(error)}` });
    }
  }

  private readonly onStdoutData = (chunk: Buffer | string): void => {
    this.handleOutput("stdout", this.stdout, chunk);
  };

  private readonly onStderrData = (chunk: Buffer | string): void => {
    this.handleOutput("stderr", this.stderr, chunk);
  };

  private readonly onStdoutError = (error: Error): void => {
    this.requestStop({ ok: false, error: `codex stdout error: ${errorMessage(error)}` });
  };

  private readonly onStderrError = (error: Error): void => {
    this.requestStop({ ok: false, error: `codex stderr error: ${errorMessage(error)}` });
  };

  private readonly onStdinError = (error: Error): void => {
    this.requestStop({ ok: false, error: `codex stdin error: ${errorMessage(error)}` });
  };

  private readonly onProcessError = (error: Error): void => {
    this.requestStop({ ok: false, error: `codex process error: ${errorMessage(error)}` });
  };

  private readonly onTimeout = (): void => {
    this.timeout = undefined;
    this.requestStop({ ok: false, error: `codex timed out after ${this.timeoutMs}ms` });
  };

  private readonly onEscalationTimeout = (): void => {
    this.escalationTimeout = undefined;
    if (this.phase !== "stopping" || this.stopResult === undefined) return;
    const failure = signalChild(this.child, "SIGKILL");
    if (this.phase === "stopping" && failure !== undefined) {
      this.stopResult = appendFailure(this.stopResult, failure);
    }
    if (this.phase === "stopping") {
      this.reapTimeout = setTimeout(this.onReapTimeout, CODEX_FINAL_REAP_MS);
    }
  };

  private readonly onReapTimeout = (): void => {
    this.reapTimeout = undefined;
    if (this.phase !== "stopping" || this.stopResult === undefined) return;
    let result = appendFailure(this.stopResult, "codex termination is unconfirmed after SIGKILL");
    if (this.workingDirectory.owned) {
      result = appendFailure(result, "codex cwd retained because termination is unconfirmed");
    }
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
    this.resolve(withCleanup(result, this.workingDirectory));
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
      error: `codex ${name} exceeded ${output.maxBytes} bytes`,
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
    this.escalationTimeout = setTimeout(this.onEscalationTimeout, CODEX_TERMINATION_GRACE_MS);
  }

  private normalResult(code: number | null): RunnerResult {
    const stdout = outputText(this.stdout);
    return code === 0 ? parseJsonLines(stdout) : exitFailure(code, outputText(this.stderr));
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
  workingDirectory: WorkingDirectory,
): Promise<RunnerResult> {
  return new Promise((resolve) => {
    new CodexChildMonitor(child, prompt, timeoutMs, workingDirectory, resolve).start();
  });
}

export class CliCodexRunner implements LlmRunner {
  private readonly spawnFn: typeof spawn;
  private readonly timeoutMs: number;
  private readonly workingDirectory: string | undefined;

  constructor(opts: CodexRunnerOptions = {}) {
    this.spawnFn = opts.spawnFn ?? spawn;
    this.timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
    this.workingDirectory = opts.workingDirectory;
  }

  run(prompt: string): Promise<RunnerResult> {
    const preparation = prepareWorkingDirectory(this.workingDirectory);
    if (!preparation.ok) return Promise.resolve(preparation.result);
    const workingDirectory = preparation.value;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnFn("codex", CODEX_ARGS, {
        cwd: workingDirectory.path,
        env: codexEnvironment(process.env),
      });
    } catch (error) {
      return Promise.resolve(
        withCleanup(
          { ok: false, error: `failed to spawn codex: ${errorMessage(error)}` },
          workingDirectory,
        ),
      );
    }
    return monitorChild(child, prompt, this.timeoutMs, workingDirectory);
  }
}
