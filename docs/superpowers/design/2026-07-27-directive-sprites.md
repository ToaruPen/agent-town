# Directive sprites: lumber camp, mine head, festival

Can `developTimber`, `openMine` and `holdFestival` be depicted from the 396 vendored PNGs?

## Verdict

| Directive | Verdict | Mode |
| --- | --- | --- |
| `developTimber` | **Yes**, from vendored tiles alone | Ground props, not a building |
| `openMine` | **Yes**, from vendored tiles alone | Fits the existing `{roof, wall, emblem}` building contract exactly |
| `holdFestival` | **Yes, but not from sprites** | ~12 lines of `Graphics`, reusing a shape already in the tree |

No new asset file is needed for any of the three. That is a stronger answer than I expected to be able to give, and the festival is the interesting case: the packs contain no banner, no flag, no bunting, no stage, no instrument and no free-standing fire — but the client already draws a pole-and-pennant procedurally at `historyLayer.ts:23-34`, and the simulation says a festival should not be a building anyway. Details in §4.

Six candidates I intended to recommend were **dropped on measured evidence** during this pass (§1.3). That is the part of this document most worth reading before implementing.

---

## Part 1 — Method and evidence

### 1.1 The standard this follows

`docs/superpowers/specs/2026-07-27-asset-inventory.md` sets the rule for asset claims in this repo: record **only what was confirmed by rendering**, never from memory, because three tiles had previously been recorded wrong. It also warns that tile numbers mean different things across packs (tiny-farm 0108/0109 are farmers; tiny-dungeon 0108/0109 are a slime and a one-eye), so every citation below names **pack and number together**.

I read all three 132-tile packs as labelled contact sheets at 7x, then re-rendered every candidate at 18x, and the final citation set at **34x composited over the actual plains grass tile** (`tiny-town/tile_0000.png`, `srgb(132,198,105)`) so that each prop was judged against the background it will really sit on.

Confidence is marked per tile below: **[34x]** = confirmed at 34x over real terrain, **[18x]** = confirmed at 18x, **[7x]** = read off the contact sheet only. Every tile I actually recommend is [34x] or [18x]. Nothing load-bearing rests on a 7x read.

That distinction earned its keep twice. tiny-farm 0093/0094/0095 and 0129/0130/0131 look like **tents** at 7x — I nearly recommended them as festival pavilions. At 20x they are **grass edge and corner tiles**. And I read tiny-town 0057 as a beehive at 7x; at 34x it is a vendor's stall board and the beehive is tiny-town 0094. Both errors were caught only by magnifying.

### 1.2 The measurement that decides placement

A 16x16 tile is not automatically a prop. Whether it can be laid over arbitrary terrain depends on what its **outermost 1px ring** contains, so I measured that ring for all 39 candidates. Two colours matter:

- `srgb(63,38,49)` dark plum is Kenney's **outline** colour. An object whose silhouette reaches the tile edge has plum on the ring. This is *not* a seam — it is the object's own contour, and the tile still composites cleanly over anything.
- A wide arc of a **field** colour — grass `srgb(132,198,105)`, dirt `srgb(234,165,108)`, stone `srgb(139,155,180)` — means ground is baked into the tile. It will show as a coloured square over any terrain that does not match exactly.

So the useful classes are:

- **PROP** — ring is empty or plum-only. Safe over any terrain.
- **FIELD-BLED** — ring carries a ground colour. Legal only on ground of that exact colour.

The local view's terrain is `tiny-town` 0000/0001 grass `srgb(132,198,105)` for plains and forest, and 0025/0040 dirt `srgb(234,165,108)` for rock (`sprites.ts:135-149`).

### 1.3 Six candidates dropped on this evidence

These all looked right in the contact sheet and fail the ring test. Recording them so nobody re-proposes them:

| Tile | Reads as | Ring measurement | Why dropped |
| --- | --- | --- | --- |
| tiny-town 0043 | grass strewn with grey rubble | **60/60 px grass** `srgb(132,198,105)` | A mine sits on rock/hills, where this paints a **green square**. Pure grass field, no outline. [34x] |
| tiny-town 0002 | grass with yellow flowers | 58/60 px grass | Same restriction. Usable on plains only, and a festival should not be terrain-locked. |
| tiny-dungeon 0069/0070/0071 | wooden scaffolding / stacked rails | 34–52/60 px, incl. dirt `srgb(234,165,108)` | Dungeon **floor** tiles with scaffolding painted on. Over grass they show a dirt-and-black square. Their opaque corners `srgb(63,38,49)` are background, not outline. [18x] |
| tiny-dungeon 0067 | ladder | 32/60 px, dirt arc | Same — a floor tile, not a prop. |
| tiny-town 0103 | ladder in a frame | **196/196 fill**, 46 plum + 12 slate | Full-bleed. Would replace the terrain cell. |
| tiny-dungeon 0029 | lit brazier flame | 52/60 px stone `srgb(139,155,180)` | The **only fire in all 396 tiles**, and it is baked into a masonry wall tile. Cannot be placed on open ground — it paints a grey wall square around itself. This is the single most consequential negative finding; see §4. |

### 1.4 The composition grammar already in the tree

Two placement idioms exist, and picking the right one per directive matters more than picking tiles.

**Buildings** — `structureLayer.ts` composes three tiles per building: roof at `y: -TILE_SIZE`, wall at `y: 0`, optional emblem at `y: 0`, plus a shadow. The four existing buildings (`sprites.ts:179-211`) show the grammar is *roof (material × form) × wall (material × opening) × emblem*, and that **the emblem slot names the trade**:

| building | roof | wall | emblem |
| --- | --- | --- | --- |
| house | 0067 red gable | 0086 timber + door | — |
| communalGranary | 0063 slate gable | 0074 timber + wide doorway | 0116 **pitchfork** |
| grainMarket | 0055 red + dormer | 0075 plain timber | 0093 **grain bundle** |
| rationDepot | 0051 slate + dormer | 0078 slate + doorway | 0083 **notice board** |

A pickaxe emblem for a mine is therefore not an invention — it is the next entry in a pattern the codebase already established. Note also that tiny-town 0074 and 0078, which I had earlier read as "archways / adit mouths", are **already in use as wall slots**, and the code's own comments call them "a timber wall with a wide doorway" and "a slate wall with a doorway". Their 52/60 field-bled ring is correct *because* a wall tile is supposed to be full-bleed. Reading them as free-standing arches would have been a mistake.

**Ground props** — `mapLayer.ts:145-166` anchors the stockpile on one tile and places two props at **quarter-tile offsets**, `stockpileX - TILE_SIZE/4` and `+ TILE_SIZE/4`, each with `objectDepth(tileY, kind)`. So a multi-prop site on a single anchor tile is an existing idiom, and sub-tile offsets are already sanctioned. `WorldObjectKind` (`sprites.ts:16-35`) gives the depth bands: `resource` 0, `stockpile` 1, `field`/`house` 2, `facility` 3, `landmark` 4, `tombstone` 5, `agent` 6.

### 1.5 What the simulation says these three things *are*

`constants.ts:361-379` settles a question the art cannot:

| directive | materials cost | duration |
| --- | --- | --- |
| `clearFarmland` | 30 | 2 seasons |
| `developTimber` | 20 | 2 seasons |
| `openMine` | **50** | **3 seasons** |
| `growCity` | 40 | 3 seasons |
| `encourageStores` | 10 | 2 seasons |
| `holdFestival` | **0** | **1 season** |

The mine is the most expensive and slowest directive in the game — it earns a built structure. The festival is the only directive costing **zero materials** and the only one lasting **one season**, and its cultural affinity is faith 0.7 / kinship 0.5 (`constants.ts:432-441`). It constructs nothing. Depicting it as a building would contradict the simulation, not merely look odd. This is the real reason no vendored building tile fits a festival, and it is why the answer for it is a different *kind* of mark rather than a different tile.

---

## Part 2 — `developTimber`: a lumber camp

**Verdict: buildable from vendored tiles. Ground props, not a building.**

A stump and a felled log are ground objects. Forcing them into the roof-plus-wall stack would produce a generic timber shed indistinguishable from `communalGranary`. Use the stockpile idiom instead.

**Composition** — one anchor tile, three props, in draw order:

| Role | Asset | Offset from anchor | Depth kind | Ring class | Conf. |
| --- | --- | --- | --- | --- | --- |
| Cut stump, end-grain visible | `/assets/tiny-farm/Tiles/tile_0014.png` | `x`, `y` | `resource` | PROP (8 plum + 5 dirt px) | [34x] |
| Felled log, end-grain circle | `/assets/tiny-town/Tiles/tile_0106.png` | `x + TILE_SIZE/4`, `y + 2` | `stockpile` | PROP (12 plum only) | [34x] |
| Axe, grey blade on tan handle | `/assets/tiny-farm/Tiles/tile_0087.png` | `x - TILE_SIZE/4`, `y - 2` | `stockpile` | PROP (15 plum only) | [34x] |

