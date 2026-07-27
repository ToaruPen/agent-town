# C1 — Nation Client Implementation Plan

**Goal:** Make the nation game playable and legible in a browser, at two scales. The world map becomes the permanent strategic surface where the player reads territory, cities and rank; a docked local map shows the player's own city so the results of their orders are visible as buildings and ground; and a HUD keeps the one question a 30-second decision interval always raises — what commits at the next boundary — answered at every speed including pause.

**Spec:** `docs/superpowers/specs/2026-07-27-nation-rulers-realtime-design.md` (§7 可視化と操作, §7.4 ローカルマップと往来).

**Design sources.** These are investigations, not proposals to re-derive. Read the relevant one before starting a task; its evidence is the reason each decision below is what it is.

| Document | Covers |
|---|---|
| `docs/superpowers/design/2026-07-27-traversal.md` | Whether the frozen renderers can consume synthesized state, the `synthesizeCityScene` boundary, why a cut rather than a zoom, the season-tick and asset-preload traps |
| `docs/superpowers/design/2026-07-27-hud.md` | The season as a deliberation window, the order desk, autopilot as a following mode, the season report as a diff with reasons, the file inventory |
| `docs/superpowers/design/2026-07-27-visual.md` | The measured nation-colour collision and the derived banner palette, territory borders, city tiers, keeping change calm |

**Ownership:** the client worker owns `packages/client/` and nothing else — see `docs/superpowers/handoff/2026-07-27-delegation.md`. `packages/shared/` and `packages/server/` belong to the simulation worker. A missing protocol field is a stop-and-report, never a local edit.

**Tech stack:** TypeScript 7, Vitest, Vite, Biome, pnpm, just. **Two renderers, and the distinction matters:** the world map is HTML Canvas 2D (`renderWorldMapCanvas`, 6 px cells); PixiJS renders the local city view. Do not port either into the other.

---

## Scope

C1 is complete when:

- the world map is permanently visible, shows every nation's territory with borders and city tiers, and the player finds their own nation instantly without the map becoming a highlight of one nation;
- no two nations in a generated world are hard to tell apart;
- the player's own nation dashboard, the ranking with its prosperity breakdown, the directive panel with blocked reasons, the season report as a diff with reasons, the speed control and the autopilot toggle all work;
- every order is acknowledged within a round-trip **at speed 0**, and a rejection is distinguishable from an acceptance;
- the player can open and close a local view of their own city while seasons keep resolving, and the ranking and countdown stay live throughout;
- `clearFarmland`, `growCity` and `encourageStores` are visible in that local view as things that were built;
- nothing in the client computes a prosperity score, judges a directive's legality, or writes to game state.

Explicitly out of scope:

- ambient synthesized residents in the city view — deliberately last and cuttable, see `traversal.md` L3;
- a local view of a rival's city — the synthesis would support it from public state, so this is a scope choice, not a limit;
- continuous zoom between the scales — the upgrade path stays open, see C1-7;
- server-side redaction of rival state — N3, when hidden information matters;
- new dependencies, new asset files, new fonts.

## Decided questions

These were open in the design documents. They are decided here so no task re-opens them.

**The world map stays Canvas 2D.** Pixi becomes the local city view's renderer and its only consumer. `AGENTS.md`'s one-line description of the client was written for the resident renderer and is being corrected alongside this plan.

**The transition is a cut, and the layout is a docked pane.** Not an overlay, not a modal, not a camera move. Both surfaces stay mounted; opening the city view resizes rather than covers. The local map is 1024×768 native against the world map's 576×384, so the city view is the large surface and the world map plus HUD form a permanent adjacent column. The reason is the constraint that the clock never stops: a zoom leaves one scale on screen mid-transition, and one to two seconds of animation is dead time while seasons resolve.

