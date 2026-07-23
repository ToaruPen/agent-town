# 複数LLMプロバイダー・ルーティング Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同じ街のLLM管理住民を、明示的な名前ルートによってClaudeまたはCodexへ決定的に振り分け、割当とFake安全網の状態を画面で確認できるようにする。

**Architecture:** `LLM_AGENTS`は管理対象選択、`LLM_ROUTES`はプロバイダー選択として分離する。共有状態には割当先`llmProvider`を追加し、サーバーでは汎用`LlmRunner`、厳密なルート解析、プロバイダー別`LlmPlanner`レジストリを既存`ThoughtBroker`へ接続する。単一思考キューと同一プロバイダー内2回再試行は維持し、プロバイダー間フォールバックは実装しない。

**Tech Stack:** TypeScript 7、Node.js child processes、Claude Code CLI、OpenAI Codex CLI、Vitest、PixiJS、WebSocket、Biome、pnpm、just

---

## 実行前提とファイル責務

実装ブランチは、承認済み設計書と、`feat(client): universal tap-to-inspect bubbles and sprite legibility`が統合されたcleanな`main`から作る。実装前に`just check`と`just test`が成功することを確認する。新しい依存関係は追加しない。

| ファイル | 責務 |
|---|---|
| `packages/shared/src/world.ts` | `LlmProvider`と住民の割当状態 |
| `packages/server/src/llm/llmRunner.ts` | プロバイダー非依存のランナー契約 |
| `packages/server/src/llm/claudeRunner.ts` | Claude CLI固有の起動・出力変換 |
| `packages/server/src/llm/codexRunner.ts` | 隔離したCodex CLI起動・JSONL変換 |
| `packages/server/src/llm/llmProviderRouting.ts` | `LLM_ROUTES`の解析、検証、名前解決 |
| `packages/server/src/llm/llmPlanner.ts` | 1プロバイダー内の再試行、検証、Fake安全網、ログ |
| `packages/server/src/llm/thoughtBroker.ts` | 管理住民への割当反映と単一キュー dispatch |
| `packages/server/src/net/wsServer.ts` | runner/plannerレジストリ構築とルーター配線 |
| `packages/server/src/index.ts` | `LLM_ROUTES`環境変数の受け渡し |
| `packages/client/src/ui/providerBadge.ts` | 割当と直近計画元から表示ラベルを生成 |
| `packages/client/src/ui/inspectPanel.ts` | 詳細パネルのプロバイダー表示 |
| `packages/client/src/ui/infoBubble.ts` | 住民吹き出しのプロバイダー表示 |
| `README.md` | 混在ルートの起動例と運用上の意味 |

## Task 1: 共有状態にプロバイダー割当を追加する

**Files:**
- Modify: `packages/shared/src/world.ts`
- Modify: `packages/server/src/sim/worldGen.ts`
- Modify: `packages/server/src/sim/engine.ts`
- Modify: `packages/shared/test/protocol.test.ts`
- Modify: `packages/server/test/worldGen.test.ts`
- Modify: `packages/server/test/engine.test.ts`
- Modify fixtures in: `packages/shared/test/time.test.ts`, `packages/client/test/infoBubble.test.ts`, `packages/client/test/inspectPanel.test.ts`, `packages/client/test/keyboardNavigation.test.ts`, `packages/client/test/sprites.test.ts`, `packages/client/test/survivalViewModel.test.ts`, `packages/client/test/wsClient.test.ts`, `packages/server/test/executor.test.ts`, `packages/server/test/fakePlanner.test.ts`, `packages/server/test/llmAgentSelection.test.ts`, `packages/server/test/llmPlanner.test.ts`, `packages/server/test/planPrompt.test.ts`, `packages/server/test/planSchema.test.ts`, `packages/server/test/thoughtBroker.test.ts`, `packages/server/test/wsServer.test.ts`

- [ ] **Step 1: 初期住民と移住者の期待値を先に追加する**

`packages/server/test/worldGen.test.ts`の初期住民検証へ次を追加する。

```ts
expect(agent.llmProvider).toBeNull();
```

`packages/server/test/engine.test.ts`の移住成功テストでは、追加された住民を取得して次を検証する。

```ts
const immigrant = engine.world.agents.find(({ name }) => name === IMMIGRANT_NAMES[0]);
expect(immigrant?.llmProvider).toBeNull();
```

`packages/shared/test/protocol.test.ts`のwelcome用住民に`llmProvider: "codex"`を追加し、round-trip後にも保持される既存のdeep equalityを利用する。

- [ ] **Step 2: focused testを実行して失敗を確認する**

Run:

```sh
pnpm vitest run packages/server/test/worldGen.test.ts packages/server/test/engine.test.ts packages/shared/test/protocol.test.ts
```

Expected: `llmProvider`が存在しないため、初期住民または移住者の期待値がFAILする。

- [ ] **Step 3: 共有型と生成箇所へ最小実装を追加する**

`packages/shared/src/world.ts`へ型と必須フィールドを追加する。

```ts
export type PlanSource = "fake" | "llm";
export type LlmProvider = "claude" | "codex";

export interface AgentState {
  id: string;
  name: string;
  pos: Position;
  carrying: { kind: ResourceKind; amount: number } | null;
  activity: AgentActivity;
  tasks: AgentTask[];
  planSource: PlanSource;
  llmProvider: LlmProvider | null;
  thinking: boolean;
  lastThought: string | null;
  hunger: number;
  fatigue: number;
  health: number;
}
```

`packages/server/src/sim/worldGen.ts`の初期住民と`packages/server/src/sim/engine.ts`の移住者生成で、`planSource`直後に次を追加する。

```ts
planSource: "fake",
llmProvider: null,
thinking: false,
```

- [ ] **Step 4: 全テストfixtureを新しい必須契約へ合わせる**

上記Filesに列挙した各`AgentState` fixtureで、LLM割当を意図していない場合は次を使う。

```ts
planSource: "fake",
llmProvider: null,
```

LLM計画を表すfixtureはプロバイダーも明示する。

```ts
planSource: "llm",
llmProvider: "claude",
```

このtaskでは実際のルーティングをまだ行わず、生成時の値は常に`null`とする。

- [ ] **Step 5: focused testと型検査を通す**

Run:

```sh
pnpm vitest run packages/server/test/worldGen.test.ts packages/server/test/engine.test.ts packages/shared/test/protocol.test.ts
pnpm -r exec tsc
```

Expected: tests PASS、TypeScript errors 0。

- [ ] **Step 6: 意図した所有箇所だけにフィールドが入ったことを確認する**

Run:

```sh
rg -n 'llmProvider:' packages --glob '*.ts'
git diff --check
```

Expected: 生成元2箇所、共有型、明示したtest fixtureだけが列挙され、whitespace errorなし。

- [ ] **Step 7: commitする**

```sh
git add packages/shared/src/world.ts packages/shared/test packages/server/src/sim packages/server/test packages/client/test
git commit -m "feat(shared): track resident llm provider assignment"
```

