# V3 "Settlement You Can Read" Implementation Plan

> Same regime as S5: TDD where testable, all prior global constraints apply, `just check`
> and `just test` green before every commit, one Conventional Commit per task.

**Design:** `docs/superpowers/specs/2026-07-27-v3-readable-settlement-design.md`

**Goal:** the map shows what the simulation already knows. No new simulation state, no new
protocol fields, no new dependencies, no downloaded assets. Every tile index stays declared
in `sprites.ts` with a comment naming what it depicts.

**Depends on:** Task 9 of the S5 plan (`feat(client): explain facilities and trail causes`).
Task 3 below rewrites `renderTrailLayer`, which S5 Task 9 gives a traffic-overlay parameter.
Read the file as it stands before changing it and keep that behaviour.

## Global constraints

- The client owns no game logic. Season comes from `seasonOfTick(world.tick)`, already a pure
  function in `@agent-town/shared`. Wear comes from `TrailCell`. Nothing new is derived that
  the server does not already publish.
- Cognitive complexity ≤ 10 per function (Biome). Prefer a new pure module over a longer one.
- Every new sprite path must be added to `SPRITE_PATHS` so `Assets.load` preloads it, or the
  first frame that needs it renders empty.
- Re-render only through the existing dirty flags in `main.ts`. Do not add a per-frame redraw.
- No absolute local paths in committed content.

---

## Task 1: Terrain that shows what it costs to cross

**Commit:** `feat(client): distinguish terrain by what it costs to cross`

**Files:**

- Modify: `packages/client/src/render/sprites.ts`, `packages/client/src/render/mapLayer.ts`,
  `packages/client/src/render/colors.ts`
- Create: `packages/client/src/render/terrainDecor.ts`
- Modify: `packages/client/test/sprites.test.ts`
- Create: `packages/client/test/terrainDecor.test.ts`

**Contract:**

```ts
/** Multiply applied to a terrain tile, so one grass sprite can serve plains and forest. */
export function terrainTint(terrain: Terrain): number;

/** Undergrowth for a forest tile whose wood is gone, so the clearing still reads as forest. */
export function undergrowthSpritePath(tile: Tile, tileIndex: number): string | null;
```

- `terrainTint("plains")` is `0xffffff`; `terrainTint("forest")` is cooler and darker than
  plains; `terrainTint("rock")` shifts the dirt tile toward slate. Assert the ordering
  (forest green channel below plains, rock blue channel above its red channel), not the
  literal constants, so a later palette tweak does not break the test.
- `undergrowthSpritePath` returns `null` for every non-forest tile and for a forest tile that
  still has wood; it returns a stable path for a depleted forest tile, and the same index
  always yields the same path.
- `terrainDecor.ts` exports `drawWater(graphics, world)` and `drawRockCluster(graphics, world)`.
  Water fills each water tile with a deep tone, bands the inside of every edge that touches
  land with a shallow tone, and adds a foam dash on a deterministic subset. Rock draws a
  boulder on a deterministic subset of rock tiles.
- Both decorators take `WorldState` and derive positions row-major. Neither reads `Date.now()`
  or `Math.random()`; two calls on the same world produce the same instruction list.

**Steps:**

1. Write the failing `sprites.test.ts` cases for `terrainTint` and `undergrowthSpritePath`.
2. Write `terrainDecor.test.ts`: a 3x3 world with one water tile surrounded by land produces
   four shallow bands; a fully enclosed water tile produces none; the same world drawn twice
   produces identical instruction counts.
3. Implement, then wire `mapLayer.ts` to set `sprite.tint = terrainTint(tile.terrain)` and to
   add undergrowth sprites through the existing `addMapObject` path.
4. Register the new tiles in `SPRITE_ASSETS` and `SPRITE_PATHS` with a comment each.

**Verify:** `pnpm vitest run packages/client/test/sprites.test.ts packages/client/test/terrainDecor.test.ts`,
then `just check`.

---

## Task 2: Buildings built from roofs and walls

**Commit:** `feat(client): raise houses and facilities into buildings`

**Files:**

- Modify: `packages/client/src/render/structureLayer.ts`,
  `packages/client/src/render/sprites.ts`
- Modify: `packages/client/test/structureLayer.test.ts`

**Contract:**