**Synthesis lives in `packages/client/src/local/cityScene.ts`.** One function, `synthesizeCityScene(input): WorldState`. The client cannot reach `packages/server/src/sim/worldGen.ts` — `packages/client/package.json` declares exactly `@agent-town/shared`, `pixi.js` and `vite` — and `shared/` is simulation-owned, so this is the only place a client worker can put it. It is also where a non-authoritative view belongs. At N7 the body of that one file becomes "read the authoritative `WorldState` off the wire" and no caller changes.

**The local view is a representative quarter of a city, not the whole city.** `NATION_POPULATION_PER_HISTORY_POINT = 100` over roughly 80–120 history points puts a nation at 8,000–12,000 people, so a capital holds thousands and a 64×48 grid of 16 px tiles cannot depict it literally. Building count therefore tracks `developmentLevel` and saturates against `population`; it never tries to be one house per family.

**`history.landmarks` is empty in N1.** `createLandmarks` returns `[]` when no resident surface is generated (`historyGen.ts:581`), and N1 generates none. Landmark positions are expressed in the resident frame anyway. The city view synthesizes its own decoration and must not depend on landmarks at either scale.

**Hills and mountains both collapse to `rock`.** `WorldMapTerrain` has five values, the resident `Terrain` has four, and they are not a subset. A mountain capital and a hill capital will look alike. Accepted; recorded so nobody treats it as a bug.

**Prosperity components are normalised 0..1 ratios.** N1's Task 4 pins this and asserts it. The client renders each component's contribution as `weight × component × 1000`, importing the weights from `@agent-town/shared`, and displays `prosperity.total` verbatim. It never sums contributions into a total of its own — a view-model test asserts that no code path does.

## Why the browser gates in this plan are not ceremony

C1-2 shipped a first commit that passed every test in its brief, and then found while reserving anchors that the two nearest house plots sat diagonally against the city store — directly on top of the props `renderMapLayer` draws at `stockpileX ± TILE_SIZE/4`. That was true of **every** synthesized city, so the dev page had never once shown a correct central square. Six tests about determinism, terrain mix, building counts and trail visibility all passed over it, because none of them asked what the thing looked like.

So when a task in this plan says a judgement belongs in a browser, that is a real gate and not a formality. State the question in the report the way C1-2 did — it could not tell from data whether a town with six deliberate gaps reads as room for growth or as holes in the town, and that is exactly the sort of thing to hand over rather than guess at.

## Known gaps

Both were found by the worker who built C1-1, by mutation-testing its own assertions rather than by review.

**The banner palette's ΔE 26 acceptance bar is not load-bearing at four nations.** Mutating `MIN_SEPARATION` to 0 leaves every C1-1 test green: the shipped 40.86 floor comes from chroma priority plus hue proximity, not from the bar. The bar only binds at six nations or more, which C1-1's test list did not cover, so a future rise in `WORLD_POLITY_COUNT` or a populated override table would ship unguarded. A follow-up adds an enumeration at the counts where the bar binds, and the test has to be shown load-bearing by re-mutating.

**The eight archival polity colours are duplicated into the client's test fixture, and drift would be silent.** `POLITY_TEMPLATES` is private to `packages/server/src/sim/historyGen.ts`, and the client cannot import from the server package, so the 1680-world separation guarantee is measured against a hand-copied colour list. Change a template's colour and the client's test keeps passing while guaranteeing nothing about the world the generator actually produces.

This one belongs to the **simulation worker**, not the client. The cheap fix is a server-side test asserting the template colour set is exactly a declared list, with a comment naming the client test that depends on it, so a template edit fails loudly and points at what else needs re-measuring. Moving the palette into `shared` would also work and is a bigger change than the risk justifies today.

## Frozen client boundaries

Do not rename these or change their shapes while executing this plan. If one looks wrong, stop and raise it with the supervisor.

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

```ts
// packages/client/src/render/nationBanner.ts
export interface NationBanner {
  nationId: NationId;
  color: number;
  slot: number;
}

export function assignNationBanners(polities: readonly Polity[]): NationBanner[];
```

Every renderer keeps taking the types it takes today. `synthesizeCityScene` returns a plain `WorldState` because `renderMapLayer`, `renderTrailLayer` and `renderStructureLayer` are pure `(Container, data) => void` functions over a plain record, and the existing tests already drive them with hand-built literals.

