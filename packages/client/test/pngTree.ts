/** The file-reading half of the asset conformance gate: find PNGs, decode them to RGBA, and hand
 *  `assetConformance.ts` plain pixel data.
 *
 *  This is test-only code and must stay that way. `node:zlib` cannot run in a browser, so nothing
 *  under `src/` may import this module — a test in `assetConformance.test.ts` checks that rather than
 *  trusting it. The decoder deliberately supports only the PNG variants the tree actually contains
 *  (indexed at 1/2/4/8 bits and RGBA8); anything else throws, and a test asserts nothing throws. */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import type { DecodedImage } from "./assetConformance.js";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));

/** The three vendored Kenney packs, a closed set of 396 files with their own CC0 licences. */
export const VENDORED_ASSET_ROOT = join(TEST_ROOT, "..", "public", "assets");

/** Where new art lands, kept outside `public/assets/` so the vendored packs stay a closed set with
 *  their own provenance. Empty today: asset-policy.md is policy for when a real need appears. */
export const NEW_ART_ROOT = join(TEST_ROOT, "..", "public", "art");

export const CLIENT_SRC_ROOT = join(TEST_ROOT, "..", "src");

/** Indexed and RGBA8 — the only two colour types in the tree, so the only two worth supporting. */
export const SUPPORTED_PNG_COLOR_TYPES = { indexed: 3, rgba8: 6 } as const;

export interface DecodedPng extends DecodedImage {
  readonly colorType: number;
  readonly bitDepth: number;
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function assertSignature(bytes: Uint8Array): void {
  for (let at = 0; at < PNG_SIGNATURE.length; at += 1) {
    if (bytes[at] !== PNG_SIGNATURE[at]) throw new Error("not a PNG file");
  }
}

function assertVariant(colorType: number, bitDepth: number): void {
  const supported =
    (colorType === SUPPORTED_PNG_COLOR_TYPES.indexed && [1, 2, 4, 8].includes(bitDepth)) ||
    (colorType === SUPPORTED_PNG_COLOR_TYPES.rgba8 && bitDepth === 8);
  if (!supported) {
    throw new Error(`unsupported PNG variant: colour type ${colorType} at bit depth ${bitDepth}`);
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

interface PngChunks {
  readonly palette: Uint8Array | null;
  /** tRNS: one alpha byte per palette entry, absent when every entry is opaque. */
  readonly alphas: Uint8Array | null;
  readonly data: Uint8Array;
}

function readChunks(bytes: Uint8Array, view: DataView): PngChunks {
  let palette: Uint8Array | null = null;
  let alphas: Uint8Array | null = null;
  const parts: Uint8Array[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (kind === "PLTE") palette = body;
    else if (kind === "tRNS") alphas = body;
    else if (kind === "IDAT") parts.push(body);
    else if (kind === "IEND") break;
    at += 12 + length;
  }
  return { palette, alphas, data: concat(parts) };
}

function paeth(a: number, b: number, c: number): number {
  const guess = a + b - c;
  const fromA = Math.abs(guess - a);
  const fromB = Math.abs(guess - b);
  const fromC = Math.abs(guess - c);
  if (fromA <= fromB && fromA <= fromC) return a;
  return fromB <= fromC ? b : c;
}

function predictor(filter: number, a: number, b: number, c: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    case 4:
      return paeth(a, b, c);
    default:
      throw new Error(`unsupported PNG scanline filter ${filter}`);
  }
}

/** Bytes before the start of a scanline read as zero, which is what the filters expect. */
function byteAt(bytes: Uint8Array, index: number): number {
  return index >= 0 ? (bytes[index] ?? 0) : 0;
}

/** `unit` is the byte distance to the pixel on the left, which is 1 below 8 bits per pixel. */
function unfilterLine(line: Uint8Array, previous: Uint8Array, filter: number, unit: number): void {
  for (let index = 0; index < line.length; index += 1) {
    const left = byteAt(line, index - unit);
    const above = byteAt(previous, index);
    const aboveLeft = byteAt(previous, index - unit);
    line[index] = (byteAt(line, index) + predictor(filter, left, above, aboveLeft)) & 0xff;
  }
}

/** Reverses the per-scanline filters, one raw row of bytes out per image row. */
function unfilter(
  raw: Uint8Array,
  rows: number,
  bytesPerRow: number,
  unit: number,
): readonly Uint8Array[] {
  const lines: Uint8Array[] = [];
  let previous = new Uint8Array(bytesPerRow);
  let at = 0;
  for (let row = 0; row < rows; row += 1) {
    const line = Uint8Array.from(raw.subarray(at + 1, at + 1 + bytesPerRow));
    unfilterLine(line, previous, byteAt(raw, at), unit);
    at += 1 + bytesPerRow;
    lines.push(line);
    previous = line;
  }
  return lines;
}

function expandRgba8(lines: readonly Uint8Array[], width: number, pixels: Uint8Array): void {
  for (let y = 0; y < lines.length; y += 1) {
    const line = lines[y];
    for (let x = 0; x < width * 4; x += 1) {
      pixels[y * width * 4 + x] = line?.[x] ?? 0;
    }
  }
}

function expandIndexed(
  lines: readonly Uint8Array[],
  width: number,
  bitDepth: number,
  chunks: PngChunks,
  pixels: Uint8Array,
): void {
  const palette = chunks.palette ?? new Uint8Array(0);
  const perByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  for (let y = 0; y < lines.length; y += 1) {
    const line = lines[y];
    for (let x = 0; x < width; x += 1) {
      const byte = line?.[Math.floor(x / perByte)] ?? 0;
      const index = (byte >> (8 - bitDepth * ((x % perByte) + 1))) & mask;
      const at = (y * width + x) * 4;
      pixels[at] = palette[index * 3] ?? 0;
      pixels[at + 1] = palette[index * 3 + 1] ?? 0;
      pixels[at + 2] = palette[index * 3 + 2] ?? 0;
      pixels[at + 3] = chunks.alphas?.[index] ?? 255;
    }
  }
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  assertSignature(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = bytes[24] ?? 0;
  const colorType = bytes[25] ?? 0;
  assertVariant(colorType, bitDepth);
  if ((bytes[28] ?? 0) !== 0) throw new Error("interlaced PNG is not supported");
  const chunks = readChunks(bytes, view);
  const isRgba8 = colorType === SUPPORTED_PNG_COLOR_TYPES.rgba8;
  const bitsPerPixel = isRgba8 ? 32 : bitDepth;
  const bytesPerRow = Math.ceil((width * bitsPerPixel) / 8);
  const unit = Math.max(1, bitsPerPixel >> 3);
  const lines = unfilter(inflateSync(chunks.data), height, bytesPerRow, unit);
  const pixels = new Uint8Array(width * height * 4);
  if (isRgba8) expandRgba8(lines, width, pixels);
  else expandIndexed(lines, width, bitDepth, chunks, pixels);
  return { width, height, pixels, colorType, bitDepth };
}

export function readPng(file: string): DecodedPng {
  return decodePng(readFileSync(file));
}

export function readSource(file: string): string {
  return readFileSync(file, "utf8");
}

/** Every file below `root` with the given extension, sorted. A missing `root` yields none, which is
 *  why a caller that must not pass vacuously has to assert the count it expects. */
export function listFiles(root: string, extension: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(extension)) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

export function listPngFiles(root: string): string[] {
  return listFiles(root, ".png");
}
