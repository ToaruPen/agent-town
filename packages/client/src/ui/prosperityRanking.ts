import { meter } from "./nationDom.js";
import type {
  ProsperityContributionRow,
  ProsperityRankingViewModel,
  ProsperityRankRow,
} from "./prosperityViewModel.js";
import { element } from "./worldChronicle.js";

export interface ProsperityRankingController {
  render(view: ProsperityRankingViewModel, generation: number): void;
}

function rankRow(row: ProsperityRankRow): HTMLElement {
  const item = element("li", `prosperity__row${row.isPlayer ? " prosperity__row--own" : ""}`);
  const swatch = element("span", "prosperity__swatch");
  swatch.style.setProperty("--banner-color", row.swatchColor);
  item.append(
    element("span", "prosperity__rank", String(row.rank)),
    swatch,
    element("span", "prosperity__name", row.name),
    element("span", "prosperity__total", row.totalLabel),
    meter("prosperity__bar", row.totalRatio, `繁栄度${row.totalLabel}`),
  );
  return item;
}

function contributionRow(row: ProsperityContributionRow): HTMLElement {
  const item = element(
    "li",
    `prosperity__contribution${row.isDragging ? " prosperity__contribution--dragging" : ""}`,
  );
  item.append(
    element("span", "prosperity__contribution-label", row.label),
    meter("prosperity__contribution-bar", row.ratio, `${row.label}${row.contributionLabel}点`),
    element("span", "prosperity__contribution-value", row.contributionLabel),
  );
  if (row.isDragging) {
    // Named in words too, because the marker's meaning is not obvious from its position.
    item.append(element("span", "prosperity__dragging-note", "最も点を落としている項目"));
  }
  return item;
}

function breakdownSection(view: ProsperityRankingViewModel): HTMLElement[] {
  if (view.ownBreakdown.length === 0) return [];
  const list = element("ul", "prosperity__contributions");
  list.append(...view.ownBreakdown.map(contributionRow));
  return [element("h3", "prosperity__subtitle", "内訳（自国）"), list];
}

/**
 * The ranking and the player's own breakdown.
 *
 * Every total here is the server's `prosperity.total`; the contribution bars beside it are each
 * component's `weight × component × 1000` and are never added up into a total of the client's own. On
 * the measured payload they come to 535 against a server total of 536, and the server wins.
 */
export function createProsperityRanking(root: HTMLElement): ProsperityRankingController {
  let renderedKey: string | null = null;

  return {
    render(view: ProsperityRankingViewModel, generation: number): void {
      const nextKey = `${generation}:${JSON.stringify(view)}`;
      if (nextKey === renderedKey) return;
      renderedKey = nextKey;

      const rows = element("ol", "prosperity__rows");
      rows.append(...view.rows.map(rankRow));
      root.replaceChildren(
        element("h2", "prosperity__title", "繁栄度"),
        rows,
        ...breakdownSection(view),
      );
    },
  };
}