`assignNationBanners` is a pure function of the polity list. It must be stable under permutation of that list — a nation's colour cannot change because the ranking re-sorted — and it must not read `Polity.color`, whose archival values collide (measured: 36% of generated worlds contain a pair below ΔE 15).

## Determinism and purity rules

- `synthesizeCityScene` is deterministic: same input, deeply identical output. Its randomness comes from a seeded RNG salted by `cityId` **and** `city.pos`. Identifiers are seed-invariant (`polity-N`, `city-polity-N-M`); positions are not, so `cityId` alone would give every world the same towns.
- No `Date.now()` or `Math.random()` in synthesis or in any view model. Wall-clock belongs only to animation frames and to the countdown's own render loop.
- Nothing in `packages/client/` computes a score, judges a directive's legality, or derives state the server owns.
- Game constants stay in `packages/shared/src/constants.ts`, which the client worker may not edit — a client task that needs one is a stop-and-report. Presentation values (colours, pixel sizes, easing durations) are not game constants and live in the client.

**Two traps that fail silently.** Both are documented with line references in `traversal.md`; they are repeated here because each looks like a different bug than it is.

1. `renderMapLayer` calls `seasonOfTick(state.tick)`, the *resident* helper at 4800 ticks per season, while nation scale runs at 300. Passing a nation tick straight through leaves the ground in spring for sixteen nation seasons. Back-compute the display tick: `SEASONS.indexOf(nationSeasonOfTick(tick)) * DAYS_PER_SEASON * TICKS_PER_DAY`.
2. `main.ts` sets `TextureStyle.defaultOptions.scaleMode = "nearest"` and awaits `Assets.load([...SPRITE_PATHS])` at module top level. A separate Vite entry point inherits neither, and every `Sprite.from(path)` depends on the second. The result is a blank canvas that reads exactly like a broken terrain mix. Check for textures before debugging synthesis.

## Task List

C1-1 and C1-2 depend on no protocol and can run immediately, in parallel with the simulation worker's N1 tasks. C1-3 onwards need N1 Task 5's reshaped protocol on `main`.

One branch per task, commit locally, never push. The supervisor verifies independently and merges. Parallel work needs its own worktree under `.worktrees/`, and a fresh worktree needs `pnpm install` before the gates run.

| Order | Depends on | Assignment | Branch |
|---|---|---|---|
| C1-1 | nothing | Derived banner palette, wired to the existing city dots and ranking swatches | `c1-01-nation-banner` |
| C1-2 | nothing | `synthesizeCityScene` plus a standalone dev page that renders one town | `c1-02-city-scene` |
| C1-3 | N1 Task 5 | Nation HUD shell: dashboard, ranking with breakdown, speed control, clock and countdown | `c1-03-hud-shell` |
| C1-4 | C1-3 | The order desk: directive panel, queued and rejected feedback, autopilot as a following mode | `c1-04-order-desk` |
| C1-5 | C1-3 | Season report as a diff with reasons | `c1-05-season-report` |
| C1-6 | C1-1, C1-3 | World map as the permanent primary surface: territory borders, city tiers, player distinction | `c1-06-world-map` |
| C1-7 | C1-2, C1-6 | Mount the city view as a docked pane; open, close, and redraw gating | `c1-07-city-view` |
| C1-8 | C1-7 | Make directives visible in the city view | `c1-08-directive-scenery` |
| C1-9 | C1-6 | Change made visible and kept calm | `c1-09-change-visible` |

N1 is demonstrable in a browser once C1-1 through C1-5 have landed.

### C1-1 — Banner palette

Read `visual.md` §1.3 and §2.1. This slice is first because it fixes a defect that exists in the tree today, independent of everything else in this plan.

