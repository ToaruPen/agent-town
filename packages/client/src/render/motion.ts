export const RESIDENT_MOTION_HALF_LIFE_MS = 50;
// Crowding offsets can make an ordinary one-tile step span more than one visual tile.
export const SNAP_DISTANCE_TILES = 2;

/** Fraction of the remaining distance to close this frame, given how long the frame took. */
export function easeFactor(deltaMs: number, halfLifeMs: number): number {
  if (deltaMs <= 0) return 0;
  if (halfLifeMs <= 0) return 1;
  return Math.min(1, 1 - 2 ** (-deltaMs / halfLifeMs));
}
