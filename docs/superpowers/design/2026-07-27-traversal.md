# World Map ↔ Local Map Traversal — Design

Date: 2026-07-27
Status: proposal. Read-only investigation; no repository files were created or modified.
Scope: the traversal design only. Nation-scale simulation, scoring and directive legality are out of scope and stay on the server.

---

## 0. Answer to the question that decides the cost

**The resident-scale renderers are not coupled to live engine output. They are coupled to the `WorldState` *data shape*, and a synthesized object of that shape drives them today.** The RimWorld-style view is therefore mostly free, and the finding that changes the plan lies elsewhere:

1. **The client physically cannot reuse `worldGen.ts`.** `packages/client/package.json` declares exactly three dependencies — `@agent-town/shared`, `pixi.js`, `vite`. There is no path from the client to `packages/server`. Reuse would mean moving the generator into `shared` or sending its output over the wire.
2. **The world map is not PixiJS.** It is HTML Canvas 2D (`renderWorldMapCanvas`, 6 px cells) hosted inside the `#world-chronicle` modal. The Pixi scene *is* the local map. The two scales are already two renderers with two coordinate systems, which inverts the "where does the scale switch live" question.
3. **`createWorldViewport` binds its handlers to `stage`,** so two instances on one stage fight over pan and zoom. Shared-camera continuous zoom is not a small change.
4. **The nation clock and the resident season helper disagree by 16×.** Feeding a nation tick into a synthesized `WorldState.tick` puts the ground in the wrong season. Fixable in one expression, but silent if missed.

---

## 1. Findings

### 1.1 Exact input shapes (Q1)

`packages/client/src/render/mapLayer.ts:120`

```ts
export function renderMapLayer(
  groundLayer: Container,
  objectLayer: Container,
  state: WorldState,
): void
```

`packages/client/src/render/terrainDecor.ts:55,70,89`

```ts
export function drawWater(graphics: Graphics, world: WorldState): void
export function drawRockCluster(graphics: Graphics, world: WorldState): void
export function drawSnowSheet(graphics: Graphics, world: WorldState): void
```

`packages/client/src/render/trailLayer.ts:175`

```ts
export function renderTrailLayer(
  layer: Container,
  world: WorldState,
  showTrafficOverlay = false,
): void
```

`packages/client/src/render/structureLayer.ts:122`

```ts
export function renderStructureLayer(layer: Container, buildings: Building[]): void
```

`packages/client/src/render/agentLayer.ts:229,247` and its interaction record at `:48`

```ts
export function renderAgentLayer(
  layer: Container,
  agents: AgentState[],
  bubbles: ReadonlyMap<string, ThoughtBubble>,
  interactions: AgentLayerInteractions,
): void

export function interpolateAgentLayer(layer: Container, deltaMs: number): void

export interface AgentLayerInteractions {
  selectedAgentId: string | null;
  hoveredAgentId: string | null;
}
```

`packages/client/src/render/shadow.ts:11` — pure, no state at all.

```ts
export function shadowGraphic(widthRatio: number): Graphics
```

**The read-set is much narrower than the type.** Across `mapLayer`, `terrainDecor` and `trailLayer`, the only fields ever read are:

| Field | Read by |
|---|---|
| `tick` | `mapLayer` → `seasonOfTick(state.tick)` |
| `width`, `height` | all three, for row-major indexing |
| `tiles` | all three |
| `stockpile.pos` | `mapLayer:145-166` (basket + log + shadow, unconditionally) |
| `buildings` | `trailLayer.isVisibleGround` — a built tile hides wear |
| `trailCells` | `trailLayer`, indexed `y * width + x` |

Never read by any of the five layers: `agents` (passed separately), `deaths`, `collectives`, `institutions`, `spatialDemands`, `history`, `stockpile.wood`, `stockpile.food`. They are required by the `WorldState` type and ignored.