- `packages/client/src/render/nationBanner.ts` implements the frozen `assignNationBanners`, over the 12-slot ring in `visual.md` §2.1.
- `Polity.color` keeps its current jobs — the 国柄 card accent and landmark selection — and is not touched.
- Wire the banners only to the ranking swatches and the existing world-map city dots. Nothing else changes in this slice.
- Tests: assignment is deterministic for a given polity list; identical under permutation of that list; every 4-of-8 draw the generator can produce yields a minimum pairwise ΔE at or above the floor stated in the design; a chromatic polity's banner stays within the stated hue drift of its archival colour.

### C1-2 — City scene synthesis

Read `traversal.md` §1.3 and §3 (L0).

- `packages/client/src/local/sceneRng.ts` — a seeded RNG and `citySceneSeed(cityId, pos)`, following the existing `Math.imul` hash idiom in `sprites.ts`.
- `packages/client/src/local/cityScene.ts` — the frozen `synthesizeCityScene`. Terrain mix sampled from the city cell and its eight world-map neighbours; patch layout; the stockpile at the city centre, re-narrated as the city store, because `renderMapLayer` draws it unconditionally and there is no opt-out without editing frozen code; buildings from `developmentLevel` saturating against `population`; the display tick back-computed per the trap above.
- Synthesized trails must satisfy `isVisibleGround` — wear draws only on `plains` and `forest` with no building on the tile, so a road laid anywhere else vanishes with no error.
- A dev-only Vite page that mounts a Pixi `Application`, feeds fixture nation state, and calls `renderMapLayer`, `renderTrailLayer` and `renderStructureLayer` unchanged. It must set the scale mode and await the sprite preload itself.
- Tests: same input twice is deeply identical; a different `pos` differs; a `mountains` neighbourhood yields more `rock` than a `plains` one; higher `developmentLevel` yields at least as many buildings; every synthesized trail tile satisfies `isVisibleGround`; the display tick maps to the same season as `nationSeasonOfTick`.
- Gate: the dev page renders one recognizable town.

### C1-3 — HUD shell

Read `hud.md` §1 for the established idiom, §3.1 and §3.2 for the interaction model, §4.1 and §4.3 for the inventory.

**You start from a shell, not from today's `main.ts`.** N1 Task 5 reshapes the protocol, which breaks the client, and since every commit must stay green that migration lands with Task 5 under a scoped exception: it rewrites `wsClient.ts` and its test for the new messages and reduces `main.ts` to a shell that mounts nothing, keeps the Pixi `Application` with its `nearest` scale mode and sprite preload, and makes no UI decision. Everything the HUD is, you build on top of that. Read the shell before designing against your memory of the old `main.ts`.

- Follow the client's existing shape: a pure tested view model plus a thin DOM controller, with JSON-key dedupe to avoid redundant re-renders. Text-heavy panels are DOM; Pixi is not involved.
- Always on screen: the year and season readout, the countdown to the next boundary, the speed control including pause, the player's own dashboard, and the ranking with each nation's prosperity total and its five component contributions.
- The calendar year the player sees is `history.currentYear + nationYearOfTick(tick) - 1`, computed here at the display edge and nowhere else.
- The countdown needs a wall-clock render loop of its own because `clock` arrives at about 1 Hz; it must read as smooth without implying the client knows the tick between heartbeats.
- Keyboard: keep the conventions `keyboardNavigation.ts` already established.
- Reconnect must recover: `welcome` re-establishes everything, and the HUD must not assume it has seen every intervening `season`.
- Japanese labels, matching the existing UI.
- Tests: the ranking view model orders by prosperity and renders contributions from the weights without ever summing them into a displayed total; the year readout matches the formula at season and year boundaries; the speed control sends the right `setSpeed`; a `welcome` after a gap rebuilds state without stale panels.

### C1-4 — The order desk

Read `hud.md` §2.3, §3.2, §3.3 and §3.4. This is the game's only verb, so it is the slice most worth getting right.

