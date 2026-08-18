import type { NationState, WorldHistory } from "@agent-town/shared";

import { assignNationBanners } from "../render/nationBanner.js";
import { hexColor } from "../ui/worldMapView.js";
import type { CitySceneInput } from "./cityScene.js";

export interface CityViewTarget {
  scene: CitySceneInput;
  /** The nation's derived banner colour (C1-1), not `Polity.color`: a synthesized `WorldState` carries
   *  no nation identity of its own, so the panel's chrome has to be handed this rather than deriving it
   *  from the archival value, whose muted colours collide (traversal.md §2.2, visual.md §2.1). */
  bannerColor: string;
}

/**
 * The city view's default target: the player's own capital (plan §C1-7, "Default target is the
 * player's capital"). Null whenever any one piece the scene needs is missing — no nation claimed yet,
 * the claimed nation's capital or its city state has not arrived over the wire, or the polity itself is
 * absent from `history.polities` — so a caller never has to guess which gap it hit; it just does not
 * open yet, the same "not knowable" shape `ownPair` in `nationHud.ts` already uses.
 */
export function resolvePlayerCityViewTarget(
  history: WorldHistory,
  nations: readonly NationState[],
  playerNationId: string | null,
  tick: number,
): CityViewTarget | null {
  if (playerNationId === null) return null;
  const polity = history.polities.find((candidate) => candidate.id === playerNationId);
  const nation = nations.find((candidate) => candidate.id === playerNationId);
  const city = history.worldMap.cities.find(
    (candidate) => candidate.polityId === playerNationId && candidate.isCapital,
  );
  if (polity === undefined || nation === undefined || city === undefined) return null;
  const cityState = nation.cities.find((candidate) => candidate.cityId === city.id);
  if (cityState === undefined) return null;
  const banner = assignNationBanners(history.polities).find(
    (candidate) => candidate.nationId === playerNationId,
  );
  if (banner === undefined) return null;
  return {
    scene: { city, cityState, nation, polity, worldMap: history.worldMap, tick },
    bannerColor: hexColor(banner.color),
  };
}
