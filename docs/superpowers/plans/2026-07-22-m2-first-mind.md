# M2 "First Mind" Implementation Plan

> **For agentic workers:** Same regime as M1: one task per worker, TDD mandatory, respect the M1 plan's Global Constraints (they carry over verbatim) plus the additions below. Do NOT dispatch reviewer sub-agents; the supervisor reviews. Commit is part of every task.

**Goal:** One resident (Ash) plans their day with a real LLM (`claude -p`, subscription auth) through the `Planner` seam, asynchronously — the sim never blocks on thinking — with schema validation, one retry, and FakePlanner fallback. The other residents stay rule-based.

**Architecture:** The sim core stays synchronous and deterministic. A new `ThoughtBroker` sits OUTSIDE the engine: it watches trigger conditions (game-day boundary, empty task queue), dispatches async LLM plan requests (concurrency 1, per-agent cooldown), and injects validated results between ticks via `engine.applyPlan()`. LLM I/O lives in `packages/server/src/llm/`, never imported by `sim/` — `sim/` remains pure. CI never calls the real CLI: the runner is injected and mocked in all tests; real-LLM verification is a supervisor-run smoke.

**Tech Stack additions:** none (child_process + existing stack).

## Global Constraints (M2 additions)

- `packages/server/src/sim/**` MUST NOT import from `llm/` or `net/`. The broker imports sim, never the reverse.
- No test may spawn the real `claude` binary. `ClaudeRunner` is constructor-injected everywhere.
- LLM mode is opt-in via env `LLM_PLANNER=1` (read once in `index.ts`, passed down as config). Default off; CI runs without it.
- All LLM-failure paths (timeout, malformed JSON, invalid plan after retry) degrade to FakePlanner output and log one structured line — the town never stalls.
- New constants live in `packages/shared/src/constants.ts`: `TICKS_PER_DAY = 2400`, `THINK_COOLDOWN_TICKS = 300`, `MAX_PLAN_TASKS = 8`, `LLM_TIMEOUT_MS = 90_000`.

---

### Task M2-1: Shared types for planning state

**Files:**
- Modify: `packages/shared/src/constants.ts` (add the four constants above)
- Modify: `packages/shared/src/world.ts`
- Modify: `packages/shared/test/protocol.test.ts` (extend round-trip fixture)

**Interfaces (contract):** extend `AgentState` with exactly:

```ts
export type PlanSource = "fake" | "llm";

export interface AgentState {
  // ...existing fields unchanged...
  planSource: PlanSource;
  thinking: boolean;
}
```

`generateWorld` initializes `planSource: "fake"`, `thinking: false` (adjust worldGen + its tests).

**Steps:** failing test (round-trip preserves new fields; worldGen initializes them) → implement → `just check` + `just test` green → commit `feat(shared): plan-source and thinking state for agents`. Branch `m2-1-shared-planning-state`.

### Task M2-2: Plan prompt builder + response validation

**Files:**
- Create: `packages/server/src/llm/planPrompt.ts`, `packages/server/src/llm/planSchema.ts`
- Test: `packages/server/test/planPrompt.test.ts`, `packages/server/test/planSchema.test.ts`

**Interfaces (contract):**

```ts
// planPrompt.ts — pure, deterministic
export function buildPlanPrompt(world: WorldState, agent: AgentState): string;
// Includes: agent name + 1-line persona ("Ash, a diligent forester who worries about winter"),
// agent pos/carrying, stockpile pos + wood/food vs targets, the 5 nearest wood tiles and
// 5 nearest food tiles with coordinates and amounts (Manhattan-nearest, deterministic
// tie-break by index), and STRICT output instructions: reply with ONLY a JSON object
// {"reasoning": "<one short sentence>", "plan": [{"kind":"moveTo","dest":{"x":0,"y":0}} |
// {"kind":"gather","resource":"wood"|"food","target":{"x":0,"y":0}} | {"kind":"deposit"}]}
// with 1..MAX_PLAN_TASKS tasks.

// planSchema.ts — pure
export type PlanParseResult =
  | { ok: true; tasks: AgentTask[]; reasoning: string }
  | { ok: false; error: string };
export function parsePlanResponse(raw: string): PlanParseResult;
// Tolerates surrounding prose/code fences: extracts the first balanced {...} block, JSON.parses,
// structurally validates every task (no `any`; Record<string,unknown> narrowing like protocol.ts).
export function validatePlanExecutability(
  world: WorldState, agent: AgentState, tasks: AgentTask[],
): { ok: true } | { ok: false; error: string };
// Rejects: dest/target out of bounds or unwalkable; gather target tile lacking the named
// resource; empty plan; length > MAX_PLAN_TASKS.
```

**Steps:** failing tests (prompt contains nearest-resource coords & JSON instruction; parse accepts clean JSON, fenced JSON, JSON with prose around it; rejects garbage, wrong kinds, >MAX tasks; executability rejects water dest / depleted gather / accepts a valid wood run) → implement → green → commit `feat(server): llm plan prompt and response validation`. Branch `m2-2-plan-prompt-schema`.

### Task M2-3: Claude CLI runner + LlmPlanner with fallback

**Files:**
- Create: `packages/server/src/llm/claudeRunner.ts`, `packages/server/src/llm/llmPlanner.ts`
- Test: `packages/server/test/claudeRunner.test.ts`, `packages/server/test/llmPlanner.test.ts`

**Interfaces (contract):**

