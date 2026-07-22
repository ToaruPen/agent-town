# V2 "Tap Everything + Sprite Legibility" Implementation Plan

> **For agentic workers:** Same regime. TDD for pure logic; gates before commit; no reviewer sub-agents; commit is part of the task.

Owner-reported problem: sprites visually overlap into an unreadable mush; owner wants EVERY object tappable with an info bubble.

## Task V2-1: Legibility + universal tap-to-inspect (client)

**Files:** `packages/client/src/render/{mapLayer,agentLayer,sprites}.ts`, `packages/client/src/main.ts`, `packages/client/src/ui/inspectPanel.ts` (+ new `packages/client/src/ui/infoBubble.ts`), tests in `packages/client/test/`.

**A. Sprite legibility (root causes to fix):**
1. `TILE_SIZE` 12 → 16 (native texture size; integer pixel-art scaling; world fit-scale already handles overall sizing).
2. Y-sorting: within the world container, enable `sortableChildren` (or equivalent manual ordering) so objects lower on screen render in front; agents always in front of terrain features on the same tile.
3. Same-tile agent separation: when N agents occupy one tile, offset each by a deterministic small jitter (e.g. ±4px pattern by index) so all remain visible.
4. Name labels: smaller, only show on hover/selection OR when zoomed in past 1.5× fit — pick one, state in commit body. Labels must never cover another agent's sprite at default zoom.

**B. Universal tap-to-inspect:**
- One `infoBubble.ts` component: a single bubble at a time, positioned above the tapped object in world space (flips below near the top edge), dismissed by tapping elsewhere, panning, or zooming.
- Hit priority at tap point: agent > tombstone > house > stockpile > resource tile (tree/bush) > terrain tile.
- Bubble contents:
  - Agent: name, planSource badge, activity kind, hunger/fatigue/health as compact bars or numbers, current lastThought first line. Tapping the bubble opens the full inspect panel (existing behavior preserved).
  - Tree tile: "Tree — wood N remaining"; bush: "Berries — food N remaining"; depleted shows regrowth note (and "dormant in winter" during winter).
  - House: "House — under construction P%" or "House — capacity 2".
  - Stockpile: wood/food amounts + food-days forecast (reuse HUD view-model).
  - Tombstone: "Here lies NAME — died day D of CAUSE".
  - Terrain: terrain kind + coordinates.
- Tap vs drag: a pointerup within 8px of pointerdown and <300ms is a tap; otherwise it's a pan (existing pan/zoom must not regress).
- View-model formatting = pure functions with tests (all bubble text builders). Hit-priority resolution = pure function with tests.

**Branch/commit:** `v2-tap-everything` / `feat(client): universal tap-to-inspect bubbles and sprite legibility`