**Evidence that synthesis works, stronger than the argument:** the existing test already does it. `packages/client/test/mapLayer.test.ts:16` builds a `WorldState` object literal by hand — `tiles` from `Array.from`, `agents: []`, `trailCells` from a fixture helper, `history` from a fixture — and drives `renderMapLayer` with it. `structureLayer.test.ts`, `trailLayer.test.ts` and `terrainDecor.test.ts` do the same. A hand-built literal is already a first-class input to these renderers.

**Answer to Q4: no, they are not too tightly coupled.** They are pure `(Container, data) => void` functions over a plain record.

### 1.2 `worldGen.ts` cannot produce that shape (Q2)

`packages/server/src/sim/worldGen.ts:138`

```ts
export function generateWorld(seed: number): WorldState
```

One parameter. Five independent blockers:

1. **Unreachable from the client.** `packages/client/package.json` depends only on `@agent-town/shared`, `pixi.js`, `vite`.
2. **No dimensions parameter.** It reads `MAP_WIDTH`/`MAP_HEIGHT` from constants directly (`worldGen.ts:81-95`).
3. **No placement parameter.** The stockpile is hardcoded to the map centre (`:141-144`) and residents spawn adjacent to it (`:97-103`).
4. **Fixed population of three.** `createAgents` maps over `AGENT_NAMES`, which is `["トネリコ", "シラカバ", "スギ"]` (`constants.ts:49`). A city of any size gets three residents with the same three names.
5. **It regenerates the whole world.** `:161` calls `generateWorldHistory(seed, {...})`, which runs 200 years of history *and* `generateWorldMap`. Calling it per city would rebuild the world once per city view.

What it derives that nation state does not carry: tile-level terrain patches, per-tile renewable resource kind and amount, a settlement centre, and resident individuals. What it has no concept of: `polityId`, `developmentLevel`, city population, `WorldMapTerrain`'s five-value palette, or any directive.

To make it usable it would need `(seed, width, height, centre, residentCount, skipHistory)` and a home in `shared` — six parameters and a package move on a module the spec freezes. **Recommendation: do not reuse it.** Write a new generator that borrows its technique (patch-based terrain over `createRng`), roughly 120 lines.

### 1.3 Deterministic synthesis from nation state (Q3)

**Available inputs**, all already on the client after `welcome`:

- `WorldCity` (`worldMap.ts:10`): `id`, `name`, `pos`, `polityId`, `isCapital`, `foundedByEventId`.
- `NationCityState` (`nation.ts:51`): `cityId`, `population`, `developmentLevel`.
- `NationState` (`nation.ts:95`): `stocks`, `territoryCellCount`, `population`, `stability`, `culture`, `foodProduction`, `materialProduction`, `activeDirectives`, `prosperity`, `lastReport`.
- `WorldMap.cells` in the neighbourhood of `city.pos` — the local biome, from the 5-value `WorldMapTerrain`.
- `WorldMap.tradeRoutes` touching the city — a road bearing.
- `Polity` (`history.ts:20`): `color`, `values`, `adjective`, `taboo`.

**Seed.** `NationWorldState` carries no seed field, and the plan freezes that contract. It does not need one: `city.pos` already varies with the world seed (`placeCapitals` → `orderedCapitalCandidates` → `shuffled(rng, …)`, `worldMapGen.ts:299-372`). The identifiers do **not** vary — `polity-${index + 1}` (`historyGen.ts:191`) and `city-${polity.id}-${slot + 1}` (`worldMapGen.ts:1201`) are identical across every seed. So salt from **`cityId` plus `pos`**, never `cityId` alone. This assumes city positions are stable at run time, which holds while N1 keeps `changedCells` empty; N3 territory change would need the salt pinned at bootstrap.

**Precisely what is missing and must be invented:**

