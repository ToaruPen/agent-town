import {
  WORLD_MAP_PLAYER_POLITY_ALPHA,
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
  type WorldMapMarks,
  worldMapPositionFromPointer,
} from "../src/ui/worldMapView.js";

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Every `WorldMapMarks` field is required, so every literal needs all three; this fills in "none of
 *  the above" for whichever ones a test does not care about. */
function marks(overrides: Partial<WorldMapMarks> = {}): WorldMapMarks {
  return { playerPolityId: null, hoveredPolityId: null, pulsePhase: null, ...overrides };
}

/** The banner a nation is assigned, which is now the fill colour as well as the border colour. */
function bannerFor(history: WorldHistory, polityId: string): string {
  const assignment = assignNationBanners(history.polities).find(
    ({ nationId }) => nationId === polityId,
  );
  if (assignment === undefined) throw new Error(`no banner for ${polityId}`);
  return hexColor(NATION_BANNER_RING[assignment.slot] ?? 0);
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
  it("formats Japanese terrain, polity colors, settlement, and hover highlights", () => {
    const history = historyFixture();
    const view = buildWorldMapViewModel(history, [], marks({ hoveredPolityId: "polity-1" }));

    expect(view.settlement).toEqual({
      pos: { x: 3, y: 2 },
      label: "現在地",
    });
    expect(view.cells.find(({ pos }) => pos.x === 1 && pos.y === 1)).toMatchObject({
      terrainLabel: "平地",
      polityColor: bannerFor(history, "polity-1"),
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

  it("uses normal alpha for unhovered overlays and no overlay for unclaimed cells", () => {
    const history = historyFixture();
    const view = buildWorldMapViewModel(history);

    expect(view.cells[1]).toMatchObject({
      polityColor: bannerFor(history, "polity-1"),
      polityAlpha: WORLD_MAP_POLITY_ALPHA,
    });
    expect(view.cells.at(-1)).toMatchObject({
      polityId: null,
      polityColor: null,
      polityAlpha: 0,
    });
  });

  /**
   * The wash was the last surface still painted in `Polity.color`. Those values are muted for large flat
   * areas and collide across worlds (visual.md §1.3), so territory *extent* was being carried by a colour
   * the identity channel had already abandoned — a nation's border and its own fill could disagree.
   */
  it("fills territory in the banner colour rather than the archival one", () => {
    const history = historyFixture();

    const view = buildWorldMapViewModel(history);

    const fills = new Set(view.cells.flatMap(({ polityColor }) => polityColor ?? []));
    expect(fills).toEqual(
      new Set([bannerFor(history, "polity-1"), bannerFor(history, "polity-2")]),
    );
    expect(fills).not.toContain("#6f7f88");
    expect(fills).not.toContain("#c49a4b");
  });

  /** Bullet 3: one nation carries the player step, at 0.32 against every rival's 0.28. */
  it("gives exactly one nation the player's fill alpha", () => {
    const history = historyFixture();

    const view = buildWorldMapViewModel(history, [], marks({ playerPolityId: "polity-2" }));

    const owned = view.cells.filter(({ polityId }) => polityId !== null);
    const player = owned.filter(({ polityId }) => polityId === "polity-2");
    const rivals = owned.filter(({ polityId }) => polityId !== "polity-2");
    expect(player.length).toBeGreaterThan(0);
    expect(rivals.length).toBeGreaterThan(0);
    expect(new Set(player.map(({ polityId }) => polityId))).toEqual(new Set(["polity-2"]));
    expect(new Set(player.map(({ polityAlpha }) => polityAlpha))).toEqual(
      new Set([WORLD_MAP_PLAYER_POLITY_ALPHA]),
    );
    expect(new Set(rivals.map(({ polityAlpha }) => polityAlpha))).toEqual(
      new Set([WORLD_MAP_POLITY_ALPHA]),
    );
  });

  /**
   * Spectating is a real state — the picker exists — and it must not decorate an arbitrary nation.
   *
   * The old form of this test filtered by `polityId !== null && polityId === playerPolityId` with
   * `playerPolityId` bound to `null`: that predicate is unsatisfiable by construction — if `polityId`
   * equalled `playerPolityId` (`null`), it could not also be non-null — so it passed for any fixture, any
   * implementation, even a deliberately broken one. This asserts every owned cell's alpha directly
   * instead, and `owned.length` guards against the fixture losing its territory and making it vacuous
   * again a different way. Cities and edges get the identical no-player-mark claim already, in their own
   * describe blocks below ("marks no city/edge as the player's when nobody holds one") — not repeated here.
   */
  it("marks no nation at all when the player holds none", () => {
    const view = buildWorldMapViewModel(historyFixture(), [], marks({ playerPolityId: null }));

    const owned = view.cells.filter(({ polityId }) => polityId !== null);
    expect(owned.length).toBeGreaterThan(0);
    expect(new Set(owned.map(({ polityAlpha }) => polityAlpha))).toEqual(
      new Set([WORLD_MAP_POLITY_ALPHA]),
    );
  });

  /**
   * The pulse's phase is a plain pass-through here — `buildWorldMapViewModel` makes no drawing decision
   * about it, it only carries the host's number down to the paint layer that does (visual.md §2.6).
   */
  it("carries the locate pulse's phase onto the view model unchanged", () => {
    const view = buildWorldMapViewModel(historyFixture(), [], marks({ pulsePhase: 0.4 }));

    expect(view.pulsePhase).toBe(0.4);
  });

  it("carries a null pulse phase onto the view model when no pulse is live", () => {
    const view = buildWorldMapViewModel(historyFixture(), [], marks({ pulsePhase: null }));

    expect(view.pulsePhase).toBeNull();
  });

  /**
   * Hovering a nation must still get the highlight answer even when it is the player's own. If the
   * player step won instead, the one nation whose cells the player most often points at would be the one
   * that never responded to a hover.
   */
  it("lets hovering a nation outrank the player's own step", () => {
    const view = buildWorldMapViewModel(
      historyFixture(),
      [],
      marks({ playerPolityId: "polity-2", hoveredPolityId: "polity-2" }),
    );

    const player = view.cells.filter(({ polityId }) => polityId === "polity-2");
    expect(player.length).toBeGreaterThan(0);
    expect(new Set(player.map(({ polityAlpha }) => polityAlpha))).toEqual(
      new Set([WORLD_MAP_SELECTED_POLITY_ALPHA]),
    );
  });

  it("omits trade routes whose city IDs cannot be resolved", () => {
    const history = historyFixture();
    const tradeRoute = history.worldMap.tradeRoutes[0];
    if (tradeRoute === undefined) throw new Error("missing trade route fixture");
    history.worldMap.tradeRoutes[0] = {
      ...tradeRoute,
      cityIds: ["city-polity-1-1", "city-missing"],
    };

    expect(buildWorldMapViewModel(history).tradeRoutes).toEqual([]);
  });

  it("gives each city its nation's banner colour, not the colliding archival one", () => {
    const history = historyFixture();
    const banners = assignNationBanners(history.polities);

    const view = buildWorldMapViewModel(history);

    expect(view.cities.map(({ bannerColor }) => bannerColor)).toEqual(
      banners.map(({ slot }) => hexColor(NATION_BANNER_RING[slot] ?? 0)),
    );
    expect(view.cities.map(({ bannerColor }) => bannerColor)).not.toContain("#6f7f88");
    expect(view.cities.map(({ bannerColor }) => bannerColor)).not.toContain("#c49a4b");
  });

  it("falls back to the plain city fill when a city's nation has no banner", () => {
    const history = historyFixture();
    const city = history.worldMap.cities[0];
    if (city === undefined) throw new Error("missing city fixture");
    history.worldMap.cities[0] = {
      ...city,
      polityId: "polity-vanished",
    };

    expect(buildWorldMapViewModel(history).cities[0]?.bannerColor).toBe(
      hexColor(MAP_CITY_FILL_COLOR),
    );
  });

  it("uses the exact Japanese label for every terrain kind", () => {
    const labels = new Map(
      buildWorldMapViewModel(historyFixture()).cells.map(({ terrain, terrainLabel }) => [
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
    const view = buildWorldMapViewModel(historyFixture());

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
    const view = buildWorldMapViewModel(historyFixture());

    // (1,0) and (2,0) are both polity-1, so the side they share is interior.
    expect(
      view.territoryEdges.filter(({ pos, side }) => pos.x === 1 && pos.y === 0 && side === "right"),
    ).toEqual([]);
  });

  it("gives every edge a banner colour to paint it with", () => {
    const view = buildWorldMapViewModel(historyFixture());
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

  /**
   * The inner rule (visual.md §2.6) needs to know which edges are the player's own, independent of
   * `hasCasing` — it draws at a nation-nation frontier too, where there is never any casing.
   */
  it("marks a player's own edges and no rival's, regardless of casing", () => {
    const view = buildWorldMapViewModel(
      historyFixture(),
      [],
      marks({ playerPolityId: "polity-1" }),
    );

    const owned = view.territoryEdges.filter(({ isPlayer }) => isPlayer);
    const rivals = view.territoryEdges.filter(({ isPlayer }) => !isPlayer);
    expect(owned.length).toBeGreaterThan(0);
    expect(rivals.length).toBeGreaterThan(0);
    expect(owned.every(({ polityId }) => polityId === "polity-1")).toBe(true);
    expect(rivals.every(({ polityId }) => polityId !== "polity-1")).toBe(true);
  });

  it("marks no edge as the player's when nobody holds one", () => {
    const view = buildWorldMapViewModel(historyFixture());

    expect(view.territoryEdges.some(({ isPlayer }) => isPlayer)).toBe(false);
  });
});

describe("world map city tiers", () => {
  it("sizes a city from the population its nation reports for it", () => {
    const view = buildWorldMapViewModel(historyFixture(), [
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
    const held = buildWorldMapViewModel(historyFixture(), [
      { cityId: "city-polity-1-1", population: 6000, developmentLevel: 3 },
      { cityId: "city-polity-2-1", population: 9000, developmentLevel: 5 },
    ]);
    const collapsed = buildWorldMapViewModel(historyFixture(), [
      { cityId: "city-polity-1-1", population: 6000, developmentLevel: 3 },
      { cityId: "city-polity-2-1", population: 0, developmentLevel: 0 },
    ]);

    const before = held.cities.find(({ id }) => id === "city-polity-1-1")?.glyph;
    const after = collapsed.cities.find(({ id }) => id === "city-polity-1-1")?.glyph;
    expect(after).toEqual(before);
  });

  /** What the chronicle renders today: it has no nation state until the map gets a live host. */
  it("falls back to the smallest tier when it is given no nation state at all", () => {
    const view = buildWorldMapViewModel(historyFixture());

    expect(view.cities.map(({ glyph }) => glyph.tier)).toEqual([1, 1]);
  });

  it("keeps capitals as diamonds whether or not their population is known", () => {
    const known = buildWorldMapViewModel(historyFixture(), [
      { cityId: "city-polity-1-1", population: 9000, developmentLevel: 4 },
    ]);

    expect(known.cities.map(({ glyph }) => glyph.shape)).toEqual(["diamond", "diamond"]);
  });

  /** The cross-hatch's input (visual.md §2.6): only the player's own cities carry it. */
  it("marks a city as the player's own and no one else's", () => {
    const view = buildWorldMapViewModel(
      historyFixture(),
      [],
      marks({ playerPolityId: "polity-1" }),
    );

    expect(view.cities.find(({ id }) => id === "city-polity-1-1")?.isPlayer).toBe(true);
    expect(view.cities.find(({ id }) => id === "city-polity-2-1")?.isPlayer).toBe(false);
  });

  it("marks no city as the player's when nobody holds one", () => {
    const view = buildWorldMapViewModel(historyFixture());

    expect(view.cities.some(({ isPlayer }) => isPlayer)).toBe(false);
  });
});

describe("world map selection", () => {
  it("returns an owned polity and clears selection on sea or unclaimed land", () => {
    const view = buildWorldMapViewModel(historyFixture());

    expect(polityIdAtWorldMapPosition(view, { x: 1, y: 1 })).toBe("polity-1");
    expect(polityIdAtWorldMapPosition(view, { x: 0, y: 0 })).toBeNull();
    expect(polityIdAtWorldMapPosition(view, { x: 3, y: 2 })).toBeNull();
  });

  it("maps CSS-scaled pointer coordinates and rejects points outside the bounds", () => {
    const view = buildWorldMapViewModel(historyFixture());
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