Tiny Town buildings are drawn as a roof tile above a wall tile. `tile_0067` is a gable, not a
house, which is why a finished house currently reads as a floating roof. A building keeps its
single logical tile and grows upward by one tile in the render only.

```ts
export interface BuildingSprites {
  /** Tile drawn one row above the building's own tile. */
  roof: string;
  /** Tile drawn on the building's own tile. */
  wall: string;
  /** Optional emblem that names the institution at a glance. */
  emblem: string | null;
}

export function buildingSprites(building: Building): BuildingSprites;
```

| Building | Roof | Wall | Emblem |
| --- | --- | --- | --- |
| `House` | tile_0067 red gable | tile_0086 door | — |
| `communalGranary` | tile_0063 slate gable | tile_0074 wide doorway | tile_0116 pitchfork |
| `grainMarket` | tile_0055 red roof with a dormer | tile_0075 wall | tile_0093 grain |
| `rationDepot` | tile_0051 slate roof with a dormer | tile_0078 slate doorway | tile_0083 notice board |

- Each of the four buildings yields a distinct `(roof, wall)` pair. Assert distinctness in the
  test rather than restating the table, so the assertion survives an art change.
- An incomplete building keeps `CONSTRUCTION_ALPHA` on every part, including the emblem.
- The roof sprite takes `objectDepth(building.pos.y, kind)` — the same depth as the wall, not
  the row above — so a building never sorts behind the row it visually overlaps.
- That rule has a consequence worth stating, because it looks like a bug until you know it is
  not. A roof is drawn one row up but sorts on its own row, so it covers whatever stands in
  the row above it: a tree, a resident walking behind, or the doorway of a second building
  placed directly north. That is the correct near-occludes-far reading for a top-down view,
  and two vertically adjacent houses should show the front one's full face and only the back
  one's roof. Do not resolve it by moving the roof to the row above; that would make a
  building sort behind the tile it overlaps, which is the worse of the two artefacts.
- `clearStructures` must remove roof and emblem children too. Give them the existing labels.

**Steps:**

1. Extend `structureLayer.test.ts`: four buildings produce distinct sprite pairs; an
   incomplete facility renders every child at `CONSTRUCTION_ALPHA`; re-rendering twice leaves
   the same child count (no leak from the roof row); two buildings one tile apart vertically
   give the southern one's roof the greater depth, so the occlusion above is pinned.
2. Implement `buildingSprites` in `sprites.ts`, register the tiles, then replace the hand-drawn
   `Graphics` facilities in `structureLayer.ts`.
3. Delete `FACILITY_VISUALS`, `facilityVisual`, and the `drawGranary` / `drawMarket` /
   `drawDepot` helpers together with their now-dead colour constants, and remove the
   corresponding assertions only if a replacement assertion covers the same distinction.

**Verify:** `pnpm vitest run packages/client/test/structureLayer.test.ts`, then `just check`.

---

## Task 3: Trails that read as paths

**Commit:** `feat(client): draw trails as connected paths`

**Files:**

- Modify: `packages/client/src/render/trailLayer.ts`
- Modify: `packages/client/test/trailLayer.test.ts`

**Contract:**

The current layer draws a vertical bar per tile and bridges only to the right, so a vertical
run is a column of beads and a crossing does not join. Replace the per-tile bar with a band
plus a bridge to every walked neighbour.

- For each worn, visible tile: one rounded band centred on the tile, corner radius small
  enough that a straight run has straight sides.
- For each of the four neighbours that is also worn and visible: one rectangle from this
  tile's centre to the shared edge, width `min(width(self), width(neighbour))`.
- Width and colour still come from the wear level. `establishedTrail` is the widest and
  darkest; `trace` is the narrowest and faintest.
- Preserve the traffic-overlay parameter added in S5 Task 9 exactly as it behaves today,
  including its default.
- `isVisibleGround` and `wornLevel` keep their current meaning: water, rock, and a built-over
  tile show no wear.

**Steps:**

1. Extend `trailLayer.test.ts`: a vertical run of three worn tiles produces a bridge on the
   north and south sides of the middle tile; a crossing produces four bridges; a lone worn
   tile produces a band and no bridge; a worn tile beside an unwalkable tile produces no
   bridge toward it. Keep every existing case, including the overlay one, unchanged.
2. Implement.

**Verify:** `pnpm vitest run packages/client/test/trailLayer.test.ts`, then `just check`.