| # | Missing | Proposed invention |
|---|---|---|
| 1 | Local grid extent. Nothing says how many tiles a city covers. | Fixed `MAP_WIDTH × MAP_HEIGHT` (64×48). Keeps `TILE_SIZE`, viewport fit and every layer's index math on their tested path. Vary *content density* with `developmentLevel`, not extent. |
| 2 | Terrain mapping. `WorldMapTerrain` has 5 values, `Terrain` has 4, and they are not a subset: `sea→water`, `plains→plains`, `forest→forest`, `hills→rock`, `mountains→rock`. | Sample the city cell plus its 8 neighbours into a terrain mix, then lay patches with that mix. Hills and mountains both collapse to `rock`; a hills city and a mountains city will read the same. |
| 3 | Building positions. Counts follow from `population` and `developmentLevel`; coordinates do not exist. | Deterministic ring layout around the centre, ordered by the seeded RNG. |
| 4 | The stockpile. `renderMapLayer:145-166` draws basket, log and shadow from `state.stockpile.pos` **unconditionally** — there is no opt-out without editing frozen code. | Place it at the city centre and re-narrate it as the city store. It is not optional. |
| 5 | Resident individuals. `AgentState` has 17 fields; nation state has one aggregate `population`. Only three names exist in `AGENT_NAMES`. | Cut from the first slices (§3, L3). This is the weakest part of the synthesis and the least necessary. |
| 6 | Field crop stage. | Derivable: `nationSeasonOfTick(tick)` plus whether `clearFarmland` is active or complete. |
| 7 | Trails. `TrailCell` has 8 fields including two nested `Record`s (`purposeWear`, `facilityWear`). | Synthesize from the trade-route bearing and the building layout. **Constraint:** `wornLevel → isVisibleGround` (`trailLayer.ts:43-54`) draws wear only on `plains`/`forest` with no building on the tile — roads laid anywhere else vanish silently. |

**The season trap.** `renderMapLayer:131` calls `seasonOfTick(state.tick)`, the *resident* helper: `TICKS_PER_DAY = 2400`, `DAYS_PER_SEASON = 2` — 4800 ticks per season. Nation scale is `NATION_TICKS_PER_SEASON = 300`. Passing the nation tick straight through leaves the ground in spring for the first sixteen nation seasons. Back-compute the display tick instead:

```ts
SEASONS.indexOf(nationSeasonOfTick(tick)) * DAYS_PER_SEASON * TICKS_PER_DAY
```

That is the idiom `seasonalWorld()` already uses at `mapLayer.test.ts:46-49`, uses only `shared` constants, and touches nothing frozen.

**Verdict on Q3: yes, deterministically synthesizable**, with items 1–5 invented and items 2 and 5 as honest quality losses.

### 1.4 Where the scales live today (Q5 evidence)

The world map is Canvas 2D, not Pixi:

```ts
// packages/client/src/ui/worldMapView.ts:273
export function renderWorldMapCanvas(canvas: HTMLCanvasElement, view: WorldMapViewModel): void
```

`WORLD_MAP_CELL_SIZE_PX = 6`, drawn into a `<canvas>` created inside `mapPanel()` (`worldChronicle.ts:370-401`), inside the `#world-chronicle` modal, behind a tab. The Pixi `Application` in `main.ts:96` renders the 64×48 resident settlement, with one viewport:

```ts
// packages/client/src/render/worldViewport.ts:112
export function createWorldViewport(
  stage: Container,
  world: Container,
  initialWorldWidth: number,
  initialWorldHeight: number,
  initialViewportWidth: number,
  initialViewportHeight: number,
): WorldViewport
```

and it binds unconditionally to the stage (`worldViewport.ts:252-258`):

```ts
stage.eventMode = "static";
stage.on("pointerdown", handlePointerDown);
stage.on("globalpointermove", handlePointerMove);
stage.on("pointerup", (event) => endPointer(event, true));
```

Two `createWorldViewport` calls on one stage therefore both pan on every drag. Sharing one camera across two scales requires either a `setContent`/`enabled` addition to this live, tested module, or a second Pixi `Application` with its own stage and its own WebGL context.

### 1.5 Milestone state and ownership (affects every slice below)