## Task 2: `LLM_ROUTES`を厳密かつ決定的に解析する

**Files:**
- Create: `packages/server/src/llm/llmProviderRouting.ts`
- Create: `packages/server/test/llmProviderRouting.test.ts`
- Read: `packages/server/src/llm/llmAgentSelection.ts`

- [ ] **Step 1: 正常系と優先順位の失敗テストを書く**

`packages/server/test/llmProviderRouting.test.ts`を次のfixtureと検証で作る。

```ts
import type { AgentState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { parseLlmAgentSelection } from "../src/llm/llmAgentSelection.js";
import {
  llmProviderForAgent,
  parseLlmProviderRoutes,
} from "../src/llm/llmProviderRouting.js";

function agent(id: string, name: string): AgentState {
  return {
    id,
    name,
    pos: { x: 0, y: 0 },
    carrying: null,
    activity: { kind: "idle" },
    tasks: [],
    planSource: "fake",
    llmProvider: null,
    thinking: false,
    lastThought: null,
    hunger: 100,
    fatigue: 100,
    health: 100,
  };
}

const residents = [agent("agent-1", "Ash"), agent("agent-2", "Birch")];

describe("LLM provider routes", () => {
  it("defaults every managed resident to codex", () => {
    const selection = parseLlmAgentSelection(undefined, residents);
    const routes = parseLlmProviderRoutes(undefined, residents, selection);

    expect(llmProviderForAgent(routes, residents[0] as AgentState)).toBe("codex");
    expect(llmProviderForAgent(routes, agent("agent-3", "Cedar"))).toBe("codex");
  });

  it("prefers an exact route and applies the wildcard to future residents", () => {
    const selection = parseLlmAgentSelection("all", residents);
    const routes = parseLlmProviderRoutes(" Ash : claude , * : codex ", residents, selection);

    expect(llmProviderForAgent(routes, residents[0] as AgentState)).toBe("claude");
    expect(llmProviderForAgent(routes, residents[1] as AgentState)).toBe("codex");
    expect(llmProviderForAgent(routes, agent("agent-3", "Cedar"))).toBe("codex");
  });

  it("allows complete exact routes for a fixed selection", () => {
    const selection = parseLlmAgentSelection("Ash,Birch", residents);
    const routes = parseLlmProviderRoutes(
      "Ash:claude,Birch:codex",
      residents,
      selection,
    );

    expect(llmProviderForAgent(routes, residents[0] as AgentState)).toBe("claude");
    expect(llmProviderForAgent(routes, residents[1] as AgentState)).toBe("codex");
  });
});
```

- [ ] **Step 2: 正常系testが未実装moduleで失敗することを確認する**

Run:

```sh
pnpm vitest run packages/server/test/llmProviderRouting.test.ts
```

Expected: `llmProviderRouting.js`をresolveできずFAIL。

- [ ] **Step 3: 異常系testを同じファイルへ追加する**

```ts
it.each([
  ["", "all"],
  ["Ash", "all"],
  [":claude", "all"],
  ["Ash:", "all"],
  ["Ash:openai", "all"],
  ["Ash:claude,Ash:codex", "all"],
  ["*:claude,*:codex", "all"],
  ["Unknown:claude,*:codex", "all"],
  ["Ash:claude", "all"],
  ["Ash:claude", "Ash,Birch"],
] as const)("rejects invalid routes %j for selection %j", (setting, selected) => {
  const selection = parseLlmAgentSelection(selected, residents);
  expect(() => parseLlmProviderRoutes(setting, residents, selection)).toThrow(/LLM_ROUTES/);
});

it("allows a route for a known but currently unmanaged resident", () => {
  const selection = parseLlmAgentSelection("Ash", residents);
  const routes = parseLlmProviderRoutes(
    "Ash:claude,Birch:codex",
    residents,
    selection,
  );
  expect(llmProviderForAgent(routes, residents[0] as AgentState)).toBe("claude");
});
```

- [ ] **Step 4: ルーターを最小実装する**

`packages/server/src/llm/llmProviderRouting.ts`を次の契約で実装する。

```ts
import type { AgentState, LlmProvider } from "@agent-town/shared";

import type { LlmAgentSelection } from "./llmAgentSelection.js";

const DEFAULT_ROUTES = "*:codex";

export interface LlmProviderRoutes {
  exact: ReadonlyMap<string, LlmProvider>;
  wildcard: LlmProvider | null;
}

function routeError(detail: string): Error {
  return new Error(`invalid LLM_ROUTES: ${detail}`);
}

function parseProvider(raw: string): LlmProvider {
  if (raw === "claude" || raw === "codex") return raw;
  throw routeError(`unknown provider '${raw}'`);
}

function selectedResidents(selection: LlmAgentSelection, agents: AgentState[]): AgentState[] {
  if (selection.kind === "all") return agents;
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return selection.agentIds.map((id) => {
    const selected = byId.get(id);
    if (selected === undefined) throw routeError(`selected agent id '${id}' is missing`);
    return selected;
  });
}

export function llmProviderForAgent(
  routes: LlmProviderRoutes,
  agent: AgentState,
): LlmProvider {
  const provider = routes.exact.get(agent.name) ?? routes.wildcard;
  if (provider === null) throw routeError(`no route for agent '${agent.name}'`);
  return provider;
}

export function parseLlmProviderRoutes(
  setting: string | undefined,
  agents: AgentState[],
  selection: LlmAgentSelection,
): LlmProviderRoutes {
  const raw = setting ?? DEFAULT_ROUTES;
  if (raw.trim() === "") throw routeError("setting must not be empty");
  const knownNames = new Set(agents.map(({ name }) => name));
  const exact = new Map<string, LlmProvider>();
  let wildcard: LlmProvider | null = null;

  for (const rawEntry of raw.split(",")) {
    const parts = rawEntry.split(":");
    if (parts.length !== 2) throw routeError(`invalid entry '${rawEntry.trim()}'`);
    const selector = parts[0]?.trim() ?? "";
    const rawProvider = parts[1]?.trim() ?? "";
    if (selector === "" || rawProvider === "") throw routeError("empty selector or provider");
    const provider = parseProvider(rawProvider);
    if (selector === "*") {
      if (wildcard !== null) throw routeError("'*' must not be repeated");
      wildcard = provider;
      continue;
    }
    if (!knownNames.has(selector)) throw routeError(`unknown agent name '${selector}'`);
    if (exact.has(selector)) throw routeError(`agent name '${selector}' is repeated`);
    exact.set(selector, provider);
  }

  const routes: LlmProviderRoutes = { exact, wildcard };
  if (selection.kind === "all" && wildcard === null) {
    throw routeError("'all' selection requires a '*' route for future residents");
  }
  for (const agent of selectedResidents(selection, agents)) llmProviderForAgent(routes, agent);
  return routes;
}
```

- [ ] **Step 5: focused testを通す**

Run:

```sh
pnpm vitest run packages/server/test/llmProviderRouting.test.ts packages/server/test/llmAgentSelection.test.ts
```

Expected: 2 test files PASS。

- [ ] **Step 6: checkしてcommitする**

```sh
just check
git diff --check
git add packages/server/src/llm/llmProviderRouting.ts packages/server/test/llmProviderRouting.test.ts
git commit -m "feat(llm): parse deterministic provider routes"
```

## Task 3: Claude固有だったランナー境界を汎用化する

**Files:**
- Create: `packages/server/src/llm/llmRunner.ts`
- Modify: `packages/server/src/llm/claudeRunner.ts`
- Modify: `packages/server/src/llm/llmPlanner.ts`
- Modify: `packages/server/test/claudeRunner.test.ts`
- Modify: `packages/server/test/llmPlanner.test.ts`

- [ ] **Step 1: 汎用interfaceを要求する型testを先に書く**

`packages/server/test/claudeRunner.test.ts`で型をimportし、既存インスタンスを代入する。

```ts
import type { LlmRunner } from "../src/llm/llmRunner.js";

const runner: LlmRunner = new CliClaudeRunner({ spawnFn });
const resultPromise = runner.run("Plan Ash's day.");
```

- [ ] **Step 2: 型検査がmissing moduleで失敗することを確認する**

Run:

```sh
pnpm --filter @agent-town/server exec tsc
```

Expected: `llmRunner.js`をresolveできずFAIL。

- [ ] **Step 3: 汎用interfaceを作り、Claude実装を接続する**

`packages/server/src/llm/llmRunner.ts`:

```ts
export type RunnerResult = { ok: true; text: string } | { ok: false; error: string };

export interface LlmRunner {
  run(prompt: string): Promise<RunnerResult>;
}
```

`packages/server/src/llm/claudeRunner.ts`から`RunnerResult`と`ClaudeRunner`宣言を削除し、次を使う。

```ts
import type { LlmRunner, RunnerResult } from "./llmRunner.js";

export class CliClaudeRunner implements LlmRunner {
```

`packages/server/src/llm/llmPlanner.ts`と`packages/server/test/llmPlanner.test.ts`の`ClaudeRunner` importを`LlmRunner`へ置換し、fixture型も次の形へ揃える。

```ts
const runner: LlmRunner = { run };
```

- [ ] **Step 4: Claudeのcharacterization testsと全型検査を通す**

Run:

```sh
pnpm vitest run packages/server/test/claudeRunner.test.ts packages/server/test/llmPlanner.test.ts
pnpm -r exec tsc
```

Expected: tests PASS、TypeScript errors 0。Claudeのspawn引数、JSON wrapper、timeout挙動は変更なし。

- [ ] **Step 5: commitする**

```sh
git diff --check
git add packages/server/src/llm/llmRunner.ts packages/server/src/llm/claudeRunner.ts packages/server/src/llm/llmPlanner.ts packages/server/test/claudeRunner.test.ts packages/server/test/llmPlanner.test.ts
git commit -m "refactor(llm): generalize cli runner contract"
```

## Task 4: 隔離されたCodex CLIランナーを追加する

**Files:**
- Create: `packages/server/src/llm/codexRunner.ts`
- Create: `packages/server/test/codexRunner.test.ts`
- Read: `packages/server/src/llm/claudeRunner.ts`

- [ ] **Step 1: 正常系のspawn、stdin、JSONL抽出testを書く**

`packages/server/test/codexRunner.test.ts`にfake childを用意する。

```ts
import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { CliCodexRunner } from "../src/llm/codexRunner.js";

function createFakeChild(): ChildProcessWithoutNullStreams {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  }) as unknown as ChildProcessWithoutNullStreams;
}

describe("CliCodexRunner", () => {
  it("runs isolated codex exec and returns the final agent message", async () => {
    const child = createFakeChild();
    const spawnMock = vi.fn(() => child);
    const spawnFn = spawnMock as unknown as typeof spawn;
    let stdin = "";
    child.stdin.on("data", (chunk: Buffer) => {
      stdin += chunk.toString();
    });

    const resultPromise = new CliCodexRunner({
      spawnFn,
      workingDirectory: "neutral-codex-cwd",
    }).run("Plan Birch's day.");
    child.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "thread-1" })}\n`);
    child.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: '{"reasoning":"Work.","plan":[]}' },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
      })}\n`,
    );
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      text: '{"reasoning":"Work.","plan":[]}',
    });
    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--json",
        "-",
      ],
      { cwd: "neutral-codex-cwd" },
    );
    expect(stdin).toBe("Plan Birch's day.");
  });
});
```

- [ ] **Step 2: testがmissing moduleで失敗することを確認する**

Run:

```sh
pnpm vitest run packages/server/test/codexRunner.test.ts
```

Expected: `codexRunner.js`をresolveできずFAIL。

- [ ] **Step 3: 失敗形状のtestsを追加する**

同じdescribeへ次のcasesを追加する。

```ts
it.each([
  ["not-json\n", "invalid codex JSONL"],
  [`${JSON.stringify({ type: "turn.completed", usage: {} })}\n`, "no agent message"],
  [
    `${JSON.stringify({ type: "turn.failed", error: { message: "model unavailable" } })}\n`,
    "model unavailable",
  ],
] as const)("rejects unsuccessful JSONL output", async (stdout, expectedError) => {
  const child = createFakeChild();
  const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
  const resultPromise = new CliCodexRunner({
    spawnFn,
    workingDirectory: "neutral-codex-cwd",
  }).run("Plan.");
  child.stdout.end(stdout);
  child.emit("close", 0);
  await expect(resultPromise).resolves.toEqual({
    ok: false,
    error: expect.stringContaining(expectedError),
  });
});

it("returns stderr when codex exits non-zero", async () => {
  const child = createFakeChild();
  const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
  const resultPromise = new CliCodexRunner({
    spawnFn,
    workingDirectory: "neutral-codex-cwd",
  }).run("Plan.");
  child.stderr.end("authentication failed");
  child.emit("close", 1);
  await expect(resultPromise).resolves.toEqual({
    ok: false,
    error: expect.stringContaining("authentication failed"),
  });
});

it("kills codex and returns an error on timeout", async () => {
  vi.useFakeTimers();
  try {
    const child = createFakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof spawn;
    const resultPromise = new CliCodexRunner({
      spawnFn,
      timeoutMs: 25,
      workingDirectory: "neutral-codex-cwd",
    }).run("Plan.");
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
```

- [ ] **Step 4: JSONL parserとprocess lifecycleを実装する**

`packages/server/src/llm/codexRunner.ts`を次の責務で実装する。

