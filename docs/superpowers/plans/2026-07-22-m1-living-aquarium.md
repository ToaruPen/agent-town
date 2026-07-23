# M1 "Living Aquarium" Implementation Plan

> **For agentic workers:** Tasks are executed one at a time by Codex worker threads under Claude supervision. Each task is self-contained: read only this plan section plus the files it names. Steps use checkbox (`- [ ]`) syntax for tracking. TDD is mandatory: write the failing test first, watch it fail, implement, watch it pass, commit.

**Goal:** A browser shows a living town: 3 rule-based agents pathfind across a generated tile map, gather wood/food, and deposit it at a stockpile — no LLM involved yet.

**Architecture:** Authoritative Node.js simulation server (fixed 10 ticks/sec) broadcasts state over WebSocket; a PixiJS browser client only renders. `packages/shared` holds the domain types and wire protocol both sides import. The rule-based `FakePlanner` occupies the exact seam where the LLM planner will plug in at M2.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Node.js ≥ 22, `ws`, PixiJS v8, Vite, Vitest, Biome, just.

## Global Constraints

- TypeScript `strict: true` plus `noUncheckedIndexedAccess: true` and `exactOptionalPropertyTypes: true` in `tsconfig.base.json`; never weakened per-package.
- Biome is the only linter/formatter. `noExplicitAny: error`, `noExcessiveCognitiveComplexity` with `maxAllowedComplexity: 10`, `noEmptyBlockStatements: error`. No `biome-ignore` comments without a one-line justification.
- No error swallowing: every `catch` either rethrows, returns a typed error result, or logs with context and changes control flow. Empty catch blocks are forbidden.
- Simulation code (`packages/server/src/sim/**`) must be deterministic: no `Date.now()`, no unseeded `Math.random()`. All randomness flows from the seeded RNG injected at world creation.
- The simulation never imports from `net/` or anything async; it is a pure `(state, tick) → state` layer. Network code adapts around it.
- All game constants (map size, tick rate, gather durations, stockpile targets) live in `packages/shared/src/constants.ts` — never inline magic numbers in sim logic.
- Conventional Commits (`feat:`, `test:`, `chore:`); one commit per green test cycle; never commit with failing `just check` or `just test`.
- No absolute local paths (`/Users/...`) in any committed file, commit message, or doc.
- LLM-facing docs (AGENTS.md) in English. Do not create README prose beyond what Task 9 specifies.

## File Structure (target at end of M1)

```
agent-town/
  justfile
  package.json  pnpm-workspace.yaml  biome.json  tsconfig.base.json
  AGENTS.md  CLAUDE.md
  docs/superpowers/{specs,plans}/
  packages/
    shared/   src/{constants.ts, world.ts, protocol.ts, index.ts}
    server/   src/{index.ts, sim/{rng.ts, worldGen.ts, astar.ts, executor.ts, fakePlanner.ts, engine.ts}, net/wsServer.ts}
              test/{worldGen.test.ts, astar.test.ts, executor.test.ts, fakePlanner.test.ts, engine.test.ts, wsServer.test.ts}
    client/   index.html  src/{main.ts, net/wsClient.ts, render/{colors.ts, mapLayer.ts, agentLayer.ts, hudLayer.ts}}
```

---