As of `bfebc09`, N1 Tasks 1 and 2 are committed (`52fe0a3` contracts, `7511c13` bootstrap). Tasks 3–7 are not. `packages/shared/src/protocol.ts` is still the resident-scale `welcome`/`update` pair; `packages/server/src/net/wsServer.ts:156` still calls `generateWorld(opts.seed)`; `main.ts` still mounts the whole resident stack. **Every slice here that touches `main.ts` is a delta on Task 6's output, not on today's `main.ts`.**

`bfebc09` also splits ownership by package at `protocol.ts`: the simulation worker owns `packages/shared/` and `packages/server/`, the client worker owns `packages/client/`. This is a hard constraint on the design, and it happens to be satisfied for free — **§3 touches only `packages/client/`, and requires no protocol change and no edit to any simulation-owned file.**

The same commit adopts the local map in spec §7.4 as a deterministic, read-only view derived from nation state, city and seed, and names one pre-implementation check: whether the frozen renderers can consume state synthesized from a nation. §0 and §1.1 of this document are that check. **The answer is yes.**

---

## 2. Recommendation

### 2.1 Synthesize on the client, in one module (Q6)

Derive the local scene in the client from `NationState` + `WorldCity` + `Polity` + `WorldMap`, salted by `cityId` and `city.pos`. **No protocol change.**

Reasoning, and where the lead's framing needs correcting: the stated cost of client-side derivation is "duplicating a generator across the wire boundary, and the two copies can drift." **There is no second copy.** No server-side city-scene generator exists, and `worldGen` is not one (§1.2). The drift risk is hypothetical about N7, not a present cost.

The server-side alternative is worse on three counts. It puts a non-authoritative derivation inside `sim/`, which the spec defines as authoritative and pure. It makes opening a city view a network round-trip while the clock runs. And the payload is structurally heavy, not marginally so: 3072 tiles, plus 3072 `TrailCell`s of 8 fields each including two nested `Record`s, plus `Facility` records of 17 fields including an 8-field `statsToday` and a `siteRationale`. (I have not measured the encoded size and will not guess at it; the structure is the argument.)

**Where the module goes was a real choice; `bfebc09` decides it.**

- `packages/client/src/local/cityScene.ts` — client-owned, zero friction. If N7 makes the resident sim live, this file is deleted, not synchronized.
- `packages/shared/src/citySceneGen.ts` — one copy forever, importable by both sides, and N7 would call the same function server-side. But `shared/` is **simulation-owned** as of `bfebc09`, so this is not the client worker's to create. It would also need a seeded RNG in `shared`, which has none: `createRng` lives at `packages/server/src/sim/rng.ts` (10 lines) and is imported by `historyGen`, `worldMapGen`, `worldGen` and `wsServer` — moving it edits four simulation-owned import lines, one of them in frozen `worldGen.ts`.

**`packages/client/src/local/` it is,** and the ownership boundary makes that the only option a client worker can take unilaterally. It is also the right place on the merits: the client is where a non-authoritative view belongs, and spec §7.4 is explicit that the local map derives rather than simulates. Revisit at N7, when the question is real, the contracts are unfrozen, and the swap is a supervisor-level decision anyway.

The narrow boundary the lead asked for is a single function signature:

```ts
// packages/client/src/local/cityScene.ts
export interface CitySceneInput {
  city: WorldCity;
  cityState: NationCityState;
  nation: NationState;
  polity: Polity;
  worldMap: WorldMap;
  tick: number;
}

export function synthesizeCityScene(input: CitySceneInput): WorldState;
```

Every renderer keeps taking `WorldState`. The whole synthesis — and the whole fiction — lives in one file. At N7 that file's body is replaced by "read the authoritative `WorldState` off the wire" and no caller changes. Nothing frozen is edited, in this slice or at N7.

### 2.2 Two surfaces, one camera; a cut, not a zoom (Q5)