Optional fourth prop for a developed camp — a stacked-timber pile:
`/assets/tiny-farm/Tiles/tile_0096.png`, an amber two-tone block with lighter flecks, plum-framed with transparent corners only, so it is PROP-class and safe over any terrain [34x].

**Note on tiny-farm 0096/0097.** These are genuinely ambiguous and I will not pretend otherwise. 0096 reads as either a **hay bale** or **sawn timber stacked end-on**; 0097, amber with vertical red/salmon stripes, reads as either **planks stood on end** or **striped awning fabric**. Both are plum-framed objects, so both are safe to place — the risk is semantic, not technical. Prefer 0096 for timber, and see the browser check in §6.

**Alternative axes**, if 0087 reads too small beside the stump: `/assets/tiny-town/Tiles/tile_0129.png` (11 plum px, PROP) or `tile_0127.png` (17 plum px) [18x].
**Bare trunks / branches** for a cleared-forest edge: `/assets/tiny-farm/Tiles/tile_0002.png`, `tile_0026.png`, `tile_0038.png` — all PROP-class, 9–13 plum px [18x].

The axe-beside-stump reading is the one that says "logging" rather than "a log lies here". Keep the axe.

---

## Part 3 — `openMine`: a mine head

**Verdict: buildable from vendored tiles, and it fits the existing building contract without extending it.**

This one maps onto `{roof, wall, emblem}` cleanly, which means it needs no new composition code at all — only a new entry in `SPRITE_ASSETS.buildings`.

| Slot | Asset | Content | Conf. |
| --- | --- | --- | --- |
| `roof` | `/assets/tiny-town/Tiles/tile_0048.png` | Slate shingle course with a pale ridge cap | [34x] |
| `wall` | `/assets/tiny-town/Tiles/tile_0089.png` | Grey stone wall with a **stone lintel arch over a timber door** — the portal | [34x] |
| `emblem` | `/assets/tiny-town/Tiles/tile_0115.png` | **Pickaxe**, grey double head on a tan handle | [34x] |

tiny-town 0089 is the best adit available in the packs: the arched grey lintel over a brown timber door is exactly the pithead-portal shape, and it is currently unused. Both 0048 and 0089 are full-bleed, which is correct for the roof/wall slots.

**Distinguishing it from `rationDepot`**, which is also slate (0051 dormer + 0078 slate wall + notice board): three differences — ridge-cap roof instead of a dormer, arched stone lintel instead of a plain opening, timber door instead of the red door, plus the pickaxe. That is enough to separate them, but grey-on-grey similarity is a genuine risk; see §6.

**Optional ore spoil prop** at `x + TILE_SIZE/2`, depth `resource`: `/assets/tiny-farm/Tiles/tile_0089.png`, a grey-white ore chunk with blue-grey facets, PROP-class at 8 plum px [34x]. Use this instead of tiny-town 0043 — 0043 is the tile that paints a green square on rock (§1.3).

**Alternative wall** if the arch reads too much like a doorway: `/assets/tiny-town/Tiles/tile_0090.png`, plain grey stone with a brown timber door [34x].

---

## Part 4 — `holdFestival`: the honest answer

**Verdict: not achievable from the vendored sprites. Achievable in ~12 lines of `Graphics`, and no new asset is needed.**

### 4.1 What is absent

Confirmed by reading all three packs: there is **no banner, no flag, no bunting, no stage, no instrument, and no free-standing fire** in any of the 396 tiles. The only fire is tiny-dungeon 0029, and §1.3 shows it is welded into a masonry wall tile — it cannot stand on open ground.

What the packs *do* have is market and feast furniture: the stall board with a pale lantern (`tiny-town/tile_0057.png`, PROP, 30 plum px [34x]), produce stands (`tiny-farm` 0011/0047/0071, plum-only rings [18x]), benches (`tiny-farm` 0098/0099 [18x]), kegs (`tiny-farm/tile_0085.png`, `tiny-dungeon/tile_0082.png` [18x]), a grain sheaf (`tiny-farm/tile_0068.png`, **zero edge pixels** [18x]) and a sunflower (`tiny-farm/tile_0083.png` [18x]).

### 4.2 Why assembling those anyway would be the wrong answer

