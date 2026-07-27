import {
  NATION_PROSPERITY_CULTURE_WEIGHT,
  NATION_PROSPERITY_POPULATION_WEIGHT,
  NATION_PROSPERITY_PRODUCTION_WEIGHT,
  NATION_PROSPERITY_SCORE_MAX,
  NATION_PROSPERITY_STABILITY_WEIGHT,
  NATION_PROSPERITY_WEALTH_WEIGHT,
  type NationId,
  type NationState,
  type ProsperityScore,
  type WorldHistory,
} from "@agent-town/shared";

import { assignNationBanners } from "../render/nationBanner.js";
import { type ProsperityComponent, prosperityComponentLabel } from "./nationText.js";

export interface ProsperityRankRow {
  nationId: NationId;
  name: string;
  swatchColor: string;
  rank: number;
  /** The server's own figure, carried through untouched. */
  total: number;
  totalLabel: string;
  /** 0..1 against the score maximum, so one nation's bar is comparable with another's. */
  totalRatio: number;
  isPlayer: boolean;
}

export interface ProsperityContributionRow {
  component: ProsperityComponent;
  label: string;
  /** The normalised 0..1 component as the server sent it. */
  ratio: number;
  weight: number;
  contribution: number;
  contributionLabel: string;
  isDragging: boolean;
}

export interface ProsperityRankingViewModel {
  rows: ProsperityRankRow[];
  /** Empty when the player holds no nation; rivals are still ranked. */
  ownBreakdown: ProsperityContributionRow[];
}

/** Fixed so the bars never reshuffle between renders. */
const COMPONENT_ORDER: readonly ProsperityComponent[] = [
  "population",
  "production",
  "wealth",
  "stability",
  "culture",
];

/**
 * Imported rather than reconstructed. §2.4 pins the components as normalised 0..1 ratios against their
 * reference constants, so the client's only job is to weight them — recomputing the normalisation
 * client-side is what the design forbids.
 */
const COMPONENT_WEIGHTS: Readonly<Record<ProsperityComponent, number>> = {
  population: NATION_PROSPERITY_POPULATION_WEIGHT,
  production: NATION_PROSPERITY_PRODUCTION_WEIGHT,
  wealth: NATION_PROSPERITY_WEALTH_WEIGHT,
  stability: NATION_PROSPERITY_STABILITY_WEIGHT,
  culture: NATION_PROSPERITY_CULTURE_WEIGHT,
};

/** Duplicated from `worldMapView.ts:75`, where it is module-private. Three lines, no shared owner. */
function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** The points a component is leaving on the table: what the marker in §4.1 actually points at. */
function forgonePoints(prosperity: ProsperityScore, component: ProsperityComponent): number {
  return COMPONENT_WEIGHTS[component] * (1 - prosperity[component]);
}

function draggingComponent(prosperity: ProsperityScore): ProsperityComponent | null {
  let worst: ProsperityComponent | null = null;
  for (const component of COMPONENT_ORDER) {
    if (worst === null || forgonePoints(prosperity, component) > forgonePoints(prosperity, worst)) {
      worst = component;
    }
  }
  return worst;
}

function contributionRows(prosperity: ProsperityScore): ProsperityContributionRow[] {
  const dragging = draggingComponent(prosperity);
  return COMPONENT_ORDER.map((component) => {
    const ratio = prosperity[component];
    const weight = COMPONENT_WEIGHTS[component];
    const contribution = ratio * weight * NATION_PROSPERITY_SCORE_MAX;
    return {
      component,
      label: prosperityComponentLabel(component),
      ratio,
      weight,
      contribution,
      contributionLabel: String(Math.round(contribution)),
      isDragging: component === dragging,
    };
  });
}

interface NamedNation {
  nation: NationState;
  name: string;
  swatchColor: string;
}

function namedNations(nations: readonly NationState[], history: WorldHistory): NamedNation[] {
  const polities = new Map(history.polities.map((polity) => [polity.id, polity] as const));
  const banners = new Map(
    assignNationBanners(history.polities).map(
      ({ nationId, color }) => [nationId, hexColor(color)] as const,
    ),
  );
  return nations.flatMap((nation) => {
    const polity = polities.get(nation.id);
    // A nation with no polity has no name and no banner. Skipping it beats inventing either.
    if (polity === undefined) return [];
    // The banner is the ranking swatch, per C1-1. The archival colour is only a floor if the ring
    // somehow skipped this polity, which assignNationBanners over the same list should not do.
    return [
      { nation, name: polity.name, swatchColor: banners.get(nation.id) ?? hexColor(polity.color) },
    ];
  });
}

/** Descending by score, then by id, so a tie renders the same way whatever order the wire used. */
function byScoreThenId(left: NamedNation, right: NamedNation): number {
  const scoreGap = right.nation.prosperity.total - left.nation.prosperity.total;
  return scoreGap !== 0 ? scoreGap : left.nation.id.localeCompare(right.nation.id);
}

/**
 * The ranking and, for the player's own nation, the five contributions behind its score.
 *
 * The total shown is always `prosperity.total` as the server sent it. Rounded contributions need not
 * sum to it — on the measured payload they come to 535 against a server total of 536 — and when they
 * disagree the server wins. Nothing here sums contributions into a displayed total.
 */
export function buildProsperityRankingViewModel(
  nations: readonly NationState[],
  history: WorldHistory,
  playerNationId: NationId | null,
): ProsperityRankingViewModel {
  const ranked = namedNations(nations, history).toSorted(byScoreThenId);
  const own = ranked.find(({ nation }) => nation.id === playerNationId);

  return {
    rows: ranked.map(({ nation, name, swatchColor }, index) => ({
      nationId: nation.id,
      name,
      swatchColor,
      rank: index + 1,
      total: nation.prosperity.total,
      totalLabel: String(Math.round(nation.prosperity.total)),
      totalRatio: nation.prosperity.total / NATION_PROSPERITY_SCORE_MAX,
      isPlayer: nation.id === playerNationId,
    })),
    ownBreakdown: own === undefined ? [] : contributionRows(own.nation.prosperity),
  };
}