```ts
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LLM_TIMEOUT_MS } from "@agent-town/shared";

import type { LlmRunner, RunnerResult } from "./llmRunner.js";

const CODEX_ARGS = [
  "exec",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--sandbox",
  "read-only",
  "--skip-git-repo-check",
  "--color",
  "never",
  "--json",
  "-",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function eventError(event: Record<string, unknown>): string {
  const error = event.error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof event.message === "string") return event.message;
  return "codex reported an unsuccessful turn";
}

function parseCodexJsonl(raw: string): RunnerResult {
  let finalMessage: string | null = null;
  let completed = false;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `invalid codex JSONL: ${message}` };
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      return { ok: false, error: "invalid codex JSONL event" };
    }
    if (event.type === "turn.failed" || event.type === "error") {
      return { ok: false, error: eventError(event) };
    }
    if (event.type === "turn.completed") completed = true;
    if (event.type !== "item.completed" || !isRecord(event.item)) continue;
    if (event.item.type === "agent_message" && typeof event.item.text === "string") {
      finalMessage = event.item.text;
    }
  }
  if (!completed) return { ok: false, error: "codex turn did not complete" };
  return finalMessage === null
    ? { ok: false, error: "codex output has no agent message" }
    : { ok: true, text: finalMessage };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function removeOwnedDirectory(directory: string | null): string | null {
  if (directory === null) return null;
  try {
    rmSync(directory, { recursive: true, force: true });
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

interface CodexRunnerOptions {
  spawnFn?: typeof spawn;
  timeoutMs?: number;
  workingDirectory?: string;
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
    let ownedDirectory: string | null = null;
    let cwd: string;
    try {
      cwd = this.workingDirectory ?? mkdtempSync(join(tmpdir(), "agent-town-codex-"));
      if (this.workingDirectory === undefined) ownedDirectory = cwd;
    } catch (error) {
      return Promise.resolve({ ok: false, error: `failed to prepare codex cwd: ${errorMessage(error)}` });
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnFn("codex", [...CODEX_ARGS], { cwd });
    } catch (error) {
      const cleanupError = removeOwnedDirectory(ownedDirectory);
      if (cleanupError !== null) {
        return Promise.resolve({
          ok: false,
          error: `failed to spawn codex: ${errorMessage(error)}; cleanup failed: ${cleanupError}`,
        });
      }
      return Promise.resolve({ ok: false, error: `failed to spawn codex: ${errorMessage(error)}` });
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
        const cleanupError = removeOwnedDirectory(ownedDirectory);
        resolve(
          cleanupError === null
            ? result
            : { ok: false, error: `failed to clean codex cwd: ${cleanupError}` },
        );
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
        finish({ ok: false, error: `codex process error: ${errorMessage(error)}` });
      });
      child.on("close", (code) => {
        if (code !== 0) {
          const details = stderr.trim();
          finish({
            ok: false,
            error: `codex exited with code ${String(code)}${details === "" ? "" : `: ${details}`}`,
          });
          return;
        }
        finish(parseCodexJsonl(stdout));
      });
      timeout = setTimeout(() => {
        finish({ ok: false, error: `codex timed out after ${this.timeoutMs}ms` });
        child.kill();
      }, this.timeoutMs);
      child.stdin.end(prompt);
    });
  }
}
```

- [ ] **Step 5: focused testsを通し、cleanup failureを握りつぶしていないことを確認する**

Run:

```sh
pnpm vitest run packages/server/test/codexRunner.test.ts packages/server/test/claudeRunner.test.ts
pnpm --filter @agent-town/server exec tsc
rg -n 'catch\s*\{\s*\}' packages/server/src/llm
```

Expected: tests PASS、TypeScript errors 0、空catchなし。一時ディレクトリ削除失敗は`RunnerResult`のfailureとして返り、例外を無視しない。

- [ ] **Step 6: commitする**

```sh
just check
git diff --check
git add packages/server/src/llm/codexRunner.ts packages/server/test/codexRunner.test.ts
git commit -m "feat(llm): add isolated codex cli runner"
```

## Security hardening addendum: provider計画境界をactionなしに揃える

Task 4の独立セキュリティレビューで、`read-only`は書込みを制限するだけで、
host読取りやprovider側hosted actionの境界にはならないことが確認された。
Task 5へ進む前に、次の追加TDDを完了する。

**Files:**
- Modify: `packages/server/src/llm/claudeRunner.ts`
- Modify: `packages/server/src/llm/codexRunner.ts`
- Modify: `packages/server/src/llm/planSchema.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: 対応するrunnerとschemaのtest

- [x] Claudeは`--safe-mode`、`--tools ""`、strictな空MCP設定、skills/Chrome/session無効で起動する。
- [x] Codexはshell、plugins/apps、multi-agent、image generation、browser、computer、web searchを起動時に無効化する。
- [x] 両CLIの子プロセス環境をprovider別allowlistへ制限する。
- [x] stdout、stderr、最終messageをUTF-8 byte数で制限し、超過時はfail-closedで停止する。
- [x] timeout後はSIGTERM、SIGKILL、最終reap期限の順に処理し、永久pendingを残さない。
- [x] `reasoning`を永続化前に最大512 Unicode code pointsへ制限する。
- [x] mock失敗diffが実際の認証値やproxy値を展開しないよう、argvとenvのassertionを分離する。
- [x] 実機否定スモークでClaudeのshellとCodexのshell/web/image generation/browser/computer actionが利用不能であることを確認する。

レビューで追加されたこのtaskも、実装担当、仕様レビュー、品質レビュー、セキュリティ再レビューを分離して完了させる。

## Task 5: `LlmPlanner`へプロバイダー識別と完全な結果ログを追加する

**Files:**
- Modify: `packages/server/src/llm/llmPlanner.ts`
- Modify: `packages/server/test/llmPlanner.test.ts`

- [ ] **Step 1: provider、attempt、Fake採用ログの失敗testを書く**

既存のvalid response testでconstructorを次へ変更し、ログ期待値を厳密化する。

```ts
const result = await new LlmPlanner("codex", runner, fallback).planAsync(world, agent);

expect(log).toHaveBeenCalledWith(
  JSON.stringify({
    at: "llmPlanner",
    agent: agent.id,
    provider: "codex",
    attempt: 1,
    outcome: "llm",
  }),
);
```

2回失敗testへ次を追加する。

```ts
expect(log).toHaveBeenLastCalledWith(
  JSON.stringify({ at: "llmPlanner", agent: agent.id, provider: "claude", outcome: "fake" }),
);
```

- [ ] **Step 2: focused testが旧constructorまたは旧ログで失敗することを確認する**

Run:

```sh
pnpm vitest run packages/server/test/llmPlanner.test.ts
```

Expected: constructor signatureまたはlog expectationでFAIL。

- [ ] **Step 3: plannerのprovider-aware loggingを実装する**

`packages/server/src/llm/llmPlanner.ts`でconstructorとlog helperを次の契約へ変える。

```ts
import type {
  AgentState,
  AgentTask,
  LlmProvider,
  PlanSource,
  WorldState,
} from "@agent-town/shared";

type PlannerOutcome = "llm" | "error" | "fake";