```ts
// claudeRunner.ts
export type RunnerResult = { ok: true; text: string } | { ok: false; error: string };
export interface ClaudeRunner { run(prompt: string): Promise<RunnerResult>; }
export class CliClaudeRunner implements ClaudeRunner {
  constructor(opts?: { spawnFn?: typeof import("node:child_process").spawn; timeoutMs?: number });
  // spawns: claude -p --output-format json  (prompt via stdin), parses the wrapper JSON,
  // returns its `result` field as text. Timeout (default LLM_TIMEOUT_MS) kills the child
  // and returns { ok: false }. Non-zero exit or unparseable wrapper => { ok: false }.
}

// llmPlanner.ts
export class LlmPlanner {
  constructor(runner: ClaudeRunner, fallback: Planner, rng: () => number);
  async planAsync(world: WorldState, agent: AgentState):
    Promise<{ tasks: AgentTask[]; source: PlanSource; reasoning?: string }>;
  // pipeline: buildPlanPrompt -> runner.run -> parsePlanResponse -> validatePlanExecutability.
  // Any failure: retry the FULL pipeline once. Second failure: return fallback.plan(...) with
  // source "fake". Success: source "llm". Exactly one structured console line per attempt:
  // JSON.stringify({at:"llmPlanner", agent: agent.id, outcome, error?}).
}
```

**Steps:** failing tests (runner: fake spawnFn success/exit-1/timeout paths; planner: valid response → llm tasks; garbage twice → fallback + source fake; garbage then valid → llm; runner never called with empty prompt) → implement → green → commit `feat(server): claude cli runner and llm planner with fallback`. Branch `m2-3-llm-planner`.

### Task M2-4: ThoughtBroker + engine integration

**Files:**
- Create: `packages/server/src/llm/thoughtBroker.ts`
- Modify: `packages/server/src/sim/engine.ts` (add `applyPlan`, day-boundary hook)
- Modify: `packages/server/src/index.ts` (wire behind `LLM_PLANNER=1`)
- Modify: `justfile` (add `dev-llm` recipe: `LLM_PLANNER=1` variant of dev)
- Test: `packages/server/test/thoughtBroker.test.ts`, extend `packages/server/test/engine.test.ts`

**Interfaces (contract):**

```ts
// engine.ts additions
applyPlan(agentId: string, tasks: AgentTask[], source: PlanSource): void;
// replaces the agent's task queue + planSource; clears thinking. No-op with one structured
// warn line if agent id unknown.
isDayBoundary(): boolean; // true when world.tick % TICKS_PER_DAY === 0 && tick > 0

// thoughtBroker.ts
export class ThoughtBroker {
  constructor(opts: {
    engine: Engine; llmAgentIds: string[];
    planFn: (world: WorldState, agent: AgentState) => Promise<{tasks: AgentTask[]; source: PlanSource}>;
  });
  onTick(): void;
  // For each managed agent: dispatch when NOT already thinking AND cooldown elapsed AND
  // (day boundary OR task queue empty). Marks agent.thinking = true. Concurrency: max 1
  // in-flight request total (queue the rest). On resolve: engine.applyPlan(...), set
  // cooldown = world.tick + THINK_COOLDOWN_TICKS. While thinking, the agent's empty queue
  // is filled by the engine's normal FakePlanner path (interim work) — applyPlan replaces it.
  inFlightCount(): number; // for tests
}
```

Engine keeps its sync `Planner` for everyone (interim + non-LLM agents); the broker only overlays LLM results. `wsServer` calls `broker.onTick()` right after `engine.step()` when LLM mode is on.

**Steps:** failing tests (deterministic: fake planFn with manually-resolved promises; assert dispatch on empty-queue + day boundary, cooldown respected, single-flight, applyPlan swaps queue & source & thinking flag, unknown id warns) → implement → green → commit `feat(server): thought broker for async llm planning`. Branch `m2-4-thought-broker`.

### Task M2-5: Surface planning state in client

**Files:**
- Modify: `packages/server/src/net/wsServer.ts` (agents payload already carries full AgentState — verify new fields flow; extend its test fixture assertions)
- Modify: `packages/client/src/render/agentLayer.ts` (draw "…" text above an agent while `thinking`; gold ring around agents whose `planSource === "llm"`)
- Modify: `packages/client/src/net/wsClient.ts` + its test only if patching logic needs it
- Test: extend `packages/client/test/wsClient.test.ts` fixture with the new fields

**Steps:** failing/extended tests → implement → green (`just check`, `just test`) → commit `feat(client): thinking indicator and llm plan-source ring`. Branch `m2-5-client-thinking`.

### Task M2-6: Real-LLM smoke (SUPERVISOR-RUN — not delegated)

- `just dev-llm`; watch server stdout for `{"at":"llmPlanner","agent":"<ash-id>","outcome":"llm"}`.
- Confirm via ws probe that Ash's `planSource` flips to `"llm"` and tasks execute.
- Then update `README.md` (short "LLM mode" section: requires logged-in `claude` CLI, `just dev-llm`) and commit `docs: llm planner mode`.

## Self-Review Notes

- Spec coverage: §3 planner trigger (a) day boundary and (b) plan exhaustion covered; triggers (c) player dialogue and (d) events are M4 scope. §3 scheduler cooldown/concurrency covered by broker. Retry-once + fake fallback per spec §3/§8. Memory (§4) intentionally NOT in M2 — prompt is stateless world snapshot; memory stream lands in M3.
- Determinism: engine still pure; broker injects between ticks; tests never touch real CLI.
- Type consistency: `PlanSource`/`applyPlan`/`planAsync` signatures cross-checked across tasks 1/3/4/5.