### Task 1: Monorepo scaffold, tooling, quality gates

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `justfile`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`
- Create: `packages/{shared,server,client}/package.json`, `packages/{shared,server,client}/tsconfig.json`
- Create: `packages/shared/src/index.ts` (placeholder export), `packages/server/src/index.ts` (placeholder), `packages/client/src/main.ts` (placeholder)

**Interfaces:**
- Produces: `just check` (biome + tsc all packages), `just test` (vitest all packages), `just dev` (server + client concurrently), `just fmt`. Package names `@agent-town/shared`, `@agent-town/server`, `@agent-town/client`; server/client depend on `@agent-town/shared` via `workspace:*`.

**Steps:**

- [ ] **1. Scaffold pnpm workspace.** Root `package.json` is `"private": true` with `devDependencies`: `typescript`, `@biomejs/biome`, `vitest`. `pnpm-workspace.yaml` lists `packages/*`. Each package: `"type": "module"`. Server deps: `ws`, `@types/ws`, `tsx`. Client deps: `pixi.js@^8`, `vite`.
- [ ] **2. Write `tsconfig.base.json`** with exactly:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "skipLibCheck": true
  }
}
```

Each package `tsconfig.json` extends it (client overrides `module`/`moduleResolution` to `ESNext`/`Bundler` for Vite).

- [ ] **3. Write `biome.json`**: formatter on (2-space indent, 100 line width), linter with `recommended: true` plus rules `suspicious.noExplicitAny: "error"`, `suspicious.noEmptyBlockStatements: "error"`, `complexity.noExcessiveCognitiveComplexity: {"level": "error", "options": {"maxAllowedComplexity": 10}}`.
- [ ] **4. Write `justfile`**:

```make
dev:
    npx concurrently -k "pnpm --filter @agent-town/server dev" "pnpm --filter @agent-town/client dev"
test *ARGS:
    pnpm vitest run {{ARGS}}
check:
    pnpm biome check . && pnpm -r exec tsc
fmt:
    pnpm biome check --write .
```

(add `concurrently` to root devDependencies)

- [ ] **5. Write `AGENTS.md`** with exactly this content:

```markdown
# AGENTS.md

Colony-sim game where residents are LLM agents. Spec: docs/superpowers/specs/ (Japanese). Current milestone plan: docs/superpowers/plans/.

## Layout
- packages/shared — domain types, wire protocol, game constants. No runtime deps.
- packages/server — authoritative simulation (src/sim, deterministic, pure) + WebSocket adapter (src/net).
- packages/client — PixiJS renderer. Renders server state; owns no game logic.

## Rules
- TDD: failing test → implement → green → commit (Conventional Commits).
- `just check` and `just test` must pass before every commit.
- sim/ is deterministic: seeded RNG only, no Date.now(), no I/O, no imports from net/.
- Game constants live in packages/shared/src/constants.ts, never inline.
- No `any`, no empty catch, cognitive complexity ≤ 10 (Biome enforces).
- Do not add dependencies without a note in the commit body explaining why.
- No absolute local paths in committed content.
```

`CLAUDE.md` contains one line: `See AGENTS.md.`

- [ ] **6. Placeholder sources** so tsc has input: `packages/shared/src/index.ts` exports `export const PKG = "shared";` etc.
- [ ] **7. Write `.github/workflows/ci.yml`** with exactly:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: extractions/setup-just@v2
      - run: pnpm install --frozen-lockfile
      - run: just check
      - run: just test
      - run: npx secretlint --secretlintrc .secretlintrc.json "**/*"
```

plus `.secretlintrc.json` using `@secretlint/secretlint-rule-preset-recommend` (add as devDependency). Set `"packageManager"` field in root package.json so `pnpm/action-setup` resolves the version.

- [ ] **8. Verify:** `pnpm install` succeeds; `just check` passes; `just test` passes (vitest exits 0 with "no test files" via `--passWithNoTests` flag in root vitest config or justfile arg); `npx secretlint "**/*"` passes.
- [ ] **9. Commit** `chore: scaffold pnpm monorepo with biome/tsc/vitest/just gates and ci`.

> **Push policy:** workers commit locally only. The supervisor reviews each task's diff, then pushes to `origin/main` (public GitHub repo). CI (check + test + secretlint) must be green after every push. There is no deploy stage — the game runs locally by design (spec §2), so "CD" is CI-gated main.

### Task 2: Shared domain types, constants, and wire protocol

**Files:**
- Create: `packages/shared/src/constants.ts`, `packages/shared/src/world.ts`, `packages/shared/src/protocol.ts`; rewrite `packages/shared/src/index.ts` to re-export all three.
- Test: `packages/shared/test/protocol.test.ts`

**Interfaces (this IS the contract — copy verbatim):**

`constants.ts`:

```ts
export const TICK_RATE = 10; // sim ticks per second
export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 48;
export const AGENT_COUNT = 3;
export const MOVE_TICKS_PER_TILE = 3;
export const GATHER_TICKS = 20;
export const CARRY_CAPACITY = 5;
export const STOCKPILE_TARGET_WOOD = 30;
export const STOCKPILE_TARGET_FOOD = 20;
export const WS_PORT = 8790;
```

`world.ts`:

```ts
export type Terrain = "plains" | "forest" | "water" | "rock";
export type ResourceKind = "wood" | "food";

export interface Tile {
  terrain: Terrain;
  /** Remaining harvestable amount; only > 0 on forest (wood) or plains berry tiles (food). */
  resource: { kind: ResourceKind; amount: number } | null;
}

export interface Position { x: number; y: number }

export type AgentActivity =
  | { kind: "idle" }
  | { kind: "moving"; path: Position[]; ticksIntoStep: number }
  | { kind: "gathering"; target: Position; ticksRemaining: number }
  | { kind: "depositing" };