function logAttempt(
  agent: AgentState,
  provider: LlmProvider,
  outcome: PlannerOutcome,
  attempt?: number,
  error?: string,
): void {
  const line = {
    at: "llmPlanner",
    agent: agent.id,
    provider,
    ...(attempt === undefined ? {} : { attempt }),
    outcome,
    ...(error === undefined ? {} : { error }),
  };
  console.log(JSON.stringify(line));
}

export class LlmPlanner {
  constructor(
    private readonly provider: LlmProvider,
    private readonly runner: LlmRunner,
    private readonly fallback: Planner,
  ) {}

  async planAsync(world: WorldState, agent: AgentState): Promise<AsyncPlanResult> {
    for (let attempt = 1; attempt <= PLAN_ATTEMPTS; attempt += 1) {
      const runnerResult = await this.runner.run(buildPlanPrompt(world, agent));
      if (!runnerResult.ok) {
        logAttempt(agent, this.provider, "error", attempt, runnerResult.error);
        continue;
      }
      const parsed = parsePlanResponse(runnerResult.text);
      if (!parsed.ok) {
        logAttempt(agent, this.provider, "error", attempt, parsed.error);
        continue;
      }
      const normalized = normalizePlan(world, agent, parsed.tasks);
      if (!normalized.ok) {
        logAttempt(agent, this.provider, "error", attempt, normalized.error);
        continue;
      }
      const executable = validateNormalizedPlanExecutability(world, agent, normalized.tasks);
      if (!executable.ok) {
        logAttempt(agent, this.provider, "error", attempt, executable.error);
        continue;
      }
      logAttempt(agent, this.provider, "llm", attempt);
      return { tasks: normalized.tasks, source: "llm", reasoning: parsed.reasoning };
    }
    logAttempt(agent, this.provider, "fake");
    return { tasks: this.fallback.plan(world, agent), source: "fake" };
  }
}
```

- [ ] **Step 4: 全constructor callを同じsignatureへ揃える**

`packages/server/test/llmPlanner.test.ts`の各fixtureはproviderを明示する。

```ts
new LlmPlanner("claude", runner, fallback)
```

この変更で未使用だった`rng`引数を削除する。乱数挙動はFakePlanner自身の注入済みRNGから変えない。

- [ ] **Step 5: focused testsとlog literal検索を通す**

Run:

```sh
pnpm vitest run packages/server/test/llmPlanner.test.ts
rg -n 'new LlmPlanner' packages/server
rg -n '"at":"llmPlanner"|at: "llmPlanner"' packages/server README.md docs
```

Expected: tests PASS、全constructorが3引数の新契約、旧providerなしログ期待値なし。

- [ ] **Step 6: commitする**

```sh
just check
git diff --check
git add packages/server/src/llm/llmPlanner.ts packages/server/test/llmPlanner.test.ts
git commit -m "feat(llm): report provider-specific planning outcomes"
```

## Task 6: ルーター、plannerレジストリ、ThoughtBrokerを統合する

**Files:**
- Modify: `packages/server/src/llm/thoughtBroker.ts`
- Modify: `packages/server/src/net/wsServer.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/test/thoughtBroker.test.ts`
- Modify: `packages/server/test/wsServer.test.ts`
- Create: `packages/server/test/providerRoutingIntegration.test.ts`

- [ ] **Step 1: ThoughtBrokerの割当と動的移住者testを先に書く**

`ThoughtBrokerOptions`へprovider resolverを要求する前提で、既存testのbroker生成へ次を追加する。

```ts
providerForAgent: () => "claude",
```

`planFn`のfixture signatureはproviderを受け取る。

```ts
// Add `type LlmProvider` to the existing @agent-town/shared import.
const planFn = vi.fn(
  (_world: WorldState, _agent: AgentState, _provider: LlmProvider): Promise<PlanResult> =>
    pending.promise,
);
```

動的新規住民testでは名前ごとのresolverを使い、`onTick()`直後の割当を検証する。

```ts
const broker = new ThoughtBroker({
  engine,
  llmAgentIds: () => engine.world.agents.map(({ id }) => id),
  providerForAgent: (agent) => (agent.name === "Dahlia" ? "codex" : "claude"),
  planFn,
});

engine.world.agents.push(newcomer);
broker.onTick();

expect(newcomer.llmProvider).toBe("codex");
```

- [ ] **Step 2: ThoughtBroker testが新契約未実装で失敗することを確認する**

Run:

```sh
pnpm vitest run packages/server/test/thoughtBroker.test.ts
```

Expected: provider argumentまたは`llmProvider`割当の期待値でFAIL。

- [ ] **Step 3: ThoughtBrokerへ割当同期とprovider付きdispatchを実装する**

`packages/server/src/llm/thoughtBroker.ts`のoptionsを次へ変更する。

```ts
// Add `type LlmProvider` to the existing @agent-town/shared import.
interface ThoughtBrokerOptions {
  engine: Engine;
  llmAgentIds: string[] | (() => string[]);
  providerForAgent(agent: AgentState): LlmProvider;
  planFn(
    world: WorldState,
    agent: AgentState,
    provider: LlmProvider,
  ): Promise<{ tasks: AgentTask[]; source: PlanSource; reasoning?: string }>;
}
```

管理住民を観測するたびに割当を反映するhelperを追加する。

```ts
private assignProvider(agent: AgentState): LlmProvider {
  const provider = this.opts.providerForAgent(agent);
  agent.llmProvider = provider;
  return provider;
}
```

constructorの既存住民loopと`onTick()`の各managed agentで`assignProvider(agent)`を呼ぶ。`dispatchNext()`では同じresolver結果をplan functionへ渡す。

```ts
const provider = this.assignProvider(agent);
this.requestInFlight = true;
void this.opts
  .planFn(this.opts.engine.world, agent, provider)
  .then((result) => this.finishRequest(agentId, result));
```

単一`requestInFlight`、queue順、cooldownは変更しない。

- [ ] **Step 4: サーバーfactory統合の失敗testを書く**

`packages/server/test/providerRoutingIntegration.test.ts`を作り、実CLIを使わずに混在ルートを検証する。

```ts
import type { AgentState, LlmProvider } from "@agent-town/shared";
import { describe, expect, it, vi } from "vitest";

import type { LlmRunner } from "../src/llm/llmRunner.js";
import { createThoughtBroker } from "../src/net/wsServer.js";
import { createEngine } from "../src/sim/engine.js";
import { FakePlanner } from "../src/sim/fakePlanner.js";
import { createRng } from "../src/sim/rng.js";
import { generateWorld } from "../src/sim/worldGen.js";

function runner(run: LlmRunner["run"]): LlmRunner {
  return { run };
}

function setup() {
  const rng = createRng(42);
  const fallback = new FakePlanner(rng);
  const engine = createEngine(generateWorld(42), fallback, rng);
  engine.world.agents = engine.world.agents.slice(0, 2);
  for (const agent of engine.world.agents) agent.tasks = [];
  return { engine, fallback };
}

