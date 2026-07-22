# V "Visual & Legibility" Implementation Plan

> **For agentic workers:** Same regime as before: TDD where testable, all prior Global Constraints apply, no reviewer sub-agents, commit is part of the task.

**Goal:** The town looks like a game (Kenney CC0 sprites) and residents' minds are readable in-game (tap → observation panel with the LLM's reasoning; speech bubbles on new plans).

Assets are already committed under `packages/client/public/assets/{tiny-town,tiny-dungeon}/Tiles/*.png` (16×16, CC0, License.txt included). Do not download anything.

## Task V-1: lastThought through the stack (server/shared)

**Files:**
- Modify: `packages/shared/src/world.ts` (`AgentState.lastThought: string | null`), `packages/server/src/sim/worldGen.ts` (init null), `packages/server/src/sim/engine.ts` (`applyPlan(agentId, tasks, source, reasoning?: string)` stores `lastThought = reasoning ?? null`), `packages/server/src/llm/thoughtBroker.ts` + `packages/server/src/llm/llmPlanner.ts` (thread `reasoning` from parsePlanResponse through planAsync result and broker applyPlan call)
- Tests: extend existing worldGen/engine/thoughtBroker/llmPlanner tests.

**Contract:** FakePlanner paths always yield `lastThought: null`; an LLM plan carries its `reasoning` sentence. Round-trip test in shared protocol fixture updated.

**Branch/commit:** `v1-last-thought` / `feat(server): carry llm reasoning as agent lastThought`

## Task V-2: Sprite rendering (client)

**Files:**
- Modify: `packages/client/src/render/mapLayer.ts`, `agentLayer.ts`, `colors.ts` (may shrink/remove), `packages/client/src/main.ts` (asset preload via Pixi Assets)
- Create: `packages/client/src/render/sprites.ts` — single module mapping game concepts → texture paths/ids. ALL tile-index choices live here with a comment naming what the tile depicts.

**Contract:**
- Terrain: grass and dirt/rock variants from tiny-town; water may be a Pixi Graphics/tinted tile if no suitable sprite exists (state the choice in the commit body). Forest = grass + tree sprite; tree disappears when the tile's resource is depleted (resource=null ⇒ no tree).
- Food tiles: a distinct plant/bush sprite; stockpile: a building/chest sprite from tiny-town.
- Agents: three distinct character sprites from tiny-dungeon Tiles; horizontal flip for left/right facing based on movement direction; name label kept; thinking "…" and gold LLM ring preserved.
- Pixel-art crispness: `TextureStyle.defaultOptions.scaleMode = "nearest"` (Pixi v8), world scale unchanged (fit logic from M2X-B untouched).
- `pnpm --filter @agent-town/client build` succeeds; `just check`/`just test` green; verify visually via `just serve` + a local browser check and describe what you saw in the commit body.

**Branch/commit:** `v1-sprites` / `feat(client): kenney sprite rendering for map and agents`

## Task V-3: Observation panel + speech bubbles (client)

**Files:**
- Create: `packages/client/src/ui/inspectPanel.ts` (DOM overlay, not Pixi)
- Modify: `packages/client/src/main.ts`, `packages/client/src/render/agentLayer.ts` (hit areas / tap detection; bubble rendering), `packages/client/index.html` (panel root + minimal CSS)
- Test: pure logic (e.g. bubble scheduling, panel view-model formatting) in `packages/client/test/inspectPanel.test.ts`; DOM/Pixi glue untested.

**Contract:**
- Tap/click an agent → panel (right side on desktop, bottom sheet on mobile ≤600px) shows: name, planSource badge, current activity kind, task queue (kind + target coords), and `lastThought` (verbatim, styled as a quote). Updates live while open; × closes; tapping empty ground closes.
- Speech bubble: when an agent's `lastThought` CHANGES to a non-null value, show a bubble above the agent with the first ~40 chars for 6 seconds (Pixi container; must not break fit/pan/zoom).
- Panel must not capture pan/zoom gestures outside itself.

**Branch/commit:** `v1-inspect-panel` / `feat(client): observation panel and thought bubbles`

## Order

V-1 and V-2 run in parallel (separate worktrees). V-3 starts after both merge. Supervisor smokes the full stack with `just serve-llm` + tunnel after V-3.