A festival built only from stalls, benches and kegs **is a market**. The client already has a `grainMarket` building, and `encourageStores` is a separate directive with its own visual claim on commerce imagery. A player seeing stalls appear cannot tell whether their festival order or their stores order took effect — which defeats the entire point of "the map shows what your orders did". This is precisely the strained composition worth refusing.

It is also wrong on the simulation's terms: `holdFestival` costs **zero materials** and lasts **one season** (§1.5). It builds nothing. A permanent-looking cluster of furniture would misreport a transient act of faith and kinship as construction.

### 4.3 What to build instead

The client already draws a pole-and-pennant. `historyLayer.ts:23-34`, inside `drawBorderFort`:

```ts
.moveTo(8, 7)
.lineTo(8, 2)
.stroke({ color: STONE_COLOR, width: 1 })
.poly([8, 2, 13, 4, 8, 5])
.fill(EMBER_COLOR)
```

A 1px pole from (8,7) to (8,2) and a 5x3 pennant triangle. Extract those five calls as a reusable `drawPennant(graphic, { poleColor, flagColor })` and the festival mark is done. Fill the pennant with the **nation's banner colour** from the derived banner palette in `design-visual.md` §3 — not `Polity.color`, for the reasons recorded there — and the festival simultaneously reads as *whose* festival. Nothing else in the local view carries nation identity, so this is a free gain.

Place a small ring of pennants (3–5) on the tiles around the city's plaza anchor at depth `landmark` (4), so they draw over buildings, which is correct for a tall pole. Dress the ground beneath with two vendored props — the sheaf `tiny-farm/tile_0068.png` and a keg `tiny-farm/tile_0085.png` — at depth `stockpile`. Remove the whole group when `seasonsRemaining` reaches 0. One season of pennants over the existing town, then gone, is a truthful depiction of a festival.

**This is not a request for new art.** It reuses a shape already shipped in the tree, drawn with the renderer the local view already uses.

### 4.4 If a bonfire is wanted later

If a lit brazier is ever judged necessary, the smallest new asset that would do it is **one 16x16 PNG with a transparent background: a stone fire-ring with three flame tongues** — a recolour of tiny-dungeon 0029's flame lifted off its masonry. But I would not commission it. The pennant already distinguishes ceremony from commerce, and it carries nation colour, which a bonfire cannot.

---

## Part 5 — File mapping

All paths are repository-relative.

| File | Change |
| --- | --- |
| `packages/client/src/render/sprites.ts` | Add `SPRITE_ASSETS.buildings.mineHead` (0048 / 0089 / 0115). Add a `SPRITE_ASSETS.directive` group for timber props (farm 0014, town 0106, farm 0087, farm 0096), mine spoil (farm 0089) and festival ground props (farm 0068, farm 0085). Add each path to `SPRITE_PATHS`. Keep the existing comment convention: one line per tile naming pack, number and contents. |
| `packages/client/src/render/structureLayer.ts` | No change for the mine — it flows through the existing `buildingContainer` roof/wall/emblem path. |
| `packages/client/src/render/historyLayer.ts` | Extract the pole-and-pennant from `drawBorderFort` (`:23-34`) into `drawPennant(graphic, colors)`; have `drawBorderFort` call it so its appearance is unchanged. |
| `packages/client/src/render/directiveLayer.ts` *(new)* | Place timber props, mine spoil and festival pennants from the active-directive list, using the `mapLayer.ts:145-166` anchor-plus-offset idiom and `objectDepth`. |
| `packages/client/src/render/mapLayer.ts` | Call the new layer after `objectLayer` is populated. |

No new dependency, no new asset file, no change to the frozen resident layers.

---

## Part 6 — Slices, in order

- **D-1 — Extract `drawPennant`.** Pure refactor of `historyLayer.ts`; the border-fort landmark must render byte-identically. Test: existing history-layer tests stay green. Smallest, unblocks the festival.
- **D-2 — Mine head.** Add the `mineHead` building entry. No new placement code. Test: `SPRITE_PATHS` contains the three new paths and each file exists on disk.
- **D-3 — Timber camp props.** Add `directiveLayer.ts` with the three-prop stump/log/axe group at quarter-tile offsets.
- **D-4 — Festival pennants.** Pennant ring at depth `landmark`, filled from the banner palette, plus the two ground props; removed at `seasonsRemaining === 0`.
- **D-5 — Spoil and polish.** Mine ore chunk, optional timber stack, whichever browser checks below came back needing work.

