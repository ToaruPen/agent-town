import {
  WORLD_MAP_POLITY_ALPHA,
  WORLD_MAP_SELECTED_POLITY_ALPHA,
  type WorldHistory,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { MAP_CITY_FILL_COLOR, NATION_BANNER_RING } from "../src/render/colors.js";
import { assignNationBanners } from "../src/render/nationBanner.js";
import {
  buildWorldMapViewModel,
  polityIdAtWorldMapPosition,
  worldMapPositionFromPointer,
} from "../src/ui/worldMapView.js";

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function historyFixture(): WorldHistory {
  return {
    startYear: -200,
    currentYear: 0,
    polities: [
      {
        id: "polity-1",
        name: "黒貂辺境国",
        adjective: "黒貂",
        color: 0x6f7f88,
        values: [],
        foundingMyth: "冬の火を分かち合った。",
        formativeTraumaEventIds: [],
        taboo: "隣人を見捨てること。",
        ambition: "西の峠を守る。",
        governance: "守人たちの合議。",
      },
      {
        id: "polity-2",
        name: "金環盟約国",
        adjective: "金環",
        color: 0xc49a4b,
        values: [],
        foundingMyth: "七つの市が盟約を結んだ。",
        formativeTraumaEventIds: [],
        taboo: "契約を破ること。",
        ambition: "東の街道を開く。",
        governance: "組合の輪番制。",
      },
    ],
    events: [
      {
        id: "event-founding-1",
        year: -200,
        kind: "founding",
        title: "黒貂建国",
        summary: "黒貂辺境国が建った。",
        polityIds: ["polity-1"],
        causeIds: [],
        effects: [],
      },
      {
        id: "event-founding-2",
        year: -190,
        kind: "founding",
        title: "金環建国",
        summary: "金環盟約国が建った。",
        polityIds: ["polity-2"],
        causeIds: [],
        effects: [],
      },
      {
        id: "event-trade",
        year: -40,
        kind: "trade",
        title: "東西交易",
        summary: "街道が開かれた。",
        polityIds: ["polity-1", "polity-2"],
        causeIds: [],
        effects: [],
      },
      {
        id: "event-war",
        year: -20,
        kind: "war",
        title: "境界戦争",
        summary: "平地の境界が動いた。",
        polityIds: ["polity-1", "polity-2"],
        causeIds: [],
        effects: [],
      },
    ],
    landmarks: [],
    settlementOrigin: {
      homelandPolityId: "polity-1",
      departureEventId: "event-war",
      reason: "新しい土地を探すため。",
      inheritedValues: [],
    },
    worldMap: {
      width: 4,
      height: 3,
      cells: [
        { terrain: "sea", polityId: null },
        { terrain: "plains", polityId: "polity-1" },
        { terrain: "forest", polityId: "polity-1" },
        { terrain: "hills", polityId: null },
        { terrain: "mountains", polityId: null },
        { terrain: "plains", polityId: "polity-1" },
        { terrain: "forest", polityId: "polity-2" },
        { terrain: "sea", polityId: null },
        { terrain: "hills", polityId: "polity-1" },
        { terrain: "mountains", polityId: "polity-2" },
        { terrain: "plains", polityId: "polity-2" },
        { terrain: "plains", polityId: null },
      ],
      cities: [
        {
          id: "city-polity-1-1",
          name: "黒貂府",
          pos: { x: 1, y: 1 },
          polityId: "polity-1",
          isCapital: true,
          foundedByEventId: "event-founding-1",
        },
        {
          id: "city-polity-2-1",
          name: "金環府",
          pos: { x: 2, y: 1 },
          polityId: "polity-2",
          isCapital: true,
          foundedByEventId: "event-founding-2",
        },
      ],
      tradeRoutes: [
        {
          id: "route-event-trade",
          cityIds: ["city-polity-1-1", "city-polity-2-1"],
          establishedByEventId: "event-trade",
        },
      ],
      borderChanges: [
        {
          id: "border-event-war-1",
          pos: { x: 2, y: 1 },
          formerPolityId: "polity-1",
          currentPolityId: "polity-2",
          establishedByEventId: "event-war",
        },
      ],
      settlementFrontierPos: { x: 3, y: 2 },
    },
  };
}

describe("buildWorldMapViewModel", () => {
  it("formats Japanese terrain, polity colors, settlement, and selection highlights", () => {
    const view = buildWorldMapViewModel(historyFixture(), "polity-1");

    expect(view.settlement).toEqual({
      pos: { x: 3, y: 2 },
      label: "現在地",
    });
    expect(view.cells.find(({ pos }) => pos.x === 1 && pos.y === 1)).toMatchObject({
      terrainLabel: "平地",
      polityColor: "#6f7f88",
      polityAlpha: WORLD_MAP_SELECTED_POLITY_ALPHA,
    });
    expect(view.cities).toEqual([
      expect.objectContaining({
        name: "黒貂府",
        isCapital: true,
        isHighlighted: true,
      }),
      expect.objectContaining({
        name: "金環府",
        isCapital: true,
        isHighlighted: false,
      }),
    ]);
    expect(view.tradeRoutes[0]?.isHighlighted).toBe(true);
  });

  it("uses normal alpha for unselected overlays and no overlay for unclaimed cells", () => {
    const view = buildWorldMapViewModel(historyFixture(), null);

    expect(view.cells[1]).toMatchObject({
      polityColor: "#6f7f88",
      polityAlpha: WORLD_MAP_POLITY_ALPHA,
    });
    expect(view.cells.at(-1)).toMatchObject({
      polityId: null,
      polityColor: null,
      polityAlpha: 0,
    });
  });

  it("omits trade routes whose city IDs cannot be resolved", () => {
    const history = historyFixture();
    history.worldMap.tradeRoutes[0] = {
      ...history.worldMap.tradeRoutes[0],
      cityIds: ["city-polity-1-1", "city-missing"],
    };

    expect(buildWorldMapViewModel(history, "polity-1").tradeRoutes).toEqual([]);
  });

  it("gives each city its nation's banner colour, not the colliding archival one", () => {
    const history = historyFixture();
    const banners = assignNationBanners(history.polities);

    const view = buildWorldMapViewModel(history, null);

    expect(view.cities.map(({ bannerColor }) => bannerColor)).toEqual(
      banners.map(({ slot }) => hexColor(NATION_BANNER_RING[slot] ?? 0)),
    );
    expect(view.cities.map(({ bannerColor }) => bannerColor)).not.toContain("#6f7f88");
    expect(view.cities.map(({ bannerColor }) => bannerColor)).not.toContain("#c49a4b");
  });

  it("falls back to the plain city fill when a city's nation has no banner", () => {
    const history = historyFixture();
    history.worldMap.cities[0] = {
      ...history.worldMap.cities[0],
      polityId: "polity-vanished",
    };

    expect(buildWorldMapViewModel(history, null).cities[0]?.bannerColor).toBe(
      hexColor(MAP_CITY_FILL_COLOR),
    );
  });

  it("uses the exact Japanese label for every terrain kind", () => {
    const labels = new Map(
      buildWorldMapViewModel(historyFixture(), null).cells.map(({ terrain, terrainLabel }) => [
        terrain,
        terrainLabel,
      ]),
    );

    expect(Object.fromEntries(labels)).toEqual({
      sea: "海",
      plains: "平地",
      forest: "森",
      hills: "丘陵",
      mountains: "山地",
    });
  });
});

describe("world map territory outline", () => {
  it("outlines the rim against off-map and leaves the frontier between two nations uncased", () => {
    const view = buildWorldMapViewModel(historyFixture(), null);

    const rim = view.territoryEdges.find(
      ({ pos, side }) => pos.x === 1 && pos.y === 0 && side === "top",
    );
    expect(rim).toMatchObject({ polityId: "polity-1", hasCasing: true });

    const frontier = view.territoryEdges.filter(
      ({ pos, side }) => pos.x === 2 && pos.y === 1 && side === "left",
    );
    expect(frontier).toMatchObject([{ polityId: "polity-2", hasCasing: false }]);
  });

  it("draws no edge between two cells the same nation holds", () => {
    const view = buildWorldMapViewModel(historyFixture(), null);

    // (1,0) and (2,0) are both polity-1, so the side they share is interior.
    expect(
      view.territoryEdges.filter(({ pos, side }) => pos.x === 1 && pos.y === 0 && side === "right"),
    ).toEqual([]);
  });

  it("gives every edge a banner colour to paint it with", () => {
    const view = buildWorldMapViewModel(historyFixture(), null);
    const banners = new Map(
      assignNationBanners(historyFixture().polities).map(
        ({ nationId, color }) => [nationId, hexColor(color)] as const,
      ),
    );

    expect(view.territoryEdges.length).toBeGreaterThan(0);
    for (const edge of view.territoryEdges) {
      expect(edge.bannerColor).toBe(banners.get(edge.polityId));
    }
  });
});

describe("world map city tiers", () => {
  it("sizes a city from the population its nation reports for it", () => {
    const view = buildWorldMapViewModel(historyFixture(), null, [
      { cityId: "city-polity-1-1", population: 9000, developmentLevel: 4 },
      { cityId: "city-polity-2-1", population: 100, developmentLevel: 1 },
    ]);

    const capital = view.cities.find(({ id }) => id === "city-polity-1-1");
    const small = view.cities.find(({ id }) => id === "city-polity-2-1");
    expect(capital?.glyph.tier).toBe(4);
    expect(small?.glyph.tier).toBe(1);
    expect(capital?.glyph.radiusPx).toBeGreaterThan(small?.glyph.radiusPx ?? 0);
  });

  /** A rival's collapse must not resize anyone else's city — the thresholds are absolute. */
  it("leaves one nation's tier alone when the other empties out", () => {
    const held = buildWorldMapViewModel(historyFixture(), null, [
      { cityId: "city-polity-1-1", population: 6000, developmentLevel: 3 },
      { cityId: "city-polity-2-1", population: 9000, developmentLevel: 5 },
    ]);
    const collapsed = buildWorldMapViewModel(historyFixture(), null, [
      { cityId: "city-polity-1-1", population: 6000, developmentLevel: 3 },
      { cityId: "city-polity-2-1", population: 0, developmentLevel: 0 },
    ]);

    const before = held.cities.find(({ id }) => id === "city-polity-1-1")?.glyph;
    const after = collapsed.cities.find(({ id }) => id === "city-polity-1-1")?.glyph;
    expect(after).toEqual(before);
  });

  /** What the chronicle renders today: it has no nation state until the map gets a live host. */
  it("falls back to the smallest tier when it is given no nation state at all", () => {
    const view = buildWorldMapViewModel(historyFixture(), null);

    expect(view.cities.map(({ glyph }) => glyph.tier)).toEqual([1, 1]);
  });

  it("keeps capitals as diamonds whether or not their population is known", () => {
    const known = buildWorldMapViewModel(historyFixture(), null, [
      { cityId: "city-polity-1-1", population: 9000, developmentLevel: 4 },
    ]);

    expect(known.cities.map(({ glyph }) => glyph.shape)).toEqual(["diamond", "diamond"]);
  });
});

describe("world map selection", () => {
  it("returns an owned polity and clears selection on sea or unclaimed land", () => {
    const view = buildWorldMapViewModel(historyFixture(), null);

    expect(polityIdAtWorldMapPosition(view, { x: 1, y: 1 })).toBe("polity-1");
    expect(polityIdAtWorldMapPosition(view, { x: 0, y: 0 })).toBeNull();
    expect(polityIdAtWorldMapPosition(view, { x: 3, y: 2 })).toBeNull();
  });

  it("maps CSS-scaled pointer coordinates and rejects points outside the bounds", () => {
    const view = buildWorldMapViewModel(historyFixture(), null);
    const bounds = { left: 10, top: 20, width: 400, height: 300 };

    expect(worldMapPositionFromPointer(view, bounds, 10, 20)).toEqual({ x: 0, y: 0 });
    expect(worldMapPositionFromPointer(view, bounds, 409.999, 319.999)).toEqual({
      x: 3,
      y: 2,
    });
    expect(worldMapPositionFromPointer(view, bounds, 9.999, 20)).toBeNull();
    expect(worldMapPositionFromPointer(view, bounds, 410, 320)).toBeNull();
  });
});
