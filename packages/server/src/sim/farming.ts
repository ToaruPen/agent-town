import { type CropStage, isField, type SEASONS, type WorldState } from "@agent-town/shared";

type Season = (typeof SEASONS)[number];

const STAGE_BY_SEASON = {
  spring: {},
  summer: { sown: "growing" },
  autumn: { growing: "ripe" },
  winter: { sown: "fallow", growing: "fallow", ripe: "fallow" },
} as const satisfies Readonly<Record<Season, Partial<Record<CropStage, CropStage>>>>;

/** Advances every field to the stage its season implies. Pure: mutates only the fields given. */
export function advanceCrops(world: WorldState, season: Season): void {
  const stageTransitions = STAGE_BY_SEASON[season] as Partial<Record<CropStage, CropStage>>;
  for (const field of world.buildings.filter(isField)) {
    if (!field.complete) continue;
    const nextStage = stageTransitions[field.stage];
    if (nextStage !== undefined) field.stage = nextStage;
  }
}
