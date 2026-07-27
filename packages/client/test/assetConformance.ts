/** The four pixel rules from `docs/superpowers/design/2026-07-27-asset-policy.md`,
 *  §"Pixel-perfection is enforced, not requested".
 *
 *  Pure by design: every rule reads decoded pixel data and nothing else. That is what lets a test
 *  prove each rule bites by mutating a buffer it synthesized, rather than by committing a
 *  non-conforming PNG fixture — which `AGENTS.md` does not allow. Reading PNGs off disk is the other
 *  half, in `pngTree.ts`. */

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, four bytes per pixel, row-major from the top-left. */
  readonly pixels: Uint8Array;
}

/** The grid every source tile sits on. */
export const TILE_SIZE_PX = 16;

/** asset-policy.md ranks this first at 22786 pixels: the colour every vendored sprite is outlined in. */
export const OUTLINE_COLOR = 0x3f2631;

/** Every opaque colour in the vendored packs, ordered by pixel count descending.
 *
 *  Committed as data because asset-policy.md prints only six of the sixty-one rows. This is the
 *  descriptive set — what the art uses, artefacts and all — and it is what the tree conforms to by
 *  construction. New art is held to `NEW_ART_PALETTE` instead. The vendored-pack test pins this list
 *  against the tree, so it cannot drift silently. */
export const MEASURED_VENDOR_PALETTE: readonly number[] = [
  0x3f2631, 0xeaa56c, 0x8b9bb4, 0xc0cbdc, 0x84c669, 0xbd6c4a, 0x763b36, 0x262b44, 0x52607c,
  0xc34b35, 0xcf8254, 0xfec99c, 0x5a6988, 0x4e974c, 0xfdbe53, 0xe38628, 0xb86542, 0x479f4a,
  0xf28462, 0xffffff, 0xf7c282, 0xfdd6b4, 0xaa2c23, 0x3d212d, 0xc6e58d, 0x8c9cb5, 0xe84537,
  0xfcbc8f, 0x773833, 0x65a556, 0x9b4ca3, 0x43e1b3, 0xe19a65, 0xd176d0, 0xdfa988, 0xff706d,
  0xebeff8, 0x99d8f8, 0x25956a, 0x79a7e8, 0x009adc, 0xc1ccdd, 0x0099db, 0x69ffd4, 0x75e3ff,
  0xe4edf9, 0x8bd87d, 0x76e4ff, 0xba662a, 0xfeae34, 0xffd896, 0xbe6c49, 0xeba66c, 0xe94334,
  0x51607d, 0x3e4e6e, 0xfee761, 0xe2faff, 0xc47c71, 0xaab7cc, 0xf3cdac,
];

/** The palette rule 3 holds new art to: `MEASURED_VENDOR_PALETTE` minus the rarer member of each
 *  off-by-one twin pair, which is 54 colours.
 *
 *  Derived rather than curated, so it is not anyone's taste: for two colours one unit apart in every
 *  channel, the one with fewer pixels is the resampling artefact. A test re-derives this list from the
 *  art and asserts it matches, so the rule is checked and not just described.
 *
 *  What it admits and what it costs. Admits exactly 54 RGB values, so a generator that emits
 *  `#8c9cb5` beside `#8b9bb4` now fails — the near-miss an image model is most likely to produce, and
 *  the reason the descriptive 61 is the wrong gate for new art. The cost is that five of the seven
 *  pairs are decided by a 34x-757x margin and two are decided by 1.4x: `#009adc` over `#0099db`
 *  (34 px against 24) and `#75e3ff` over `#76e4ff` (20 px against 14). Those two survivors are
 *  arbitrary on the evidence. If new art legitimately needs the dropped member of either, override
 *  the entry rather than widening the rule — the blast radius is two colours no vendored tile spends
 *  more than 34 pixels on. */
export const NEW_ART_PALETTE: readonly number[] = [
  0x3f2631, 0xeaa56c, 0x8b9bb4, 0xc0cbdc, 0x84c669, 0xbd6c4a, 0x763b36, 0x262b44, 0x52607c,
  0xc34b35, 0xcf8254, 0xfec99c, 0x5a6988, 0x4e974c, 0xfdbe53, 0xe38628, 0xb86542, 0x479f4a,
  0xf28462, 0xffffff, 0xf7c282, 0xfdd6b4, 0xaa2c23, 0x3d212d, 0xc6e58d, 0xe84537, 0xfcbc8f,
  0x773833, 0x65a556, 0x9b4ca3, 0x43e1b3, 0xe19a65, 0xd176d0, 0xdfa988, 0xff706d, 0xebeff8,
  0x99d8f8, 0x25956a, 0x79a7e8, 0x009adc, 0x69ffd4, 0x75e3ff, 0xe4edf9, 0x8bd87d, 0xba662a,
  0xfeae34, 0xffd896, 0xe94334, 0x3e4e6e, 0xfee761, 0xe2faff, 0xc47c71, 0xaab7cc, 0xf3cdac,
];

export interface TileConformance {
  readonly palette: readonly number[];
  readonly outlineColor: number;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function alphaAt(image: DecodedImage, x: number, y: number): number {
  return image.pixels[(y * image.width + x) * 4 + 3] ?? 0;
}

function colorAt(image: DecodedImage, x: number, y: number): number {
  const at = (y * image.width + x) * 4;
  const red = image.pixels[at] ?? 0;
  const green = image.pixels[at + 1] ?? 0;
  const blue = image.pixels[at + 2] ?? 0;
  return (red << 16) | (green << 8) | blue;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function forEachPixel(image: DecodedImage, visit: (x: number, y: number) => void): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) visit(x, y);
  }
}