- Consume the `orders` message. `options` is the candidate list, already carrying cost, duration, cultural fit and blocked reason; render blocked options with their reason and make them unsubmittable, never hide them.
- One slot always answers "what commits at the next boundary": the player's `queued` order if there is one, otherwise `chancellorChoice`. This is exact rather than predicted, because the chancellor is pure and nation state does not change mid-season.
- `rejected` non-null with `queued` unchanged is an unambiguous refusal, with the reason already resolved server-side. Show it as such. Do not fake acknowledgement optimistically — that is precisely what lies to the player at speed 0.
- Autopilot is a following mode, not a lesser one: with it on, the player still sees what the chancellor decided and why, and handing control back and forth is one action.
- Everything here must work with the clock at 0.
- Tests: a blocked option renders its reason and cannot be submitted; the commit slot prefers `queued` over `chancellorChoice`; a `rejected` message leaves the queued order untouched and surfaces the reason; toggling autopilot updates from the `orders` echo rather than optimistically.

### C1-5 — Season report

Read `hud.md` §4.5.

- The report is a diff with reasons, not a table of numbers: for each of the six `SeasonMetric` values, what changed, by how much, and which reasons contributed.
- `completedDirectiveIds` is what explains changes the ledger cannot carry — production capacity and city development are not `SeasonMetric` values, so a completed directive is their only explanation.
- Tests: entries group by metric and sum to the displayed delta per metric; a season with a famine entry reads as a famine rather than as an unexplained population drop; an empty report renders without a hole in the layout.

### C1-6 — World map as the primary surface

Read `visual.md` §2.2, §2.3, §2.6 and §2.7.

- Lift `renderWorldMapCanvas` out of `mapPanel()` in `worldChronicle.ts` into a persistent host element. This is a restructure of the chronicle, which currently owns the canvas, its click handler and its `mapView` closure — it is **not** a fork of `worldMapView.ts`, whose exports stay as they are.
- Territory: edges extracted in the view model, not in the paint function. Sea and off-map count as different owners. Interior edges are not emitted.
- City tiers: population radius, the capital as a distinct shape, a development core, a prosperity ring. Tier boundaries are absolute, so a rival's collapse cannot change your city's tier.
- The player's nation is distinguishable at a glance without the map becoming one highlighted nation and three others. When `playerNationId` is null, none is marked.
- Tests: a single-cell nation emits four edges; interior edges are absent; tier boundaries are absolute; exactly one nation carries the player rule, or none when there is no player nation.
- Judgement the owner has to make in a browser, so state it in the report: whether the map still reads as four nations rather than one nation plus three others, and whether 6 px cells carry territory, tier and change now that the map is permanently on screen rather than opened on demand.

### C1-7 — Mount the city view

Read `traversal.md` §2.2 and §3 (L1).

- `packages/client/src/local/cityViewPanel.ts` owns its `createWorldViewport` and exposes open, close and update. The Pixi `Application` is the one that already exists and has no other consumer — do not create a second, which would mean a second WebGL context.
- Copy the container topology from `main.ts` rather than inventing one. `renderMapLayer`, `renderStructureLayer` and `renderAgentLayer` all write into the same object layer and each clears only its own labels, so correct front-to-back ordering depends on `sortableChildren` and the `zIndex` assignments living outside the render functions. A panel that mounts everything into one container looks right and silently loses depth.
- Gate the redraw. `renderMapLayer` destroys and recreates one sprite per tile — 3072 of them — so rebuilding on every `season` is a full teardown every 3.75 seconds at x8. Structures and fields may update every season; ground and trails only when the season *name* changes, which is the only thing that alters their appearance. `main.ts` already has this pattern.
- The open city is marked as open on the world map. That marker is the continuity cue: both surfaces are visible at once and no transition carries the player's place for them. The panel's chrome takes the nation's banner colour from C1-1, since a synthesized `WorldState` carries no nation identity of its own.
- Default target is the player's capital. Opening and closing never blocks the clock, the ranking or the countdown.
- Tests: open and close leave no orphaned containers or listeners; the ground redraw fires on a season-name change and not on an intra-season update; the panel reads its colour from the banner assignment rather than from `Polity.color`.

