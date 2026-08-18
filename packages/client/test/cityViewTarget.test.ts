import type { WorldCity, WorldHistory } from "@agent-town/shared";
import { describe, expect, it } from "vitest";
import { resolvePlayerCityViewTarget } from "../src/local/cityViewTarget.js";
import { assignNationBanners } from "../src/render/nationBanner.js";
import { hexColor } from "../src/ui/worldMapView.js";
import { historyFixture, nationFixture, polityFixture } from "./nationFixture.js";

const CAPITAL_ID = "city-polity-1-1";

function capitalCity(overrides: Partial<WorldCity> = {}): WorldCity {
  return {
    id: CAPITAL_ID,
    name: "首府",
    pos: { x: 0, y: 0 },
    polityId: "polity-1",
    isCapital: true,
    foundedByEventId: "event-founding",
    ...overrides,
  };
}

function historyWithCapital(overrides: Partial<WorldCity> = {}): WorldHistory {
  const history = historyFixture([polityFixture({ color: 0xd7864b })]);
  return {
    ...history,
    worldMap: { ...history.worldMap, cities: [capitalCity(overrides)] },
  };
}

describe("resolvePlayerCityViewTarget", () => {
  it("returns null while no nation is held", () => {
    expect(
      resolvePlayerCityViewTarget(historyWithCapital(), [nationFixture()], null, 0),
    ).toBeNull();
  });

  it("returns null when the held nation's polity is absent from history", () => {
    const history = historyFixture([]);
    expect(
      resolvePlayerCityViewTarget(
        { ...history, worldMap: { ...history.worldMap, cities: [capitalCity()] } },
        [nationFixture()],
        "polity-1",
        0,
      ),
    ).toBeNull();
  });

  it("returns null when the held nation carries no live NationState", () => {
    expect(resolvePlayerCityViewTarget(historyWithCapital(), [], "polity-1", 0)).toBeNull();
  });

  it("returns null when the nation's own polity has no capital on the world map", () => {
    const history = historyWithCapital({ isCapital: false });
    expect(resolvePlayerCityViewTarget(history, [nationFixture()], "polity-1", 0)).toBeNull();
  });

  it("returns null when the capital's population/development has not arrived yet", () => {
    const nation = nationFixture({ cities: [] });
    expect(resolvePlayerCityViewTarget(historyWithCapital(), [nation], "polity-1", 0)).toBeNull();
  });

  it("targets the player's capital, with the derived banner colour rather than Polity.color", () => {
    const history = historyWithCapital();
    const nation = nationFixture();
    const tick = 12_345;

    const target = resolvePlayerCityViewTarget(history, [nation], "polity-1", tick);

    const expectedBanner = assignNationBanners(history.polities).find(
      ({ nationId }) => nationId === "polity-1",
    );
    if (expectedBanner === undefined) throw new Error("no banner assigned in fixture");

    expect(target).not.toBeNull();
    expect(target?.scene).toEqual({
      city: capitalCity(),
      cityState: nation.cities[0],
      nation,
      polity: history.polities[0],
      worldMap: history.worldMap,
      tick,
    });
    expect(target?.bannerColor).toBe(hexColor(expectedBanner.color));
    // Pinned negative: the archival colour is what the design explicitly rejects as a chrome source.
    expect(target?.bannerColor).not.toBe(hexColor(0xd7864b));
  });
});
