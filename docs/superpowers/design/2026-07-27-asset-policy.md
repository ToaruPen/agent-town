# Asset policy — how new art gets made

The owner asked whether future assets should be generated (Codex with image generation, given a detailed palette and references) and made pixel-perfect. The answer is yes for some art and no for tiles, and the part that makes either work is a conformance gate rather than a prompt.

## What is vendored today

396 PNGs under `packages/client/public/assets/`, in three Kenney packs — Tiny Town 1.1, Tiny Farm, Tiny Dungeon — each with its own `License.txt`. All three are **CC0**: free for commercial use, credit appreciated but not required. Nothing about adding new art is blocked by licensing on the existing side; the provenance of generated art is a separate question and belongs to the owner.

Two measured facts about those 396 files decide the policy:

**Alpha is only ever 0 or 255.** Not one partially transparent pixel exists across the whole set. The packs have no anti-aliasing at all.

**61 unique opaque colours**, and the tail is instructive:

| rank | colour | pixels | note |
|---|---|---:|---|
| 1 | `#3f2631` | 22786 | the outline colour — every sprite is outlined in it |
| 2 | `#eaa56c` | 9085 | skin / warm mid |
| 3 | `#8b9bb4` | 6520 | stone mid |
| … | | | |
| 26 | `#8c9cb5` | 190 | **off-by-one from `#8b9bb4`** |
| 56 | `#51607d` | 8 | **off-by-one from `#52607c`** |
| 60 | `#aab7cc` | 2 | |
| 61 | `#f3cdac` | 2 | |

So the real palette is roughly forty colours with a short tail of near-duplicates that leaked in from resampling somewhere upstream. A gate that demanded "every pixel in the declared palette" would flag the vendored packs themselves. That is worth knowing before writing the test rather than after.

## The policy

**Procedural `Graphics` is the default for anything on the 16 px grid.** This is not a preference; it is what the project has already been doing successfully. `terrainDecor`, `shadow` and the recent visual work all draw rather than load, and the directive-sprite investigation reached the same conclusion independently: the festival's answer was about twelve lines of `Graphics` reusing a pole-and-pennant shape already in `historyLayer.ts`, not a sprite that needed making. Image generators are weakest at exactly the thing a 16×16 tile needs — a hard 1 px outline in one exact colour, no anti-aliasing, and a pixel grid that survives at 1:1.

**Generation is the right tool off the grid.** A title screen, 国柄 card illustrations, nation crests at UI scale, loading art: larger, not tiled, not required to sit on 16 px boundaries, and not required to match the outline convention. That is where a detailed palette and reference sheet in the prompt does real work.

**Pixel-perfection is enforced, not requested.** "Make it pixel perfect" is not a property a prompt can guarantee. It is a property a test can. Before any generated tile enters the tree, add a conformance test asserting, for every file under the new-art directory:

1. dimensions are an exact multiple of 16;
2. every alpha value is 0 or 255;
3. every opaque colour is in an explicitly declared palette constant;
4. the outline colour, where an outline exists, is `#3f2631`.

With that gate in place the provenance stops mattering — model, human or script, non-conforming art fails `just check`. Without it, "pixel perfect" is a hope that decays with every asset added. The gate is also the cheap part: the palette is already measured above, and reading PNGs in a test needs no new runtime dependency in `packages/client`.

**Snapping and quantisation happen before the file reaches the repo.** If a tile is generated, it gets snapped to the grid and cleaned of inconsistent pixels first, and only the cleaned file is committed.

That step does not have to be built here. [Sprite Fusion](https://www.spritefusion.com/) ships a **Pixel Snapper** — batch cleanup of messy, blurry or off-grid pixel art into a crisp grid — alongside its tilemap editor and its own pixel-art generator. That covers the grid and the stray-pixel problem as a product rather than as something to write. What it is not known to cover is *this project's* palette and outline convention: whether it can quantise to a declared 40-colour set and force outlines to `#3f2631` has not been verified. So the producer-side tool and the consumer-side gate are complementary, not alternatives — the snapper makes conforming art easy to produce, and the conformance test is what guarantees only conforming art is in the tree.

Practical consequence: Sprite Fusion is a hosted browser tool, so it is a **manual step in the owner's hands**, not something a worker or CI can invoke. The workflow is generate → snap in the browser → conformance test in the repo. A worker never fetches or generates art on its own.

Sprite Fusion's tilemap editor is worth a separate note, because its obvious use here is not the real one. The local city view's layout is *generated deterministically from nation state* — a hand-authored tilemap is the opposite of that and would not fit. Where it does fit is authoring the multi-tile compositions that `2026-07-27-directive-sprites.md` describes — the mine head's roof/wall/emblem arrangement, the timber camp's prop group — as reusable stamps that the generator then places. Author once, export JSON, commit a small data file, and let the generator decide where stamps go. That is worth doing when C1-8 needs those stamps, and not before.

## What this does not change yet

The current need is zero, and the owner is explicit that getting by on already-published assets is a fine outcome rather than a compromise. The three directives that had no sprite representation — `developTimber`, `openMine`, `holdFestival` — all turned out to be buildable from the vendored packs with no new file (`2026-07-27-directive-sprites.md`). So this document is policy for when a real need appears, and nothing gets built speculatively.

Two things to settle at that point, not now:

- **Verify the tool exists.** Whether the Codex CLI in use has an image-generation tool available, and in what form, has not been checked. Design the workflow after confirming it, not before. Sprite Fusion's own generator is a second option and needs no CLI capability at all.
- **`AGENTS.md` currently says no new assets, flatly.** That is the right default while no gate exists, because it makes a worker stop and report rather than improvise. When the gate lands, the rule becomes "no new assets that do not pass the conformance test".

## Audio

There is no audio in the project at all. A separate investigation is designing the sound and collecting CC0 candidates; its document will land beside this one. The policy above applies in spirit — licence verified at the source and committed alongside the files, no new runtime dependency where a browser API will do, and a conformance rule rather than an intention — but sound has one problem the visuals do not, and it is the harder one: at x8 a season boundary fires every 3.75 seconds across four nations, so anything pleasant at x1 becomes a machine gun. That has to be solved structurally, not with a volume slider.