Keep the world map on Canvas 2D and Pixi exclusively for the local city view. Two rendering surfaces, but only **one** camera and one WebGL context: the world map is a fixed 576×384 canvas with no pan or zoom, and the single `createWorldViewport` belongs to the city view (see the corresponding risk entry in §4 — after Task 6 the existing `Application` is empty, so the city view can be its sole consumer). The scale switch is "open city view for city X" / "close it" — a **cut**.

**The layout is a docked pane, not an overlay.** This is the load-bearing detail, so it is worth stating in pixels. The world map is 96×64 cells at `WORLD_MAP_CELL_SIZE_PX = 6` — **576×384 px natively**. The local map is 64×48 at `TILE_SIZE = 16` — **1024×768 px**. The small surface is the strategic one. So: the city view is the large primary surface, and the world map plus the nation HUD sit beside it as a permanently mounted column at or near native size. Neither ever covers the other, and closing the city view widens the world map rather than revealing it. An overlay would contradict the coexistence argument below, and a modal one would reintroduce exactly the mode this design rejects.

The rest is derived from the constraints, not preferred on taste:

- The lead's own constraint decides it. The local map must be "a view, never a mode that takes over the scene and stops the clock." A continuous zoom, by construction, leaves exactly one thing on screen mid-transition. A panel coexists with the ranking table and the season countdown; the world map stays visible and stays live behind it.
- Continuous zoom requires both scales in one scene graph. That means porting `renderWorldMapCanvas` into Pixi (a fork of a live tested module, which Task 6 forbids) *and* changing `createWorldViewport` so one camera can retarget (§1.4).
- The clock argues against animation. A 1–2 s zoom is dead time in which neither scale is readable while seasons keep resolving.

What this forfeits: the spatial continuity Songs of Syx gets from zoom. The upgrade path stays open — `createWorldViewport` is already scale-agnostic, taking a `Container` plus world pixel dimensions — so a later port of the world map into Pixi plus a `setContent` on the viewport would give continuous zoom without redoing the synthesis.

**One consequence for Task 6 worth naming:** making the world map always-on means lifting `renderWorldMapCanvas` out of `mapPanel()` in `worldChronicle.ts:370` into a persistent host element. That is not forking `worldMapView.ts` — its exports are untouched — but it does restructure the chronicle, which currently owns the canvas, its click handler and its `mapView` closure.

---

## 3. Implementation slices

### L0 — Synthesis core and a standalone browser harness

Independent of the protocol and of Task 6. Demonstrable in a browser today.

New files:

- `packages/client/src/local/sceneRng.ts` — `createSceneRng(seed: number): () => number` and `citySceneSeed(cityId: string, pos: Position): number` (FNV-1a over `` `${cityId}:${pos.x},${pos.y}` ``, matching the existing `Math.imul` hash idiom in `sprites.ts:305`).
- `packages/client/src/local/cityScene.ts` — `synthesizeCityScene` per §2.1. Terrain mix from the world-map neighbourhood; patch layout; centre stockpile; houses from `population`/`developmentLevel`; `tick` back-computed per §1.3.
- `packages/client/dev-city.html` + `packages/client/src/devCityScene.ts` — a Vite page that mounts a Pixi `Application`, feeds a fixture `NationState`/`WorldCity`/`Polity`/`WorldMap`, and calls `renderMapLayer`, `renderTrailLayer`, `renderStructureLayer` unchanged. Served by `vite` in dev; `vite.config.ts` has no `build.rollupOptions.input`, so it is a dev-only page unless one is added.

  **Two lines that are easy to omit and will produce a blank canvas.** `main.ts:92-93` runs, at module top level and before the `Application` exists:

  ```ts
  TextureStyle.defaultOptions.scaleMode = "nearest";
  await Assets.load([...SPRITE_PATHS]);
  ```

  Every `Sprite.from(path)` inside `mapLayer`/`structureLayer`/`agentLayer` depends on the second; the first is what keeps 16 px tiles from being blurred. A separate Vite entry point inherits neither. Expect the first run to look like a synthesis bug when it is a missing preload — check for textures before debugging the terrain mix.