/** Rule 1: dimensions are an exact multiple of 16. Zero is excluded — arithmetically a multiple, but
 *  an empty image is not a conforming tile. */
export function checkTileGrid(image: DecodedImage): readonly string[] {
  const sides = [
    ["width", image.width],
    ["height", image.height],
  ] as const;
  const violations: string[] = [];
  for (const [side, size] of sides) {
    if (size <= 0 || size % TILE_SIZE_PX !== 0) {
      violations.push(`${side} ${size} is not a positive multiple of ${TILE_SIZE_PX}`);
    }
  }
  return violations;
}

/** Rule 2: every alpha value is 0 or 255 — no anti-aliasing anywhere. */
export function checkBinaryAlpha(image: DecodedImage): readonly string[] {
  const violations: string[] = [];
  forEachPixel(image, (x, y) => {
    const alpha = alphaAt(image, x, y);
    if (alpha !== 0 && alpha !== 255) {
      violations.push(`alpha ${alpha} at (${x},${y}) is neither 0 nor 255`);
    }
  });
  return violations;
}

/** Rule 3: every opaque colour is in the declared palette. The colour beneath a transparent pixel is
 *  not checked: nothing renders it, and indexed PNGs routinely leave a palette entry under it. */
export function checkPalette(image: DecodedImage, palette: readonly number[]): readonly string[] {
  const declared = new Set(palette);
  const violations: string[] = [];
  forEachPixel(image, (x, y) => {
    if (alphaAt(image, x, y) !== 255) return;
    const color = colorAt(image, x, y);
    if (!declared.has(color)) {
      violations.push(`${hex(color)} at (${x},${y}) is not in the declared palette`);
    }
  });
  return violations;
}

function floodOutside(
  image: DecodedImage,
  outside: Uint8Array,
  queue: number[],
  x: number,
  y: number,
): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const cell = y * image.width + x;
  if (outside[cell] === 1 || alphaAt(image, x, y) !== 0) return;
  outside[cell] = 1;
  queue.push(cell);
}

/** Transparency reachable from the image border. Anything else transparent is an enclosed hole. */
function outsideMask(image: DecodedImage): Uint8Array {
  const { width, height } = image;
  const outside = new Uint8Array(width * height);
  const queue: number[] = [];
  for (let x = 0; x < width; x += 1) {
    floodOutside(image, outside, queue, x, 0);
    floodOutside(image, outside, queue, x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    floodOutside(image, outside, queue, 0, y);
    floodOutside(image, outside, queue, width - 1, y);
  }
  while (queue.length > 0) {
    const cell = queue.pop() ?? 0;
    const x = cell % width;
    const y = Math.floor(cell / width);
    for (const [dx, dy] of NEIGHBOURS) floodOutside(image, outside, queue, x + dx, y + dy);
  }
  return outside;
}

/** Whether the image has an outer silhouette at all. A full-bleed terrain tile has none, which is one
 *  of the two reasons rule 4 can pass a tile without inspecting a single boundary pixel. */
export function hasSilhouette(image: DecodedImage): boolean {
  return outsideMask(image).includes(1);
}

function touchesOutside(image: DecodedImage, outside: Uint8Array, x: number, y: number): boolean {
  return NEIGHBOURS.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) return false;
    return outside[ny * image.width + nx] === 1;
  });
}

function hasColor(image: DecodedImage, color: number): boolean {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (alphaAt(image, x, y) === 255 && colorAt(image, x, y) === color) return true;
    }
  }
  return false;
}

/** Rule 4: the outline colour, where an outline exists, is `#3f2631`.
 *
 *  Mechanical without knowing which pixels the artist meant as outline: flood transparency in from
 *  the image border, and the silhouette is every opaque pixel touching what that reaches. So an
 *  enclosed hole is not silhouette, and neither is the image border — a tile that bleeds off its own
 *  edge abuts the next tile in the sheet rather than empty space.
 *
 *  Two escapes come from the policy's own wording rather than from weakening it: a tile with no
 *  reachable transparency has no silhouette, and a tile containing no outline colour has no outline.
 *  The second is a real gap worth naming — this rule catches a wrong or an incomplete outline, and
 *  never a missing one. */
export function checkOutlineColor(image: DecodedImage, outlineColor: number): readonly string[] {
  const outside = outsideMask(image);
  if (!outside.includes(1)) return [];
  if (!hasColor(image, outlineColor)) return [];
  const violations: string[] = [];
  forEachPixel(image, (x, y) => {
    if (alphaAt(image, x, y) !== 255) return;
    if (!touchesOutside(image, outside, x, y)) return;
    const color = colorAt(image, x, y);
    if (color !== outlineColor) {
      violations.push(
        `${hex(color)} at (${x},${y}) is on the silhouette but is not the outline colour`,
      );
    }
  });
  return violations;
}

/** All four rules at once — the gate a new tile has to clear. */
export function checkTile(image: DecodedImage, rules: TileConformance): readonly string[] {
  return [
    ...checkTileGrid(image),
    ...checkBinaryAlpha(image),
    ...checkPalette(image, rules.palette),
    ...checkOutlineColor(image, rules.outlineColor),
  ];
}