D-1 and D-2 are independent of the banner-palette work in `design-visual.md` V-1. **D-4 depends on V-1**, because the pennant's fill colour comes from the derived palette.

---

## Part 7 — Risks and what to look at in a browser

1. **Hand-drawn `Graphics` beside vendored pixel art.** The festival pennant is the first time procedural art and Kenney tiles share a tile neighbourhood — `historyLayer` landmarks are world-map marks that never sit next to a 16px sprite building. This is a judgement that cannot be made from a table. **Look at:** a festival pennant standing next to a `house` (town 0067/0086) at the local view's zoom. Does the pennant's edge hardness and palette sit with the sprites, or does it read as a UI overlay floating above the scene? **Fallback if it floats:** flat two-colour pennant using colours sampled from the packs — pole `srgb(189,108,74)` (the ochre timber in tiny-town 0074/0085), outline `srgb(63,38,49)` (Kenney's own outline plum), so the only non-pack colour is the nation's banner fill.
2. **Mine vs ration depot.** Both are slate buildings. **Look at:** a `mineHead` and a `rationDepot` side by side. If they blur together, swap the mine's roof from tiny-town 0048 to 0060 (slate with a brown eave course, unused, [18x]) for a stronger silhouette break.
3. **tiny-farm 0096/0097 semantics.** They are safe to place but ambiguous in meaning (§2). **Look at:** 0096 next to the stump-and-log group. If it reads as hay rather than timber, drop it — the stump/log/axe trio already carries the meaning, and the fourth prop is optional.
4. **Festival vs market confusion.** Mitigated by the pennant, not eliminated. **Look at:** an active festival in a city that also has a `grainMarket`. The pennants must be what the eye lands on. If the ground props compete, cut them and keep pennants alone.
5. **Full-bleed tiles on the wrong ground.** tiny-town 0043 and 0002 are grass-bled and must not be used for the mine (§1.3). If anyone later adds a ground-decoration tile, run the ring test first.
6. **Prop crowding at 16px.** Three props at quarter-tile offsets on one anchor is at the edge of what the stockpile precedent proves (it uses two). **Look at:** the timber camp with all four props on a forest tile — if the axe disappears into the log, move it to a second anchor tile.
7. **Multi-tile footprint is unspecified.** I have assumed each directive mark occupies one anchor tile, following the stockpile. Whether a city has room for that near each `NationCityState` is a question for whoever owns local-view layout; I have not seen a plaza or free-tile concept in the local view to anchor to. **This is the one genuinely unsettled item** — the tiles are confirmed, the anchor point is not.

---

## Appendix — Every asset cited

Verified present on disk under `packages/client/public/assets/`.

**Timber:** `tiny-farm/Tiles/tile_0014.png` stump · `tiny-town/Tiles/tile_0106.png` cut log · `tiny-farm/Tiles/tile_0087.png` axe · `tiny-farm/Tiles/tile_0096.png` amber stack · alternates `tiny-town/Tiles/tile_0129.png`, `tile_0127.png`, `tiny-farm/Tiles/tile_0002.png`, `tile_0026.png`, `tile_0038.png`

**Mine:** `tiny-town/Tiles/tile_0048.png` slate roof + ridge · `tiny-town/Tiles/tile_0089.png` stone arch + timber door · `tiny-town/Tiles/tile_0115.png` pickaxe · `tiny-farm/Tiles/tile_0089.png` ore chunk · alternates `tiny-town/Tiles/tile_0090.png`, `tile_0060.png`

**Festival:** `tiny-farm/Tiles/tile_0068.png` grain sheaf · `tiny-farm/Tiles/tile_0085.png` keg · pennant from `historyLayer.ts:23-34` · unused-but-available `tiny-town/Tiles/tile_0057.png` stall board, `tiny-farm/Tiles/tile_0011.png`/`0047`/`0071` produce stands, `tile_0098.png`/`0099` benches, `tile_0083.png` sunflower

**Do not use:** `tiny-town/Tiles/tile_0043.png` (grass-bled) · `tiny-town/Tiles/tile_0002.png` (grass-bled) · `tiny-dungeon/Tiles/tile_0029.png` (fire welded to masonry) · `tiny-dungeon/Tiles/tile_0067.png`/`0069`/`0070`/`0071` (floor tiles) · `tiny-town/Tiles/tile_0103.png` (full-bleed) · `tiny-farm/Tiles/tile_0093.png`–`0095`, `0129`–`0131` (grass edges, not tents)
