import type { WorldMap } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import {
  extractTerritoryEdges,
  type TerritoryEdge,
  type TerritorySide,
} from "../src/ui/worldTerritoryViewModel.js";

type TerritoryMap = Pick<WorldMap, "width" | "height" | "cells">;

/**
 * `~` sea, `.` unowned land, a letter is land owned by `polity-<letter>`. One character per cell, so
 * the shape under test is legible in the test rather than assembled by index arithmetic.
 */
function cellFor(glyph: string): WorldMap["cells"][number] {
  if (glyph === "~") return { terrain: "sea", polityId: null };
  if (glyph === ".") return { terrain: "plains", polityId: null };
  return { terrain: "plains", polityId: `polity-${glyph}` };
}

function grid(rows: readonly string[]): TerritoryMap {
  return {
    width: rows[0]?.length ?? 0,
    height: rows.length,
    cells: rows.flatMap((row) => [...row].map(cellFor)),
  };
}

function sidesAt(edges: readonly TerritoryEdge[], x: number, y: number): TerritorySide[] {
  return edges.filter(({ pos }) => pos.x === x && pos.y === y).map(({ side }) => side);
}

const ALL_SIDES: readonly TerritorySide[] = ["top", "right", "bottom", "left"];

describe("extractTerritoryEdges", () => {
  it("gives a single-cell nation an edge on all four sides", () => {
    const edges = extractTerritoryEdges(
      grid([
        // biome-ignore format: one character per cell keeps the shape readable
        "...",
        ".A.",
        "...",
      ]),
    );

    expect(edges).toHaveLength(4);
    expect(sidesAt(edges, 1, 1).toSorted()).toEqual([...ALL_SIDES].toSorted());
  });

  /** Off-map has to count as a different owner, or a nation on the rim loses its outline. */
  it("treats off-map as a different owner, so a corner nation is still fully outlined", () => {
    const edges = extractTerritoryEdges(grid(["A.", ".."]));

    expect(sidesAt(edges, 0, 0).toSorted()).toEqual([...ALL_SIDES].toSorted());
  });

  it("emits no interior edges inside a block of one nation", () => {
    const edges = extractTerritoryEdges(
      grid([
        // biome-ignore format: one character per cell keeps the shape readable
        "....",
        ".AA.",
        ".AA.",
        "....",
      ]),
    );

    // Eight sides face outward; the four sides where the block meets itself are not drawn.
    expect(edges).toHaveLength(8);
    expect(sidesAt(edges, 1, 1).toSorted()).toEqual(["left", "top"]);
    expect(sidesAt(edges, 2, 1).toSorted()).toEqual(["right", "top"]);
    expect(sidesAt(edges, 1, 2).toSorted()).toEqual(["bottom", "left"]);
    expect(sidesAt(edges, 2, 2).toSorted()).toEqual(["bottom", "right"]);
  });

  it("cases an edge against sea and against unowned land", () => {
    const edges = extractTerritoryEdges(grid(["~A."]));

    const cased = edges.filter(({ hasCasing }) => hasCasing).map(({ side }) => side);
    expect(cased.toSorted()).toEqual([...ALL_SIDES].toSorted());
  });

  /**
   * The shape a coastal frontier cell actually has: cased where it meets the sea and the rim, bare
   * where it meets the neighbour. Deciding casing per cell rather than per side would pass every
   * other test here and fail this one.
   */
  it("cases only the sides of one cell that face nobody, not the whole cell", () => {
    const edges = extractTerritoryEdges(grid(["~AB"]));

    const coastal = edges.filter(({ pos }) => pos.x === 1);
    const sidesWhere = (cased: boolean): TerritorySide[] =>
      coastal
        .filter(({ hasCasing }) => hasCasing === cased)
        .map(({ side }) => side)
        .toSorted();

    expect(sidesWhere(true)).toEqual(["bottom", "left", "top"]);
    expect(sidesWhere(false)).toEqual(["right"]);
  });

  /**
   * At a 6 px cell, casing both sides of a shared frontier puts 4 px of dark across it and leaves no
   * terrain visible in either cell. That alone decides it. Two banners are also far enough apart that
   * the seam separates nothing — C1-1b measured a 40.86 worst-case floor across every colour set the
   * generator can draw — but that is a measurement of today's palette, not a property to rely on: a
   * ninth template or a populated override table would lower it, and this rule would still hold.
   */
  it("leaves a nation-nation frontier uncased while still drawing both borders", () => {
    const edges = extractTerritoryEdges(grid(["AB"]));

    const frontier = edges.filter(
      ({ pos, side }) => (pos.x === 0 && side === "right") || (pos.x === 1 && side === "left"),
    );
    expect(frontier).toHaveLength(2);
    expect(frontier.map(({ hasCasing }) => hasCasing)).toEqual([false, false]);
    expect(frontier.map(({ polityId }) => polityId).toSorted()).toEqual(["polity-A", "polity-B"]);
  });

  it("keeps every edge attributed to the nation whose cell it belongs to", () => {
    const edges = extractTerritoryEdges(grid(["AB"]));

    for (const edge of edges) {
      expect(edge.polityId).toBe(edge.pos.x === 0 ? "polity-A" : "polity-B");
    }
  });

  /** `polityIdAtWorldMapPosition` already reads sea as unowned; edge extraction must agree with it. */
  it("reads a sea cell as unowned even if it carries a polity id", () => {
    const map = grid(["A~"]);
    const seaCell = map.cells[1];
    if (seaCell === undefined) throw new Error("fixture needs two cells");
    seaCell.polityId = "polity-A";

    const edges = extractTerritoryEdges(map);

    expect(edges.every(({ pos }) => pos.x === 0)).toBe(true);
    expect(sidesAt(edges, 0, 0).toSorted()).toEqual([...ALL_SIDES].toSorted());
    const coast = edges.find(({ side }) => side === "right");
    expect(coast?.hasCasing).toBe(true);
  });

  it("emits nothing for a map with no owned land", () => {
    expect(extractTerritoryEdges(grid(["~.~", ".~."]))).toEqual([]);
  });
});
