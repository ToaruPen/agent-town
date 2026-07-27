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

**Quantisation is a deterministic post-process, not a prompt instruction.** If a tile is generated, it goes through snap-to-grid and quantise-to-palette as a scripted step whose output is committed, with the script committed alongside it. Regenerating must produce the same bytes.

## What this does not change yet

The current need is zero. The three directives that had no sprite representation — `developTimber`, `openMine`, `holdFestival` — all turned out to be buildable from the vendored packs with no new file (`2026-07-27-directive-sprites.md`). So this document is policy for when a real need appears, and the pipeline gets built then rather than speculatively.

Two things to settle at that point, not now:

- **Verify the tool exists.** Whether the Codex CLI in use has an image-generation tool available, and in what form, has not been checked. Design the workflow after confirming it, not before.
- **`AGENTS.md` currently says no new assets, flatly.** That is the right default while no gate exists, because it makes a worker stop and report rather than improvise. When the gate lands, the rule becomes "no new assets that do not pass the conformance test".