---

## Task 4: A resident keeps their face and shows their load

**Commit:** `feat(client): keep resident faces stable and name what they carry`

**Files:**

- Modify: `packages/client/src/render/sprites.ts`,
  `packages/client/src/render/agentLayer.ts`
- Modify: `packages/client/test/sprites.test.ts`

**Contract:**

`agentSpritePath(index)` currently takes the position in `world.agents`. When a resident
starves and leaves the array, every resident after them changes appearance. Select from
`agent.id` instead.

```ts
/** Stable per resident, so a death cannot reshuffle the faces of the living. */
export function agentSpritePath(agentId: string): string;
```

- Use these eight tiny-dungeon faces, and only these: 0084, 0085, 0086, 0088, 0098, 0099,
  0100, 0112. The other humanoid tiles are armoured or monstrous — 0087 is a horned helm,
  0096 and 0097 are visored knights, 0109 is a cyclops — and knights among farmers read as a
  different game. `tile_0111` is not a person either.
- `MAX_POPULATION` is 10, so a full settlement repeats two faces. That is fine and must not be
  worked around by padding the roster with the armoured tiles. The property that matters is
  stability, not uniqueness.
- The test must show the property, not the hash: removing the first agent from a three-agent
  list leaves the other two with the paths they had. Assert distinctness only for a set of
  ids small enough that the pigeonhole does not force a collision.
- The carry indicator becomes a small sprite at the resident's side: `tile_0106` for wood,
  `tile_0093` for food. The yellow square goes away.

**Steps:**

1. Extend `sprites.test.ts` with three properties: the same id always yields the same path;
   removing an agent from the middle of a list leaves every other resident's path unchanged;
   and over a few hundred generated ids every one of the eight faces is reached at least once,
   which catches a hash that collapses onto a subset. Do not assert that N distinct ids give N
   distinct paths — with eight faces that test is flaky by construction.
2. Change the signature, update `agentLayer.ts`'s call site, and replace the carry `Graphics`
   with the two sprites.

**Verify:** `pnpm vitest run packages/client/test/sprites.test.ts`, then `just check`.

---

## Task 5: The year turns on the map

**Commit:** `feat(client): turn the year on the map`

**Files:**

- Modify: `packages/client/src/render/sprites.ts`,
  `packages/client/src/render/mapLayer.ts`, `packages/client/src/main.ts`
- Modify: `packages/client/test/sprites.test.ts`

**Contract:**

A year is eight days, about thirty-two real minutes, so a season lasts about eight. Three
Tiny Town trees are drawn twice, green and autumn, on the same silhouette: 0016/0015,
0028/0027, 0004/0003. Swapping only the colour keeps the composition.

```ts
export function treeSpritePath(season: Season, tileIndex: number): string;
export function seasonGroundTint(season: Season): number;
```

- `treeSpritePath` returns a green tile for spring and summer, an autumn tile for autumn and
  winter, and the same silhouette family for the same `tileIndex` across every season. Assert
  that property: for one index, spring and autumn differ, and spring and summer match.
- `seasonGroundTint` is `0xffffff` for at most one season and distinct for the rest. Winter is
  the palest and least saturated. Assert the ordering, not the constants.
- `mapLayer.ts` multiplies `terrainTint` by the season tint. Where both apply, compose them
  in one place so a forest tile in winter is not tinted twice by accident.
- `main.ts` already keeps `mapDirty` alongside `trailsDirty`, `structuresDirty` and the rest.
  A season change sets `mapDirty` when `seasonOfTick(next.tick) !== seasonOfTick(state.tick)`;
  no new flag is needed, because a season change and a terrain change both mean the same
  thing — rebuild the ground. `MAP_WIDTH * MAP_HEIGHT` is 3072 sprites, rebuilt roughly once
  every eight minutes. Do not add any per-frame work beyond that one comparison.

**Steps:**

1. Extend `sprites.test.ts` with the silhouette-stability and tint-ordering properties.
2. Implement, register the six tree tiles in `SPRITE_ASSETS` and `SPRITE_PATHS`.
3. Set `mapDirty` on a season boundary in `main.ts`.

**Verify:** `pnpm vitest run packages/client/test/sprites.test.ts`,
`pnpm --filter @agent-town/client build`, then `just check`.

