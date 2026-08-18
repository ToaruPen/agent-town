import type { ActiveDirective } from "@agent-town/shared";

/**
 * Which of a nation's active directives target this city — the same rule `local/cityScene.ts`'s
 * `activeDirectivesForCity` uses (a directive with no `targetCityId` goes to the capital, a client-side
 * rendering choice, not a rule `ActiveDirective` itself states). Duplicated here rather than imported:
 * that module pulls in PixiJS transitively (`render/trailLayer.ts`), which the Canvas 2D world map has no
 * other dependency on and should not gain for a three-line filter.
 */
function directivesTargeting(
  directives: readonly ActiveDirective[],
  cityId: string,
  isCapital: boolean,
): readonly ActiveDirective[] {
  return directives.filter(
    (directive) =>
      directive.targetCityId === cityId || (directive.targetCityId === null && isCapital),
  );
}

/** visual.md §2.4: how much of a directive's own life is behind it, 0 the moment it is issued to 1 the
 *  instant before it completes and drops out of `activeDirectives`. */
function directiveProgress(directive: ActiveDirective): number {
  if (directive.totalSeasons <= 0) return 1;
  return (directive.totalSeasons - directive.seasonsRemaining) / directive.totalSeasons;
}

/** Whichever directive is closest to completion, ties broken by the lower id — same spirit as
 *  `assignNationBanners`'s own tie-break: the id decides, never the list position, so the result is
 *  stable under any permutation of `directives`. */
function mostAdvanced(directives: readonly ActiveDirective[]): ActiveDirective | null {
  return directives.reduce<ActiveDirective | null>((best, candidate) => {
    if (best === null) return candidate;
    if (candidate.seasonsRemaining !== best.seasonsRemaining) {
      return candidate.seasonsRemaining < best.seasonsRemaining ? candidate : best;
    }
    return candidate.id < best.id ? candidate : best;
  }, null);
}

/**
 * The progress arc's own fraction for one city glyph (visual.md §2.4), or null when nothing targets it.
 * visual.md draws one arc per glyph but does not say which directive wins when more than one targets the
 * same city; this picks whichever is closest to completion, so the arc always answers "what's about to
 * land" rather than an arbitrary array-order pick.
 */
export function cityConstructionProgress(
  directives: readonly ActiveDirective[],
  cityId: string,
  isCapital: boolean,
): number | null {
  const chosen = mostAdvanced(directivesTargeting(directives, cityId, isCapital));
  return chosen === null ? null : directiveProgress(chosen);
}