- `packages/client/test/cityScene.test.ts` — same input twice is deeply identical; different `pos` differs; a `mountains` neighbourhood yields more `rock` than a `plains` one; higher `population` yields at least as many houses; every synthesized trail tile satisfies `isVisibleGround`; the display tick maps to the same season as `nationSeasonOfTick`.

Gate: `just check && just test`, plus the dev page rendering one recognizable town.

### L1 — Mount in the nation client (after Task 6)

Task 6 is the client worker's own task per the `bfebc09` table, so L1 is a follow-on by the same owner in the same package — sequence it immediately after Task 6 rather than negotiating a boundary.

- `packages/client/src/local/cityViewPanel.ts` — `createCityViewPanel(host: HTMLElement)` owning its `createWorldViewport` and `open(input)` / `close()` / `update(input)`. Calls `viewport.fit(MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE)` on open and on resize.

  **Copy the container topology; do not invent one.** `renderMapLayer`, `renderStructureLayer` and `renderAgentLayer` all write into the *same* `objectLayer` and each clears only its own `label`s (`MAP_OBJECT_LABEL`, `HOUSE_OBJECT_LABEL`, …). Correct depth therefore depends on state that lives outside the render functions — `main.ts:156-160`:

  ```ts
  world.sortableChildren = true;
  objectLayer.sortableChildren = true;
  groundLayer.zIndex = 0;
  trailLayer.zIndex = 1;
  objectLayer.zIndex = 2;
  ```

  A panel that mounts everything into one container renders output that looks correct and silently loses front-to-back ordering. `main.ts:146-167` is the template: five containers, `trailLayer.eventMode = "none"`, `world.addChild(groundLayer, trailLayer, objectLayer, …)`.
- `packages/client/index.html` — a `#city-view` host, sized as the primary surface per §2.2, with the world map and HUD as the adjacent column.
- `packages/client/src/main.ts` (Task 6 version) — open the panel for the player's capital by default; never block the clock or the ranking.

  **Gate the redraw; do not re-synthesize wholesale each season.** `renderMapLayer:125` does `groundLayer.removeChildren()` with `destroy` and then creates one `Sprite` per tile — 3072 sprites. Rebuilding that on every `season` message is a full teardown every 3.75 s at ×8. `main.ts:593-594` already has the right pattern, and it applies unchanged here:

  ```ts
  mapDirty =
    mapDirty || next.tiles !== state.tiles || seasonOfTick(next.tick) !== seasonOfTick(state.tick);
  ```

  So: structures and fields may update every season; ground only when the season *name* changes, which is the only thing that alters ground appearance. Put the trail redraw on the same gate — `isVisibleGround` (`trailLayer.ts:43`) scans `world.buildings` per cell per neighbour, so its cost grows with house count, which is exactly what `growCity` increases.
- `packages/client/src/ui/worldChronicle.ts` — lift the canvas into the persistent host per §2.2.

  **The identity cue comes from the world-map view model, not from here.** A synthesized `WorldState` carries no polity and no colour, so the city view has no nation identity of its own. It needs two things from the world-map side: the open city marked as open on the world map (the continuity cue, since both surfaces are visible at once and no transition carries it), and the nation's banner colour for the panel chrome. `design-visual` is deriving a 12-slot banner palette as a pure function of the generated polity set, stable for the session, exposed on the view model rather than inside the paint function — depend on that, not on `Polity.color`, whose archival values collide (a pair below ΔE76 15 in 36% of 4-nation worlds).

Gate: opening and closing the city view while seasons keep resolving; the ranking table and season countdown stay live and legible throughout.

### L2 — Make directives visible

The point of the feature: the local view shows what your orders did.

- `clearFarmland` → `Field` buildings with `stage` from the nation season.
- `encourageStores` → a `communalGranary` `Facility`.
- `growCity` and `developmentLevel` → house count and street layout.
- Trade routes → a road leaving the city on the correct bearing.