export interface AgentState {
  id: string;
  name: string;
  pos: Position;
  carrying: { kind: ResourceKind; amount: number } | null;
  activity: AgentActivity;
  /** Current task queue, head = active. */
  tasks: AgentTask[];
}

export type AgentTask =
  | { kind: "moveTo"; dest: Position }
  | { kind: "gather"; resource: ResourceKind; target: Position }
  | { kind: "deposit" };

export interface WorldState {
  tick: number;
  width: number;
  height: number;
  tiles: Tile[]; // row-major, index = y * width + x
  agents: AgentState[];
  stockpile: { pos: Position; wood: number; food: number };
}
```

`protocol.ts`:

```ts
import type { AgentState, Position, Tile, WorldState } from "./world.js";

export type ServerMessage =
  | { type: "welcome"; state: WorldState }
  | {
      type: "update";
      tick: number;
      agents: AgentState[];
      stockpile: { pos: Position; wood: number; food: number };
      changedTiles: { index: number; tile: Tile }[];
    };

export type ClientMessage = { type: "hello" };

export function encodeMessage(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}

export function decodeServerMessage(raw: string): ServerMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isServerMessage(parsed)) throw new Error(`invalid server message: ${raw.slice(0, 120)}`);
  return parsed;
}

export function decodeClientMessage(raw: string): ClientMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isClientMessage(parsed)) throw new Error(`invalid client message: ${raw.slice(0, 120)}`);
  return parsed;
}
```

with `isServerMessage` / `isClientMessage` structural guards (check `type` field and required keys; no `any` — use `Record<string, unknown>` narrowing).

**Steps:**

- [ ] **1. Failing test** `protocol.test.ts`: encode→decode round-trip for a `welcome` message with a minimal `WorldState`; `decodeServerMessage("{}")` throws; `decodeClientMessage('{"type":"hello"}')` returns hello.
- [ ] **2.** Run `just test packages/shared` — FAIL (modules missing).
- [ ] **3.** Implement the three files exactly as specified.
- [ ] **4.** `just test` and `just check` green.
- [ ] **5. Commit** `feat(shared): domain types, constants, and ws protocol`.

### Task 3: Seeded RNG + world generation

**Files:**
- Create: `packages/server/src/sim/rng.ts`, `packages/server/src/sim/worldGen.ts`
- Test: `packages/server/test/worldGen.test.ts`

**Interfaces:**
- Produces: `createRng(seed: number): () => number` (mulberry32; returns float in [0,1)). `generateWorld(seed: number): WorldState` — deterministic; ~25% forest tiles with `{kind:"wood", amount: 20..50}`, ~8% plains tiles with `{kind:"food", amount: 10..30}`, water/rock impassable patches, stockpile on a central walkable plains tile, `AGENT_COUNT` agents named "トネリコ", "シラカバ", "スギ" spawned on distinct walkable tiles adjacent to the stockpile, all `activity: {kind:"idle"}`, empty task queues, tick 0.
- Consumes: types/constants from `@agent-town/shared`.

**Steps:**

- [ ] **1. Failing tests:** same seed ⇒ deep-equal worlds; different seeds ⇒ different tile layouts; stockpile tile is walkable (`plains`); every agent spawn is walkable and distinct; tiles array length is `MAP_WIDTH * MAP_HEIGHT`; forest tiles carry wood resources.
- [ ] **2.** Run — FAIL. **3.** Implement. **4.** Green + `just check`. **5. Commit** `feat(server): seeded rng and deterministic world generation`.

### Task 4: A* pathfinding

**Files:**
- Create: `packages/server/src/sim/astar.ts`
- Test: `packages/server/test/astar.test.ts`

**Interfaces:**
- Produces: `findPath(world: WorldState, from: Position, to: Position): Position[] | null` — 4-directional, walkable = terrain `plains` or `forest`, returns tile sequence excluding `from` including `to`, `null` when unreachable, Manhattan heuristic, binary-heap or sorted-array open set (map is 64×48; O(n log n) fine).
- Note: walkability as a helper `isWalkable(world: WorldState, pos: Position): boolean` exported for reuse by the executor.

**Steps:**

- [ ] **1. Failing tests:** straight-line path on open ground has length = Manhattan distance; path routes around a hand-built water wall (construct a small custom `WorldState` fixture, not `generateWorld`); unreachable target (fully walled) ⇒ null; `from === to` ⇒ `[]`; out-of-bounds target ⇒ null.
- [ ] **2.** FAIL. **3.** Implement. **4.** Green. **5. Commit** `feat(server): a* pathfinding over tile grid`.

### Task 5: Task executor (move / gather / deposit)

**Files:**
- Create: `packages/server/src/sim/executor.ts`
- Test: `packages/server/test/executor.test.ts`

**Interfaces:**
- Produces: `stepAgent(world: WorldState, agent: AgentState): void` — mutates `world`/`agent` in place, advances the head task by one tick:
  - `moveTo`: on first tick compute path via `findPath` and set activity `moving`; each `MOVE_TICKS_PER_TILE` ticks pop next path step into `pos`; arrival ⇒ task done (shift queue), activity `idle`. Unreachable ⇒ drop task, activity `idle` (planner will react next pass).
  - `gather`: requires agent adjacent-or-on target tile with matching resource; counts down from `GATHER_TICKS`; on completion transfers `min(CARRY_CAPACITY, tile.resource.amount)` into `agent.carrying`, decrements tile resource (delete `resource` when 0), task done. If precondition broken (no resource) ⇒ drop task.
  - `deposit`: requires agent on/adjacent to stockpile; adds carried amount to `stockpile.wood|food`, clears `carrying`, task done.
  - Empty queue ⇒ activity `idle`, no-op.
- Consumes: `findPath`, `isWalkable` (Task 4); types (Task 2).

**Steps:**

- [ ] **1. Failing tests** (small fixture worlds): agent completes `moveTo` in `distance * MOVE_TICKS_PER_TILE` ticks; gather transfers exactly `CARRY_CAPACITY` and depletes tile; gathering a depleted tile drops the task; deposit adds to the correct stockpile field and empties hands; unreachable moveTo drops the task and leaves agent idle.
- [ ] **2.** FAIL. **3.** Implement (keep each task-kind handler its own function — complexity gate). **4.** Green. **5. Commit** `feat(server): per-tick task executor for move/gather/deposit`.

### Task 6: FakePlanner + engine loop

**Files:**
- Create: `packages/server/src/sim/fakePlanner.ts`, `packages/server/src/sim/engine.ts`
- Test: `packages/server/test/fakePlanner.test.ts`, `packages/server/test/engine.test.ts`

**Interfaces:**
- Produces:
  - `interface Planner { plan(world: WorldState, agent: AgentState): AgentTask[] }` (exported from `fakePlanner.ts` — this interface is the M2 LLM seam).
  - `class FakePlanner implements Planner` — if carrying ⇒ `[moveTo stockpile.pos, deposit]` (executor requires on/adjacent stockpile to deposit); else if `stockpile.wood < STOCKPILE_TARGET_WOOD` ⇒ moveTo+gather nearest wood tile with resources; else if food below target ⇒ same for food; else moveTo a random walkable tile within radius 5 (wander, uses injected rng).
  - `createEngine(world: WorldState, planner: Planner, rng: () => number)` returning `{ world, step(): void }` — `step()` = one tick: for each agent, if task queue empty ask planner, then `stepAgent`; increment `world.tick`.
- Consumes: everything from Tasks 2–5.

**Steps:**

- [ ] **1. Failing tests:** planner assigns gather-wood when stockpile empty; planner assigns deposit when carrying; **acceptance test** — run `createEngine(generateWorld(42), new FakePlanner(rng), rng)` for 3000 steps: `stockpile.wood > 0 && stockpile.food > 0`, no agent ever stands on water/rock (assert during loop), engine is deterministic (two runs with seed 42 produce identical `JSON.stringify(world)`).
- [ ] **2.** FAIL. **3.** Implement. **4.** Green. **5. Commit** `feat(server): rule-based planner and deterministic engine loop`.

### Task 7: WebSocket server

**Files:**
- Create: `packages/server/src/net/wsServer.ts`; rewrite `packages/server/src/index.ts`
- Test: `packages/server/test/wsServer.test.ts`

**Interfaces:**
- Produces: `startServer(opts: { port: number; seed: number }): { close(): Promise<void> }` — creates engine, `setInterval` at `1000 / TICK_RATE`, on each tick: `engine.step()` then broadcast `update` (agents + stockpile + tiles changed since last broadcast — track dirty tile indexes in a `Set` populated by comparing resource references before/after step, or have executor push to a dirty list exposed by the engine: choose the simpler dirty-set on engine, `engine.drainDirtyTiles(): number[]`). New connection ⇒ send `welcome` with full state. `index.ts` calls `startServer({ port: WS_PORT, seed: Date.now() % 2**31 })` — the only place wall-clock is allowed. Add `"dev": "tsx watch src/index.ts"` script.
- Consumes: engine (Task 6), protocol (Task 2).

**Steps:**

- [ ] **1. Failing test** (vitest, real `ws` client against `startServer` on an ephemeral port, seed fixed): client receives `welcome` with 64×48 tiles and 3 agents; within 2s receives an `update` whose `tick` increased; messages all pass `decodeServerMessage`; `close()` resolves and the interval stops (no open handles — use vitest `--pool=forks` default and assert close).
- [ ] **2.** FAIL. **3.** Implement. **4.** Green + `just check`. **5. Commit** `feat(server): websocket broadcast server with dirty-tile updates`.

### Task 8: PixiJS client

**Files:**
- Create: `packages/client/index.html`, `packages/client/vite.config.ts`, `packages/client/src/main.ts`, `packages/client/src/net/wsClient.ts`, `packages/client/src/render/colors.ts`, `packages/client/src/render/mapLayer.ts`, `packages/client/src/render/agentLayer.ts`, `packages/client/src/render/hudLayer.ts`
- Test: none automated in M1 (render layer); `wsClient.ts` gets `packages/client/test/wsClient.test.ts` for message handling with a mocked socket.

**Interfaces:**
- Consumes: protocol/types from shared; server from Task 7 on `ws://localhost:8790`.
- Produces (internal): `connect(url: string, handlers: { onWelcome(s: WorldState): void; onUpdate(u): void }): void` in `wsClient.ts` (auto-reconnect with 1s backoff); `mapLayer` draws tiles as 12px rects (colors.ts: plains #7aa35c, forest #3e6b2f, water #3b6ea5, rock #6d6d6d, resource markers: darker green square for wood amount>0, red dot for food); `agentLayer` draws agents as 10px circles (distinct colors per agent, name label, small carry-indicator square when carrying); `hudLayer` shows `tick`, `wood`, `food` text (PixiJS `Text`), updated per update message.
- Rendering rule: client keeps a local `WorldState` copy — `welcome` replaces it, `update` patches agents/stockpile/changedTiles; a Pixi ticker re-renders dirty layers only.

**Steps:**

- [ ] **1. Failing test:** `wsClient` applies `welcome` then `update` patches to its local state (mock WebSocket via constructor injection — accept a `WebSocketLike` factory param).
- [ ] **2.** FAIL. **3.** Implement wsClient. **4.** Green.
- [ ] **5.** Implement render layers + `main.ts` (Pixi `Application`, one `Container` per layer). `vite.config.ts`: default, port 5173.
- [ ] **6. Manual verification (worker must actually run it):** `just dev`; open `http://localhost:5173`; confirm map renders, 3 named agents move tile-to-tile, HUD wood/food counters increase over ~1 minute. Record what you saw in the commit body.
- [ ] **7. Commit** `feat(client): pixijs renderer with live websocket state`.

### Task 9: End-to-end acceptance + docs

**Files:**
- Create: `README.md`
- Modify: anything small the acceptance run reveals (bugfixes only, each with a failing-then-passing test per repo rules).

**Steps:**

- [ ] **1.** Fresh checkout simulation: `git clean -xfd` (confirm no untracked junk needed), `pnpm install`, `just check`, `just test` — all green.
- [ ] **2.** `just dev` + browser: 5-minute soak — agents keep cycling gather→deposit, no console errors, HUD counters rise until targets then agents wander.
- [ ] **3.** `README.md`: title, 2-sentence description, prerequisites (Node ≥ 22, pnpm, just), `pnpm install` / `just dev` / `just test` / `just check`, pointer to `docs/superpowers/specs/` — nothing else.
- [ ] **4. Commit** `docs: readme with setup and run instructions`.

---

## Self-Review Notes

- Spec §2 (stack), §3 (two-layer brain: FakePlanner = planner seam), §5 (world/resources/buildings-lite: stockpile only in M1 by design), §9 (tooling/gates), M1 row of §7 — covered by Tasks 1–9. Spec §3 LLM planner, §4 memory, §6 interventions are M2+ by design.
- Hunger/fatigue (§5) deliberately deferred to M2 planning context — M1 acceptance doesn't need them; noted here so the gap is explicit, not forgotten.
- Type names cross-checked: `AgentTask`/`AgentState`/`WorldState`/`Planner`/`stepAgent`/`findPath`/`createEngine` consistent across Tasks 2–8.