### C1-8 — Directives visible in the city

Read `traversal.md` §3 (L2) and the sprite-mapping follow-up in `docs/superpowers/design/`.

- `clearFarmland` becomes fields with a crop stage from the nation season; `encourageStores` a granary; `growCity` and `developmentLevel` more houses and more street.
- Trade routes touching the city become a road leaving on the correct bearing.
- `developTimber`, `openMine` and `holdFestival` are all drawable from the 396 already-vendored PNGs — see `docs/superpowers/design/2026-07-27-directive-sprites.md` for the exact tiles, the six candidates it dropped on measured evidence, and why the festival is procedural rather than a sprite. Do not add asset files.
- Anchors are already reserved. `directiveAnchorPositions(scene)` returns one `Position` per `DirectiveKind`, derived from `scene.stockpile.pos`, on the ring at chebyshev exactly 2 from the store, held clear of houses, streets and standing resources and levelled to bare plains. Read the anchors off the returned state; never re-derive the patch layout. Because the record is keyed by `DirectiveKind`, a seventh kind becomes a compile error rather than a kind with no home. Six is the ceiling by construction: `isAlreadyActive` gates one directive per kind per city.
- **A geometric limit that constrains this task.** A radius-2 ring cannot hold six pairwise non-adjacent tiles — the maximum is four. Excluding the four avenue tiles leaves twelve in four corner runs of three, and the runs turn at the corners, so even a run's endpoints are diagonally adjacent. C1-2 spent the available spacing on the three kinds that carry loose props — timber, festival, and the mine's optional spoil chunk — which are pairwise exactly 3 apart, because those are the groups that would read as one heap at 16 px. The two touching pairs, `openMine`/`encourageStores` and `clearFarmland`/`holdFestival`, are prop-beside-building. **If the mine head and the granary collide visually, that is why, and the fix is a second ring at radius 3** — a supervisor decision, not something to improvise here.
- Gate: issuing `clearFarmland` in the browser produces visible fields in the capital by the next season report.

### C1-9 — Change made visible

Read `visual.md` §2.4.

- Territory change flashes and decays; construction shows progress from `seasonsRemaining` and `totalSeasons`; the season boundary announces itself.
- Animation phase is a pure function of `tick`, so the same tick renders the same frame.
- `WorldCellChange` arrives as a per-season delta and is never recomputed by diffing snapshots — a coalesced update would silently lose a flash.
- Tests: phase is pure in `tick`; decay reaches zero exactly at the boundary; a multi-cell change staggers rather than firing as one flash; at x8 the compressed lifetimes still complete.
- Judgement for the owner, stated in the report: at x8 with several nations acting, is this a map or a fireworks display? If the latter, the design names what to cut first.

## Completion criteria

- `just check` and `just test` pass at every commit, and the client build succeeds.
- Every order is acknowledged at speed 0, and a rejection is visibly different from an acceptance.
- The city view opens and closes while seasons resolve, with the ranking and countdown live throughout.
- No client code computes a prosperity score, judges directive legality, or sums component contributions into a displayed total.
- No `Date.now()` or `Math.random()` in synthesis or in any view model.
- Frozen resident-scale modules and their tests remain in the tree and green; the city view drives several of them unchanged.

## Worker rules

- TDD: failing test → implement → green → commit. Conventional Commits.
- Read the design document named in the task before writing code. It is the scope.
- `packages/client/` only. No edits under `packages/shared/` or `packages/server/`. A missing protocol field is a stop-and-report.
- Never delete or disable a test. A bug fix needs a failing-then-passing test.
- No new dependencies. No new asset files — 396 PNGs are already vendored under `packages/client/public/assets`.
- Reuse the existing renderers and view models rather than forking them.
- Do not dispatch reviewer sub-agents. The commit is part of the task; never end a task with uncommitted work.
- Do not push. The supervisor merges and pushes.
- No absolute local paths in code, docs or commit messages.
- If a frozen client boundary looks wrong, stop and report instead of editing it. That has twice been the right call on the simulation side.