---

## Task 6: Contact shadows

**Commit:** `feat(client): ground objects with contact shadows`

**Files:**

- Create: `packages/client/src/render/shadow.ts`
- Modify: `packages/client/src/render/agentLayer.ts`,
  `packages/client/src/render/structureLayer.ts`,
  `packages/client/src/render/mapLayer.ts`
- Create: `packages/client/test/shadow.test.ts`

**Contract:**

```ts
/** A soft ellipse at an object's feet, so a sprite sits on the ground instead of over it. */
export function shadowGraphic(widthRatio: number): Graphics;
```

- One shared helper, three widths: resident, tree, building.
- The shadow is a child of the object's own container where one exists, so it inherits the
  object's depth and is destroyed with it. Where no container exists, it takes the object's
  depth minus a fraction smaller than one depth step.
- The shadow must not add a hit target. `eventMode = "none"`.

**Steps:**

1. Write `shadow.test.ts`: the graphic has one fill instruction, its alpha is below 0.3, and
   its `eventMode` is `"none"`.
2. Implement and attach at the three call sites.

**Verify:** `pnpm vitest run packages/client/test/shadow.test.ts`, then `just check`.

---

## Task 7: Residents walk instead of teleport

**Commit:** `feat(client): let residents walk between tiles`

**Files:**

- Modify: `packages/client/src/render/agentLayer.ts`, `packages/client/src/main.ts`
- Create: `packages/client/src/render/motion.ts`
- Create: `packages/client/test/motion.test.ts`

**Contract:**

The server broadcasts every tick, ten times a second, and a resident crosses a tile in three
ticks on open ground and fewer on a worn trail. `renderAgentLayer` destroys and rebuilds every
agent container on each of those updates, so a resident jumps a full sixteen pixels at a time
and nothing can carry motion across updates. There is no `app.ticker` callback at all; the
scene changes only when a message arrives.

```ts
/** Fraction of the remaining distance to close this frame, given how long the frame took. */
export function easeFactor(deltaMs: number, halfLifeMs: number): number;

/** Beyond this many tiles the move is not a walk, so the sprite snaps instead of sliding. */
export const SNAP_DISTANCE_TILES: number;
```

- `renderAgentLayer` keeps a `Map<string, Container>` keyed by `agent.id`, reuses the container
  for a resident who is still alive, and destroys only containers whose resident is gone.
- A ticker callback in `main.ts` eases each container toward its authoritative position. The
  authoritative position stays exactly what it is today: `agent.pos` plus the tile offset.
- A jump larger than `SNAP_DISTANCE_TILES` snaps, so an immigrant appearing at the settlement
  edge does not slide across the map.
- `easeFactor` is frame-rate independent: halving `deltaMs` twice must leave the same position
  after the same elapsed time, within a tolerance. Assert that, and assert it never exceeds 1.
- The ticker callback changes presentation only. It must not write to `WorldState`, and the
  depth (`agentDepth`) still comes from the authoritative tile row, not the eased position, so
  easing can never reorder two residents.

**Steps:**

1. Write `motion.test.ts` for `easeFactor`: monotonic in `deltaMs`, capped at 1, and the
   frame-rate independence property above.
2. Rework `renderAgentLayer` to reuse containers, then add the ticker callback in `main.ts`.
3. Confirm by inspection that no test asserted the old destroy-everything behaviour; if one
   did, replace it with an assertion about the surviving container's identity.

**Verify:** `pnpm vitest run packages/client/test/motion.test.ts packages/client/test/sprites.test.ts`,
then `just check`.

---

## Task 8: Full gates and visual confirmation

**Commit:** `chore(client): verify the readable settlement`

**Steps:**

1. `just check && just test`
2. `pnpm --filter @agent-town/client build`
3. `git diff --check`
4. `rg -n "tile_0" packages/client/src/render/sprites.ts` — every tile index has a comment
   naming what it depicts.
5. Confirm no sprite path reaches the renderer without being in `SPRITE_PATHS`.
6. Serve the build and describe, in the commit body, what the settlement actually looked
   like: whether a cleared forest still reads as forest, whether the rock ridge reads as
   impassable, whether a crossing of two trails joins, and which season was on screen.

**Expected:** all gates green, the client build passes, and the map answers the questions in
the design's acceptance criteria without opening a panel.