Gate: issuing `clearFarmland` in the browser produces visible fields in the capital by the next season report.

### L3 — Ambient residents (cuttable)

Synthesize `population / K` `AgentState` records and drive them with `interpolateAgentLayer`. **Deliberately last.** It requires inventing 17 fields per resident and names beyond the three in `AGENT_NAMES`, it is the piece most likely to be cut, and L0–L2 ship without it. If it is built, the wander must be presentation-only and seeded, and nothing may feed back into state.

---

## 4. Risks and open questions

**Half the directives cannot be depicted.** Only `growCity`, `clearFarmland` and `encourageStores` have sprite representations. `developTimber`, `openMine` and `holdFestival` have none — the asset packs have no mine, no lumber camp, no festival. "The map shows what your directives did" is the feature's pitch, and it is true for three of six. Either accept it, or add three building sprites from the vendored packs and a mapping (no new asset *files*: `packages/client/public/assets` already holds 396 PNGs across tiny-town, tiny-farm and tiny-dungeon; `sprites.ts:134` references them by path — it does **not** generate graphics procedurally, contrary to the brief's premise).

**The docked layout changes the world map's brief.** `WORLD_MAP_CELL_SIZE_PX = 6` was chosen for a map that appears in a modal on demand. §2.2 makes it permanently visible in a column beside a 1024×768 city view, where it is now the primary strategic read rather than an occasional reference. Whether 6 px cells carry territory, city tier and change legibly under that duty is `design-visual`'s call, not this document's, but the layout decision here is what raises it.

**Hills and mountains are indistinguishable.** Both collapse to `Terrain: "rock"`. A mining nation's capital in the mountains looks like a hill town.

**Ambient residents are the boundary case.** Deterministic wander is presentation, not game logic, but it is the one place where a "derived view" starts to resemble client-side simulation. Keeping it in L3 keeps the question deferrable.

**Not two Pixi contexts — one, and the same owner decides it.** An earlier draft of this document listed a second `Application` (a second WebGL context, untested on the low end) against a retargetable viewport (which edits a live tested module). Neither is necessary. Task 6 says resident and local-terrain layers "are no longer mounted from `main.ts` but remain in the tree" (plan line 328), and nothing else in Task 6 uses Pixi — the world map is Canvas 2D and the dashboard, ranking, directive and report panels are DOM. So after Task 6 the existing `Application` has **no content**, and the city view would be its only consumer. `createWorldViewport(app.stage, world, …)` then works unchanged, its unconditional `stage.on(…)` bindings have nothing to fight (§1.4), and `viewport.fit()` handles the re-fit on open.

The one action item: **Task 6 must keep the `Application` alive rather than deleting it**, even though it briefly renders nothing. Since Task 6 and L1 have the same owner (`bfebc09` table), this is a note-to-self, not a cross-owner negotiation. If Task 6 has already removed it by the time L1 starts, re-creating one `Application` for the city view is still one context, not two.

**Open: does the nation bootstrap produce landmarks at all?** `generateWorldHistory(seed, map?)` takes the resident surface *optionally* (`historyGen.ts:604`), and landmark positions are computed in the 64×48 resident frame relative to the stockpile (`:536-543`). If Task 2 generates history without that surface, `history.landmarks` is empty and `renderHistoryLayer` has nothing to draw at either scale. Worth confirming with whoever lands Task 2 before assuming landmarks are available as local-map decoration.

**Open: how large is a city, in fiction?** `NationCityState.population` has no documented unit. If a capital holds thousands, a 64×48 grid of 16 px tiles cannot depict it literally and the view is explicitly a representative quarter, not the city. That framing should be decided before L2, because it determines whether house count scales with population or saturates.

**Open: does the player ever need a rival's city view?** Currently out of scope. Nothing in the synthesis prevents it — it needs only public `NationState` — so the scope limit is a UI decision, not a technical one.
