import {
  NATION_PROSPERITY_CULTURE_WEIGHT,
  NATION_PROSPERITY_POPULATION_WEIGHT,
  NATION_PROSPERITY_PRODUCTION_WEIGHT,
  NATION_PROSPERITY_SCORE_MAX,
  NATION_PROSPERITY_STABILITY_WEIGHT,
  NATION_PROSPERITY_WEALTH_WEIGHT,
} from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { buildProsperityRankingViewModel } from "../src/ui/prosperityViewModel.js";
import { historyFixture, nationFixture, polityFixture } from "./nationFixture.js";

const RIVAL = polityFixture({ id: "polity-2", name: "サルカ王国", color: 0x6f9f91 });
const THIRD = polityFixture({ id: "polity-3", name: "リガル自治領", color: 0x8878a6 });

function scored(id: string, total: number) {
  return nationFixture({ id, prosperity: { ...nationFixture().prosperity, total } });
}

describe("buildProsperityRankingViewModel", () => {
  it("ranks nations by prosperity total, highest first", () => {
    const view = buildProsperityRankingViewModel(
      [scored("polity-1", 527.6), scored("polity-2", 736.8), scored("polity-3", 601.2)],
      historyFixture([polityFixture(), RIVAL, THIRD]),
      "polity-1",
    );

    expect(view.rows.map(({ nationId }) => nationId)).toEqual(["polity-2", "polity-3", "polity-1"]);
    expect(view.rows.map(({ rank }) => rank)).toEqual([1, 2, 3]);
  });

  it("names each nation from its polity and marks the player's own row", () => {
    const view = buildProsperityRankingViewModel(
      [scored("polity-1", 527.6), scored("polity-2", 736.8)],
      historyFixture([polityFixture(), RIVAL]),
      "polity-1",
    );

    expect(view.rows.map(({ name }) => name)).toEqual(["サルカ王国", "ヴェルディン侯国"]);
    expect(view.rows.map(({ isPlayer }) => isPlayer)).toEqual([false, true]);
  });

  it("orders deterministically when two nations are exactly level", () => {
    const history = historyFixture([polityFixture(), RIVAL]);
    const forward = buildProsperityRankingViewModel(
      [scored("polity-1", 500), scored("polity-2", 500)],
      history,
      null,
    );
    const reversed = buildProsperityRankingViewModel(
      [scored("polity-2", 500), scored("polity-1", 500)],
      history,
      null,
    );

    expect(forward.rows.map(({ nationId }) => nationId)).toEqual(
      reversed.rows.map(({ nationId }) => nationId),
    );
  });

  it("gives each row the banner colour rather than the archival polity colour", () => {
    const view = buildProsperityRankingViewModel(
      [scored("polity-1", 527.6)],
      historyFixture([polityFixture()]),
      "polity-1",
    );

    // The archival colour is 0xd7864b; the banner ring reassigns it, so the swatch must not be that.
    expect(view.rows[0]?.swatchColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(view.rows[0]?.swatchColor).not.toBe("#d7864b");
  });

  /**
   * The measured live payload: components arrive as normalised 0..1 ratios and the client renders each
   * one's contribution as `weight × component × 1000`, importing the weights rather than reconstructing
   * the normalisation.
   */
  it("renders each component's contribution from the shared weight", () => {
    const view = buildProsperityRankingViewModel([nationFixture()], historyFixture(), "polity-1");
    const contributions = new Map(
      view.ownBreakdown.map(({ component, contribution }) => [component, contribution]),
    );

    expect(contributions.get("population")).toBeCloseTo(
      0.5306 * NATION_PROSPERITY_POPULATION_WEIGHT * NATION_PROSPERITY_SCORE_MAX,
      6,
    );
    expect(contributions.get("production")).toBeCloseTo(
      0.5132508 * NATION_PROSPERITY_PRODUCTION_WEIGHT * NATION_PROSPERITY_SCORE_MAX,
      6,
    );
    expect(contributions.get("wealth")).toBeCloseTo(
      0.412 * NATION_PROSPERITY_WEALTH_WEIGHT * NATION_PROSPERITY_SCORE_MAX,
      6,
    );
    expect(contributions.get("stability")).toBeCloseTo(
      0.716 * NATION_PROSPERITY_STABILITY_WEIGHT * NATION_PROSPERITY_SCORE_MAX,
      6,
    );
    expect(contributions.get("culture")).toBeCloseTo(
      0.5884 * NATION_PROSPERITY_CULTURE_WEIGHT * NATION_PROSPERITY_SCORE_MAX,
      6,
    );
  });

  /**
   * The load-bearing one. With the measured payload the five rounded contributions sum to 535 while
   * the server's own total is 536 — so a client that summed its own bars would disagree with the
   * server by a visible point. The server's `total` wins and the client does not reconcile.
   */
  it("shows the server's total verbatim, never the sum of its own contributions", () => {
    const view = buildProsperityRankingViewModel([nationFixture()], historyFixture(), "polity-1");
    const row = view.rows[0];
    const summed = view.ownBreakdown.reduce(
      (total, { contribution }) => total + Math.round(contribution),
      0,
    );

    expect(row?.total).toBe(536.1327);
    expect(row?.totalLabel).toBe("536");
    expect(summed).toBe(535);
    expect(row?.totalLabel).not.toBe(String(summed));
  });

  it("labels every contribution as a whole number of points", () => {
    const view = buildProsperityRankingViewModel([nationFixture()], historyFixture(), "polity-1");

    expect(view.ownBreakdown.map(({ contributionLabel }) => contributionLabel)).toEqual([
      "159",
      "128",
      "82",
      "107",
      "59",
    ]);
  });

  it("lists the five components in a fixed order so bars never reshuffle", () => {
    const view = buildProsperityRankingViewModel([nationFixture()], historyFixture(), "polity-1");

    expect(view.ownBreakdown.map(({ component }) => component)).toEqual([
      "population",
      "production",
      "wealth",
      "stability",
      "culture",
    ]);
  });

  /**
   * The point of the marker: it names the component with the most points left on the table, which is
   * `weight × (1 − component)`. On the measured payload that is population at 0.30 × 0.4694 = 140.8
   * points, while the *lowest* bar is wealth at 0.412. Ranking by raw value would point at wealth and
   * send the player to fix the wrong thing.
   */
  it("marks the component costing the most points, not the lowest bar", () => {
    const view = buildProsperityRankingViewModel([nationFixture()], historyFixture(), "polity-1");
    const dragging = view.ownBreakdown.filter(({ isDragging }) => isDragging);
    const lowest = view.ownBreakdown.toSorted((a, b) => a.ratio - b.ratio)[0];

    expect(dragging.map(({ component }) => component)).toEqual(["population"]);
    expect(lowest?.component).toBe("wealth");
  });

  it("marks exactly one dragging component", () => {
    const view = buildProsperityRankingViewModel([nationFixture()], historyFixture(), "polity-1");

    expect(view.ownBreakdown.filter(({ isDragging }) => isDragging)).toHaveLength(1);
  });

  /** Rivals are still ranked while the player has no nation; there is simply no own breakdown. */
  it("ranks everyone but shows no breakdown when the player has no nation", () => {
    const view = buildProsperityRankingViewModel(
      [scored("polity-1", 527.6), scored("polity-2", 736.8)],
      historyFixture([polityFixture(), RIVAL]),
      null,
    );

    expect(view.rows).toHaveLength(2);
    expect(view.ownBreakdown).toEqual([]);
    expect(view.rows.every(({ isPlayer }) => !isPlayer)).toBe(true);
  });

  it("skips a nation with no matching polity rather than inventing a name", () => {
    const view = buildProsperityRankingViewModel(
      [scored("polity-1", 527.6), scored("ghost", 900)],
      historyFixture([polityFixture()]),
      "polity-1",
    );

    expect(view.rows.map(({ nationId }) => nationId)).toEqual(["polity-1"]);
  });

  it("scales each bar against the score maximum so bars are comparable between nations", () => {
    const view = buildProsperityRankingViewModel(
      [scored("polity-1", NATION_PROSPERITY_SCORE_MAX / 2)],
      historyFixture(),
      "polity-1",
    );

    expect(view.rows[0]?.totalRatio).toBeCloseTo(0.5, 6);
  });
});
