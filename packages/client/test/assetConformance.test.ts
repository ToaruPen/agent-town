import { relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkBinaryAlpha,
  checkOutlineColor,
  checkPalette,
  checkTile,
  checkTileGrid,
  type DecodedImage,
  hasSilhouette,
  MEASURED_VENDOR_PALETTE,
  NEW_ART_PALETTE,
  OUTLINE_COLOR,
  TILE_SIZE_PX,
} from "./assetConformance.js";
import {
  CLIENT_SRC_ROOT,
  listFiles,
  listPngFiles,
  NEW_ART_ROOT,
  readPng,
  readSource,
  VENDORED_ASSET_ROOT,
} from "./pngTree.js";

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function colorOf(image: DecodedImage, index: number): number {
  const at = index * 4;
  const red = image.pixels[at] ?? 0;
  const green = image.pixels[at + 1] ?? 0;
  const blue = image.pixels[at + 2] ?? 0;
  return (red << 16) | (green << 8) | blue;
}

function opaquePixelCounts(files: readonly string[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const file of files) {
    const image = readPng(file);
    for (let index = 0; index < image.width * image.height; index += 1) {
      if (image.pixels[index * 4 + 3] !== 255) continue;
      const color = colorOf(image, index);
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  return counts;
}

/** How many pixels of one exact colour a file spends, which is how "is this sprite outlined" is
 *  answered without guessing which pixels the artist meant as outline. */
function countColor(file: string, color: number): number {
  const image = readPng(file);
  let found = 0;
  for (let index = 0; index < image.width * image.height; index += 1) {
    if (image.pixels[index * 4 + 3] === 255 && colorOf(image, index) === color) found += 1;
  }
  return found;
}

/** Keeps the commoner member of every twin pair. Ranking by pixel count first means the keeper is
 *  always seen before its artefact, so no comparison of the two is needed here. */
function withoutTwins(counts: Map<number, number>): number[] {
  const ranked = [...counts.keys()].sort((one, other) => {
    return (counts.get(other) ?? 0) - (counts.get(one) ?? 0);
  });
  const kept: number[] = [];
  for (const color of ranked) {
    if (!kept.some((keeper) => channelDistance(keeper, color) <= 1)) kept.push(color);
  }
  return kept;
}

/** Largest per-channel gap, so a twin is a colour one unit away in every band. */
function channelDistance(one: number, other: number): number {
  return Math.max(
    Math.abs(((one >> 16) & 0xff) - ((other >> 16) & 0xff)),
    Math.abs(((one >> 8) & 0xff) - ((other >> 8) & 0xff)),
    Math.abs((one & 0xff) - (other & 0xff)),
  );
}

function twinPairs(palette: readonly number[]): string[] {
  const pairs: string[] = [];
  for (let left = 0; left < palette.length; left += 1) {
    const one = palette[left] ?? 0;
    for (let right = left + 1; right < palette.length; right += 1) {
      const other = palette[right] ?? 0;
      if (channelDistance(one, other) <= 1) pairs.push(`${hex(one)}~${hex(other)}`);
    }
  }
  return pairs;
}

/** Colours lifted from the vendored packs so the palette rule is exercised on real values.
 *  `STONE_TWIN` is rank 26 in asset-policy.md's table: one unit away from `STONE` in every channel. */
const LEAF = 0x84c669;
const SHADE = 0x4e974c;
const STONE = 0x8b9bb4;
const STONE_TWIN = 0x8c9cb5;

const FIXTURE_LEGEND: Readonly<Record<string, number>> = {
  "#": OUTLINE_COLOR,
  a: LEAF,
  b: SHADE,
};

function writePixel(pixels: Uint8Array, at: number, color: number, alpha: number): void {
  pixels[at] = (color >> 16) & 0xff;
  pixels[at + 1] = (color >> 8) & 0xff;
  pixels[at + 2] = color & 0xff;
  pixels[at + 3] = alpha;
}

function paintRow(
  pixels: Uint8Array,
  width: number,
  y: number,
  row: string,
  legend: Readonly<Record<string, number>>,
): void {
  for (let x = 0; x < width; x += 1) {
    const glyph = row[x] ?? ".";
    if (glyph === ".") continue;
    const color = legend[glyph];
    if (color === undefined) throw new Error(`fixture glyph "${glyph}" has no colour`);
    writePixel(pixels, (y * width + x) * 4, color, 255);
  }
}

/** `.` is transparent; every other glyph is opaque and must appear in the legend. */
function imageFromRows(
  rows: readonly string[],
  legend: Readonly<Record<string, number>> = FIXTURE_LEGEND,
): DecodedImage {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    paintRow(pixels, width, y, rows[y] ?? "", legend);
  }
  return { width, height, pixels };
}

/** One-pixel mutation on a copy, so a conforming fixture stays conforming for the next test. */
function withPixel(
  image: DecodedImage,
  x: number,
  y: number,
  color: number,
  alpha = 255,
): DecodedImage {
  const pixels = Uint8Array.from(image.pixels);
  writePixel(pixels, (y * image.width + x) * 4, color, alpha);
  return { width: image.width, height: image.height, pixels };
}

function blankRows(width: number, height: number): string[] {
  return Array.from({ length: height }, () => ".".repeat(width));
}

/** A 16x16 sprite whose whole outer silhouette is `#3f2631`, drawn the way the packs draw one. */
const CONFORMING_TILE = imageFromRows([
  "................",
  "................",
  "......####......",
  ".....##aa##.....",
  "....##aabb##....",
  "...##aabbbb##...",
  "...#aabbbbbb#...",
  "...#aabbbbbb#...",
  "...#aabbbbbb#...",
  "...##aabbbb##...",
  "....##aabb##....",
  ".....##aa##.....",
  "......####......",
  "................",
  "................",
  "................",
]);

const FIXTURE_PALETTE: readonly number[] = [OUTLINE_COLOR, LEAF, SHADE, STONE];

describe("rule 1 — dimensions are an exact multiple of 16", () => {
  it("accepts a single tile", () => {
    expect(checkTileGrid(CONFORMING_TILE)).toEqual([]);
  });

  it("accepts a multi-tile sheet", () => {
    expect(checkTileGrid(imageFromRows(blankRows(TILE_SIZE_PX, TILE_SIZE_PX * 2)))).toEqual([]);
  });

  it("rejects a sheet one pixel too wide", () => {
    expect(checkTileGrid(imageFromRows(blankRows(TILE_SIZE_PX + 1, TILE_SIZE_PX)))).toEqual([
      "width 17 is not a positive multiple of 16",
    ]);
  });

  it("rejects an empty image, which is a multiple of 16 arithmetically", () => {
    expect(checkTileGrid({ width: 0, height: 0, pixels: new Uint8Array(0) })).toEqual([
      "width 0 is not a positive multiple of 16",
      "height 0 is not a positive multiple of 16",
    ]);
  });
});

describe("rule 2 — every alpha value is 0 or 255", () => {
  // No PNG in the tree has a partial alpha, so a synthesized buffer is the only way to show this
  // rule bite. The tree-wide run below confirms the rule holds; it cannot confirm it is load-bearing.
  it("accepts a tile with no anti-aliasing", () => {
    expect(checkBinaryAlpha(CONFORMING_TILE)).toEqual([]);
  });

  it("rejects one half-transparent pixel", () => {
    expect(checkBinaryAlpha(withPixel(CONFORMING_TILE, 8, 7, SHADE, 128))).toEqual([
      "alpha 128 at (8,7) is neither 0 nor 255",
    ]);
  });
});

describe("rule 3 — every opaque colour is in the declared palette", () => {
  it("accepts a tile drawn from the declared palette", () => {
    expect(checkPalette(CONFORMING_TILE, FIXTURE_PALETTE)).toEqual([]);
  });

  it("rejects the off-by-one twin of a declared colour", () => {
    expect(checkPalette(withPixel(CONFORMING_TILE, 8, 7, STONE_TWIN), FIXTURE_PALETTE)).toEqual([
      "#8c9cb5 at (8,7) is not in the declared palette",
    ]);
  });

  it("ignores the colour under a transparent pixel, which carries no visible value", () => {
    expect(checkPalette(withPixel(CONFORMING_TILE, 0, 0, 0xff00ff, 0), FIXTURE_PALETTE)).toEqual(
      [],
    );
  });
});

describe("rule 4 — the outline colour is #3f2631 where an outline exists", () => {
  it("accepts a sprite whose silhouette is entirely the outline colour", () => {
    expect(checkOutlineColor(CONFORMING_TILE, OUTLINE_COLOR)).toEqual([]);
  });

  it("rejects one silhouette pixel painted in a fill colour", () => {
    // This is exactly how the vendored tiles fail: a fill colour left exposed on the silhouette.
    expect(checkOutlineColor(withPixel(CONFORMING_TILE, 6, 2, LEAF), OUTLINE_COLOR)).toEqual([
      "#84c669 at (6,2) is on the silhouette but is not the outline colour",
    ]);
  });

  it("ignores an enclosed hole, which is not part of the silhouette", () => {
    // Like rule 2, this distinction is only provable against a synthesized buffer: making holes count
    // as outside leaves the vendored tally at 78, so no file in the tree exercises it.
    const holed = withPixel(CONFORMING_TILE, 8, 7, SHADE, 0);
    expect(checkOutlineColor(holed, OUTLINE_COLOR)).toEqual([]);
  });

  it("accepts a full-bleed tile, which has no silhouette at all", () => {
    const fullBleed = imageFromRows(
      Array.from({ length: TILE_SIZE_PX }, () => "b".repeat(TILE_SIZE_PX)),
    );
    expect(checkOutlineColor(fullBleed, OUTLINE_COLOR)).toEqual([]);
  });

  it("treats the image border as continuing art rather than as open space", () => {
    // A tile that bleeds off its own edge abuts the next tile, not emptiness. Requiring an outline
    // at the image border would fail 167 of the vendored tiles instead of 78.
    const bleedsLeft = imageFromRows(
      Array.from({ length: TILE_SIZE_PX }, () => `${"b".repeat(7)}#${".".repeat(8)}`),
    );
    expect(checkOutlineColor(bleedsLeft, OUTLINE_COLOR)).toEqual([]);
  });

  it("accepts a tile with no outline colour anywhere, which the policy's wording allows", () => {
    // "where an outline exists" — a tile containing no #3f2631 has no outline to check, so this rule
    // catches a wrong or incomplete outline but never a missing one.
    const unoutlined = imageFromRows([
      "................",
      "................",
      "......aaaa......",
      ".....aaaaaa.....",
      "....aaaabbaa....",
      "...aaaabbbbaa...",
      "...aaabbbbbba...",
      "...aaabbbbbba...",
      "...aaabbbbbba...",
      "...aaaabbbbaa...",
      "....aaaabbaa....",
      ".....aaaaaa.....",
      "......aaaa......",
      "................",
      "................",
      "................",
    ]);
    expect(checkOutlineColor(unoutlined, OUTLINE_COLOR)).toEqual([]);
  });
});

// Time budget: decoding all 396 files costs ~10 ms per pass locally, and the tests below make eleven,
// the slowest being 25 ms where one test decodes the tree three times. At CI's ~2.7x that is under
// 70 ms, and 126 ms for the whole file, so nothing here needs a timeout above Vitest's 5 s default.
describe("the vendored packs", () => {
  const files = listPngFiles(VENDORED_ASSET_ROOT);

  it("are found by the directory walk", () => {
    // The new-art directory is empty, so this is where the walker is proven to find anything at all.
    expect(files.length).toBe(396);
  });

  it("are all PNG variants the reader supports", () => {
    const variants = new Map<string, number>();
    for (const file of files) {
      const { colorType, bitDepth } = readPng(file);
      const key = `${colorType}/${bitDepth}`;
      variants.set(key, (variants.get(key) ?? 0) + 1);
    }
    // colour type 3 is indexed, 6 is RGBA8. Nothing else appears, and nothing is interlaced.
    expect(Object.fromEntries([...variants].sort())).toEqual({
      "3/1": 7,
      "3/2": 106,
      "3/4": 277,
      "6/8": 6,
    });
  });

  it("satisfy rules 1 and 2 across every file", () => {
    const violations: string[] = [];
    for (const file of files) {
      const image = readPng(file);
      const found = [...checkTileGrid(image), ...checkBinaryAlpha(image)];
      for (const one of found) {
        violations.push(`${relative(VENDORED_ASSET_ROOT, file)}: ${one}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("use 61 opaque colours, 7 of which are off-by-one twins of another", () => {
    // The descriptive set. Rule 3 is not scoped to new art because a clean palette cannot be stated —
    // NEW_ART_PALETTE states one — but because the vendored art fails it, as the next two tests show.
    const counts = opaquePixelCounts(files);
    expect(counts.size).toBe(61);
    expect(new Set(MEASURED_VENDOR_PALETTE)).toEqual(new Set(counts.keys()));
    expect(twinPairs(MEASURED_VENDOR_PALETTE)).toEqual([
      "#eaa56c~#eba66c",
      "#8b9bb4~#8c9cb5",
      "#c0cbdc~#c1ccdd",
      "#bd6c4a~#be6c49",
      "#52607c~#51607d",
      "#009adc~#0099db",
      "#75e3ff~#76e4ff",
    ]);
  });

  it("yield a 54-colour new-art palette when each twin's rarer half is dropped", () => {
    // NEW_ART_PALETTE is committed as data but derived, not curated: this re-derives it from the art
    // so the list cannot be anyone's taste, and asserts the result has no twin pairs left in it.
    const derived = withoutTwins(opaquePixelCounts(files));
    expect(derived.length).toBe(54);
    expect(new Set(derived)).toEqual(new Set(NEW_ART_PALETTE));
    expect(twinPairs(derived)).toEqual([]);
  });

  it("do not themselves pass rule 3 against the new-art palette", () => {
    // The gate new art must clear is strictly tighter than the art already in the tree, which is the
    // whole point: 61 colours describe what Kenney shipped, 54 are what a generated tile may use.
    // 14 files, not 24: the seven artefact colours cluster in the same tiles rather than spreading.
    const offenders = files.filter(
      (file) => checkPalette(readPng(file), NEW_ART_PALETTE).length > 0,
    );
    expect(offenders.length).toBe(14);
  });

  it("carry no outline colour at all in 88 of 396 files", () => {
    // asset-policy.md says every sprite is outlined in #3f2631. Measured per file, 22.2% contain not
    // one pixel of it, so rule 4's "where an outline exists" is load-bearing rather than a formality.
    const outlinePixels = files.map((file) => countColor(file, OUTLINE_COLOR));
    const bare = outlinePixels.filter((count) => count === 0);
    expect(bare.length).toBe(88);
    expect(outlinePixels.reduce((total, count) => total + count, 0)).toBe(22786);
  });

  it("put only 227 of 396 tiles in scope of rule 4 at all", () => {
    // The two escapes in rule 4 are not marginal: 151 tiles have no silhouette to check and 18 more
    // have one but carry no outline colour, so 43% of the tree never reaches a boundary comparison.
    const fullBleed = files.filter((file) => !hasSilhouette(readPng(file)));
    const unoutlined = files.filter(
      (file) => hasSilhouette(readPng(file)) && countColor(file, OUTLINE_COLOR) === 0,
    );
    expect(fullBleed.length).toBe(151);
    expect(unoutlined.length).toBe(18);
    expect(files.length - fullBleed.length - unoutlined.length).toBe(227);
  });

  it("leave 78 tiles with an un-outlined silhouette edge, which is why rule 4 is new-art only", () => {
    // Kenney outlines the top and sides of a sprite but leaves bottom-facing pixels bare, so the
    // strong reading of rule 4 is precisely checkable and simply false for this art: of the 227 in
    // scope, 149 pass and 78 fail, typically by the 2-12 px sitting along a sprite's underside.
    const failing = files.filter(
      (file) => checkOutlineColor(readPng(file), OUTLINE_COLOR).length > 0,
    );
    expect(failing.length).toBe(78);
  });
});

describe("the new-art gate", () => {
  it("has nothing to check yet, so an empty pass here proves nothing on its own", () => {
    expect(listPngFiles(NEW_ART_ROOT)).toEqual([]);
  });

  it("reports real violations when pointed at real files", () => {
    // The gate the first generated tile will face, run against the only real files available. The
    // vendored packs fail it, which is the proof it bites: 78 on the outline and 14 on the palette,
    // and the two sets turn out to be disjoint, so 92 distinct files.
    const files = listPngFiles(VENDORED_ASSET_ROOT);
    expect(files.length).toBe(396);
    const offenders = files.filter(
      (file) =>
        checkTile(readPng(file), { palette: NEW_ART_PALETTE, outlineColor: OUTLINE_COLOR }).length >
        0,
    );
    expect(offenders.length).toBe(92);
  });
});

describe("the conformance gate stays out of the browser bundle", () => {
  const sources = listFiles(CLIENT_SRC_ROOT, ".ts");

  it("finds the client sources", () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it("never imports node builtins or test helpers from src", () => {
    const offenders = sources.filter((file) => {
      const text = readSource(file);
      return text.includes('from "node:') || text.includes('from "../test/');
    });
    expect(offenders.map((file) => relative(CLIENT_SRC_ROOT, file))).toEqual([]);
  });
});