const validPlan = JSON.stringify({ reasoning: "Observe the town.", plan: [] });

describe("provider routing integration", () => {
  it("routes Ash only to Claude and Birch only to Codex", async () => {
    const { engine, fallback } = setup();
    const claudeRun = vi.fn(async () => ({ ok: true as const, text: validPlan }));
    const codexRun = vi.fn(async () => ({ ok: true as const, text: validPlan }));
    const runners: Readonly<Record<LlmProvider, LlmRunner>> = {
      claude: runner(claudeRun),
      codex: runner(codexRun),
    };
    const broker = createThoughtBroker({
      enabled: true,
      engine,
      fallback,
      llmAgents: "all",
      llmRoutes: "Ash:claude,*:codex",
      runners,
    });

    broker?.onTick();
    await vi.waitFor(() => expect(broker?.inFlightCount()).toBe(0));

    expect(claudeRun).toHaveBeenCalledOnce();
    expect(codexRun).toHaveBeenCalledOnce();
    expect(claudeRun.mock.calls[0]?.[0]).toContain("Ash");
    expect(codexRun.mock.calls[0]?.[0]).toContain("Birch");
    expect(engine.world.agents.map(({ llmProvider }) => llmProvider)).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("does not cross providers when Claude falls back", async () => {
    const { engine, fallback } = setup();
    const claudeRun = vi.fn(async () => ({ ok: false as const, error: "rate limited" }));
    const codexRun = vi.fn(async () => ({ ok: true as const, text: validPlan }));
    const broker = createThoughtBroker({
      enabled: true,
      engine,
      fallback,
      llmAgents: "all",
      llmRoutes: "Ash:claude,*:codex",
      runners: { claude: runner(claudeRun), codex: runner(codexRun) },
    });

    broker?.onTick();
    await vi.waitFor(() => expect(broker?.inFlightCount()).toBe(0));

    const ash = engine.world.agents[0] as AgentState;
    const birch = engine.world.agents[1] as AgentState;
    expect(claudeRun).toHaveBeenCalledTimes(2);
    expect(codexRun).toHaveBeenCalledOnce();
    expect({ provider: ash.llmProvider, source: ash.planSource }).toEqual({
      provider: "claude",
      source: "fake",
    });
    expect({ provider: birch.llmProvider, source: birch.planSource }).toEqual({
      provider: "codex",
      source: "llm",
    });
  });
});
```

- [ ] **Step 5: wsServerへ注入可能なregistryとルート配線を実装する**

`packages/server/src/net/wsServer.ts`で型とfactory optionsを定義する。

```ts
// Add `type LlmProvider` to the existing @agent-town/shared import.
import { CliCodexRunner } from "../llm/codexRunner.js";
import type { LlmRunner } from "../llm/llmRunner.js";
import {
  llmProviderForAgent,
  parseLlmProviderRoutes,
} from "../llm/llmProviderRouting.js";

type LlmRunnerRegistry = Readonly<Record<LlmProvider, LlmRunner>>;

interface ThoughtBrokerFactoryOptions {
  enabled: boolean;
  engine: Engine;
  fallback: FakePlanner;
  llmAgents?: string;
  llmRoutes?: string;
  runners?: LlmRunnerRegistry;
}
```

既存のpositional `createThoughtBroker`を、次のexported factoryへ置換する。

```ts
export function createThoughtBroker(
  opts: ThoughtBrokerFactoryOptions,
): ThoughtBroker | undefined {
  if (!opts.enabled) return undefined;
  const selection = parseLlmAgentSelection(opts.llmAgents, opts.engine.world.agents);
  const routes = parseLlmProviderRoutes(opts.llmRoutes, opts.engine.world.agents, selection);
  const runners: LlmRunnerRegistry = opts.runners ?? {
    claude: new CliClaudeRunner(),
    codex: new CliCodexRunner(),
  };
  const planners: Readonly<Record<LlmProvider, LlmPlanner>> = {
    claude: new LlmPlanner("claude", runners.claude, opts.fallback),
    codex: new LlmPlanner("codex", runners.codex, opts.fallback),
  };

  return new ThoughtBroker({
    engine: opts.engine,
    llmAgentIds: () => llmAgentIdsForWorld(selection, opts.engine.world.agents),
    providerForAgent: (agent) => llmProviderForAgent(routes, agent),
    planFn: (world, agent, provider) => planners[provider].planAsync(world, agent),
  });
}
```

`ServerOptions`へ`llmRoutes?: string`を追加し、`startServer()`のfactory callをobject formへ変える。

```ts
const broker = createThoughtBroker({
  enabled: opts.llmPlannerEnabled === true,
  engine,
  fallback,
  ...(opts.llmAgents === undefined ? {} : { llmAgents: opts.llmAgents }),
  ...(opts.llmRoutes === undefined ? {} : { llmRoutes: opts.llmRoutes }),
});
```

`packages/server/src/index.ts`で環境変数を渡す。

```ts
const llmRoutes = process.env.LLM_ROUTES;

startServer({
  port,
  seed: Date.now() % 2 ** 31,
  llmPlannerEnabled,
  ...(staticDir === undefined ? {} : { staticDir }),
  ...(llmAgents === undefined ? {} : { llmAgents }),
  ...(llmRoutes === undefined ? {} : { llmRoutes }),
});
```

LLMプランナー無効時はfactoryがroute parsing前にreturnし、未使用設定を検証しない。

- [ ] **Step 6: WebSocket状態に割当が流れることを検証する**

`packages/server/test/wsServer.test.ts`の非LLM welcome/update期待値を次へ拡張する。

```ts
expect(welcome.state.agents[0]).toMatchObject({
  planSource: "fake",
  llmProvider: null,
  thinking: false,
});
expect(update.agents[0]).toMatchObject({
  planSource: "fake",
  llmProvider: null,
  thinking: false,
});
```

provider integration testが`engine.world.agents`の同じ共有状態を検証するため、protocolへ別フィールドを追加する必要はない。

- [ ] **Step 7: focusedとserver全testを通す**

Run:

```sh
pnpm vitest run packages/server/test/thoughtBroker.test.ts packages/server/test/providerRoutingIntegration.test.ts packages/server/test/wsServer.test.ts
pnpm vitest run packages/server/test
```

Expected: provider routing、failure isolation、single-flight、immigrant assignmentを含めてPASS。実CLI spawnは0回。

- [ ] **Step 8: 新identifierの所有箇所と品質を確認してcommitする**

```sh
rg -n 'llmRoutes|providerForAgent|LlmRunnerRegistry' packages/server
just check
git diff --check
git add packages/server/src packages/server/test
git commit -m "feat(llm): route residents across provider planners"
```

## Task 7: 割当プロバイダーとFake安全網をUIへ表示する

**Files:**
- Create: `packages/client/src/ui/providerBadge.ts`
- Create: `packages/client/test/providerBadge.test.ts`
- Modify: `packages/client/src/ui/inspectPanel.ts`
- Modify: `packages/client/src/ui/infoBubble.ts`
- Modify: `packages/client/test/inspectPanel.test.ts`
- Modify: `packages/client/test/infoBubble.test.ts`
- Verify unchanged: `packages/client/src/render/agentLayer.ts`, `packages/client/index.html`

- [ ] **Step 1: 5状態のbadge formatter失敗testを書く**

`packages/client/test/providerBadge.test.ts`:

```ts
import type { AgentState } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  buildProviderBadge,
  type ProviderBadge,
} from "../src/ui/providerBadge.js";

type ProviderState = Pick<AgentState, "planSource" | "llmProvider">;

const cases: [ProviderState, ProviderBadge][] = [
  [{ planSource: "fake", llmProvider: null }, { label: "FAKE", tone: "fake" }],
  [{ planSource: "llm", llmProvider: "claude" }, { label: "CLAUDE", tone: "llm" }],
  [{ planSource: "llm", llmProvider: "codex" }, { label: "CODEX", tone: "llm" }],
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
```

- [ ] **Step 2: testがmissing moduleで失敗することを確認する**

Run:

```sh
pnpm vitest run packages/client/test/providerBadge.test.ts
```

Expected: `providerBadge.js`をresolveできずFAIL。

- [ ] **Step 3: pure formatterを実装する**

`packages/client/src/ui/providerBadge.ts`:

```ts
import type { AgentState } from "@agent-town/shared";

export interface ProviderBadge {
  label: string;
  tone: "fake" | "llm";
}

type ProviderState = Pick<AgentState, "planSource" | "llmProvider">;

export function buildProviderBadge(agent: ProviderState): ProviderBadge {
  if (agent.llmProvider === null) return { label: "FAKE", tone: "fake" };
  const provider = agent.llmProvider.toUpperCase();
  return agent.planSource === "llm"
    ? { label: provider, tone: "llm" }
    : { label: `${provider} → FAKE`, tone: "fake" };
}
```

- [ ] **Step 4: 詳細パネルと吹き出しの期待値を先に変更する**

`packages/client/test/inspectPanel.test.ts`のview model期待値で`planSource`を次へ置換する。

```ts
providerBadge: { label: "CLAUDE", tone: "llm" },
```

`packages/client/test/infoBubble.test.ts`ではLLM/Codex、Claude安全網、非管理Fakeを検証する。

```ts
expect(buildAgentBubbleText(makeAgent({ llmProvider: "codex" })).badge).toBe("CODEX");
expect(
  buildAgentBubbleText(makeAgent({ planSource: "fake", llmProvider: "claude" })).badge,
).toBe("CLAUDE → FAKE");
expect(
  buildAgentBubbleText(makeAgent({ planSource: "fake", llmProvider: null })).badge,
).toBe("FAKE");
```

- [ ] **Step 5: UI testsが旧`LLM`表示で失敗することを確認する**

Run:

```sh
pnpm vitest run packages/client/test/providerBadge.test.ts packages/client/test/inspectPanel.test.ts packages/client/test/infoBubble.test.ts
```

Expected: formatter test以外は旧`planSource`/`LLM` expectationでFAIL。

- [ ] **Step 6: 両UIからpure formatterを使う**

`packages/client/src/ui/inspectPanel.ts`でview modelを変更する。

```ts
import { buildProviderBadge, type ProviderBadge } from "./providerBadge.js";

export interface InspectPanelViewModel {
  name: string;
  providerBadge: ProviderBadge;
  activityKind: AgentState["activity"]["kind"];
  tasks: InspectTaskViewModel[];
  needs: NeedViewModel[];
  lastThought: string | null;
}

export function buildInspectPanelViewModel(agent: AgentState): InspectPanelViewModel {
  return {
    name: agent.name,
    providerBadge: buildProviderBadge(agent),
    activityKind: agent.activity.kind,
    tasks: agent.tasks.map((task) => ({ kind: task.kind, target: taskTarget(task) })),
    needs: buildNeedsViewModel(agent),
    lastThought: agent.lastThought,
  };
}
```

panel badge生成は既存CSS toneを再利用する。

```ts
const badge = createElement(
  "span",
  `inspect-panel__badge inspect-panel__badge--${viewModel.providerBadge.tone}`,
  viewModel.providerBadge.label,
);
```

`packages/client/src/ui/infoBubble.ts`のagent formatterも共有helperへ接続する。

```ts
import { buildProviderBadge } from "./providerBadge.js";

export function buildAgentBubbleText(agent: AgentState): AgentBubbleText {
  return {
    title: agent.name,
    badge: buildProviderBadge(agent).label,
    lines: [
      `${agent.activity.kind} · H ${Math.round(agent.hunger)} · F ${Math.round(agent.fatigue)} · HP ${Math.round(agent.health)}`,
      firstThoughtLine(agent.lastThought),
    ],
  };
}
```

`packages/client/index.html`の`--llm`と`--fake` stylesは変更しない。`packages/client/src/render/agentLayer.ts`の金色リングも`planSource === "llm"`のまま維持する。

- [ ] **Step 7: client tests、build、表示literal検索を通す**

Run:

```sh
pnpm vitest run packages/client/test
pnpm --filter @agent-town/client build
rg -n 'planSource\.toUpperCase|providerBadge|CLAUDE → FAKE|CODEX → FAKE' packages/client
```

Expected: client tests PASS、production build PASS、旧`planSource.toUpperCase()`なし、formatter所有箇所だけに複合labelあり。

- [ ] **Step 8: commitする**

```sh
just check
git diff --check
git add packages/client/src/ui packages/client/test
git commit -m "feat(client): show resident llm provider assignments"
```

## Task 8: 運用文書、全品質ゲート、実CLIスモークを完了する

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-22-multi-provider-llm-routing-design.md`（ステータスのみ）
- Verify: all files changed since the design commit

- [ ] **Step 1: READMEのLLM modeを混在ルート契約へ更新する**

`README.md`のLLM modeを次の内容へ置換する。

````markdown
## LLM mode

Residents can be routed independently through logged-in Claude Code and Codex CLIs.
`LLM_AGENTS` selects managed residents; `LLM_ROUTES` assigns each selected resident to a
provider. Exact names win over `*`.

```sh
# All managed residents use Codex (default when LLM_ROUTES is unset)
just dev-llm

# Ash uses Claude; every other current or future resident uses Codex
LLM_AGENTS=all LLM_ROUTES='Ash:claude,*:codex' just dev-llm

# Every managed resident uses Claude
LLM_AGENTS=all LLM_ROUTES='*:claude' just dev-llm
```

Routing is not cross-provider fallback. Each resident retries its assigned provider twice, then
uses the rule-based planner so the town keeps moving. Logs include `agent`, `provider`, `attempt`,
and `outcome`. The UI shows `CLAUDE`, `CODEX`, or `PROVIDER → FAKE` for each managed resident.
````

- [ ] **Step 2: 全自動品質ゲートを順番どおり実行する**

生成済み`packages/client/dist`がある場合は、その正確なディレクトリだけを削除してからcheckする。

Run:

```sh
if test -d packages/client/dist; then rm -r packages/client/dist; fi
just check
just test
pnpm --filter @agent-town/client build
npx secretlint .
git diff --check
```

Expected: 全command exit 0、全test PASS、secret finding 0。

- [ ] **Step 3: Codex単独の実CLIスモークを行う**

1つ目のterminal:

```sh
smoke_dir="$(mktemp -d)"
PORT=8791 LLM_PLANNER=1 LLM_AGENTS=all LLM_ROUTES='*:codex' \
  pnpm --filter @agent-town/server exec tsx src/index.ts >"$smoke_dir/server.log" 2>&1 &
smoke_pid=$!
```

2つ目のterminalで、少なくとも1住民がCodex計画を採用するまで監視する。

```sh
pnpm --filter @agent-town/server exec node --input-type=module -e '
import WebSocket from "ws";
const socket = new WebSocket("ws://127.0.0.1:8791/ws");
const timeout = setTimeout(() => {
  console.error("timed out waiting for Codex plan");
  process.exit(1);
}, 180000);
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  const agents = message.type === "welcome" ? message.state.agents : message.agents;
  if (agents?.some((agent) => agent.llmProvider === "codex" && agent.planSource === "llm")) {
    clearTimeout(timeout);
    socket.close();
    process.exit(0);
  }
});
'
```

1つ目のterminalで結果を確認し、exact PIDだけを終了する。

```sh
rg '"provider":"codex"' "$smoke_dir/server.log"
kill "$smoke_pid"
wait "$smoke_pid" || true
```

Expected: `provider:"codex"`かつ`outcome:"llm"`のlogがあり、monitor exit 0。Codexがファイル変更を行っていないことを`git status --short`で確認する。

- [ ] **Step 4: Claude単独の実CLIスモークを行う**

1つ目のterminal:

```sh
claude_smoke_dir="$(mktemp -d)"
PORT=8792 LLM_PLANNER=1 LLM_AGENTS=all LLM_ROUTES='*:claude' \
  pnpm --filter @agent-town/server exec tsx src/index.ts >"$claude_smoke_dir/server.log" 2>&1 &
claude_smoke_pid=$!
```

2つ目のterminal:

```sh
pnpm --filter @agent-town/server exec node --input-type=module -e '
import WebSocket from "ws";
const socket = new WebSocket("ws://127.0.0.1:8792/ws");
const timeout = setTimeout(() => {
  console.error("timed out waiting for Claude plan");
  process.exit(1);
}, 180000);
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  const agents = message.type === "welcome" ? message.state.agents : message.agents;
  if (agents?.some((agent) => agent.llmProvider === "claude" && agent.planSource === "llm")) {
    clearTimeout(timeout);
    socket.close();
    process.exit(0);
  }
});
'
```

1つ目のterminal:

```sh
rg '"provider":"claude"' "$claude_smoke_dir/server.log"
kill "$claude_smoke_pid"
wait "$claude_smoke_pid" || true
```

Expected: `provider:"claude"`かつ`outcome:"llm"`のlogがあり、monitor exit 0。Claudeの利用制限中なら、リセット時刻後に3つのcommandを再実行し、成功前に完了扱いにしない。

- [ ] **Step 5: 混在ルートの実CLIスモークを行う**

1つ目のterminal:

```sh
mixed_smoke_dir="$(mktemp -d)"
PORT=8793 LLM_PLANNER=1 LLM_AGENTS=all LLM_ROUTES='Ash:claude,*:codex' \
  pnpm --filter @agent-town/server exec tsx src/index.ts >"$mixed_smoke_dir/server.log" 2>&1 &
mixed_smoke_pid=$!
```

2つ目のterminalでは、過去snapshotで一度trueになった条件を保持して両providerを監視する。

```sh
pnpm --filter @agent-town/server exec node --input-type=module -e '
import WebSocket from "ws";
const socket = new WebSocket("ws://127.0.0.1:8793/ws");
let ashUsesClaude = false;
let anotherUsesCodex = false;
const timeout = setTimeout(() => {
  console.error("timed out waiting for mixed provider plans");
  process.exit(1);
}, 180000);
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  const agents = message.type === "welcome" ? message.state.agents : message.agents;
  ashUsesClaude ||= agents?.some(
    (agent) => agent.name === "Ash" && agent.llmProvider === "claude" && agent.planSource === "llm",
  ) ?? false;
  anotherUsesCodex ||= agents?.some(
    (agent) => agent.name !== "Ash" && agent.llmProvider === "codex" && agent.planSource === "llm",
  ) ?? false;
  if (ashUsesClaude && anotherUsesCodex) {
    clearTimeout(timeout);
    socket.close();
    process.exit(0);
  }
});
'
```

1つ目のterminalでprovider/agent対応を確認してexact PIDだけを終了する。

```sh
rg '"provider":"(claude|codex)"' "$mixed_smoke_dir/server.log"
kill "$mixed_smoke_pid"
wait "$mixed_smoke_pid" || true
```

Expected: 両条件が180秒以内にtrue。logではAshに`provider:"claude"`、他住民に`provider:"codex"`があり、逆向き送信がない。

- [ ] **Step 6: 設計書statusを実装済みに更新し、文書commitを作る**

設計書冒頭を次へ変更する。

```markdown
ステータス: 実装・検証済み
```

Run:

```sh
git add README.md docs/superpowers/specs/2026-07-22-multi-provider-llm-routing-design.md
git commit -m "docs: document multi-provider llm operation"
```

- [ ] **Step 7: 最終差分を自己レビューする**

Run:

```sh
git diff --stat main...HEAD
git log --oneline main..HEAD
rg -n 'TO[D]O|TB[D]|FIXM[E]|sankenbisha|agent-town-provider-routing' README.md docs packages
just check
just test
pnpm --filter @agent-town/client build
git status --short
```

Expected: 意図したファイルのみ、未解決placeholderなし、ローカル絶対pathなし、全gate成功、worktree clean。

## 仕様対応表

| 設計要件 | 実装task |
|---|---|
| `LLM_AGENTS`と`LLM_ROUTES`の分離 | Task 2, 6 |
| exact優先、`*`、未設定`*:codex` | Task 2 |
| 起動時の厳密検証 | Task 2, 6 |
| `planSource`と`llmProvider`の分離 | Task 1, 6 |
| Claude/Codex共通runner境界 | Task 3 |
| isolated Codex CLI、JSONL、timeout | Task 4 |
| 同一provider 2回再試行、Fake安全網 | Task 5 |
| provider間fallbackなし | Task 5, 6 |
| 単一思考キュー維持 | Task 6 |
| 新規移住者のwildcard割当 | Task 2, 6 |
| UIの5状態表示 | Task 7 |
| 構造化provider log | Task 5 |
| 自動testと実CLI混在smoke | Task 8 |
