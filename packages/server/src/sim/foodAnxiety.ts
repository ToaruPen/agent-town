import {
  type AgentDesires,
  type AgentState,
  type CulturalValueWeight,
  DAYS_PER_SEASON,
  FOOD_SECURITY_FOOD_SHORTAGE_WEIGHT,
  FOOD_SECURITY_HUNGER_HISTORY_WEIGHT,
  FOOD_SECURITY_HUNGER_MEMORY_TICKS,
  FOOD_SECURITY_MAX_CHANGE_PER_UPDATE,
  FOOD_SECURITY_SAFE_FOOD_DAYS,
  FOOD_SECURITY_UPDATE_INTERVAL_TICKS,
  FOOD_SECURITY_WINTER_LOOKAHEAD_DAYS,
  FOOD_SECURITY_WINTER_WEIGHT,
  foodDaysRemaining,
  INSTITUTION_CULTURAL_AFFINITIES,
  INSTITUTION_CULTURE_WEIGHT,
  INSTITUTION_DESIRE_WEIGHT,
  INSTITUTION_KINDS,
  INSTITUTION_OPPOSITION_THRESHOLD,
  INSTITUTION_SUPPORT_THRESHOLD,
  type InstitutionKind,
  SEASONS,
  TICKS_PER_DAY,
  type WorldState,
} from "@agent-town/shared";

const TICKS_PER_SEASON = DAYS_PER_SEASON * TICKS_PER_DAY;
const TICKS_PER_YEAR = SEASONS.length * TICKS_PER_SEASON;
const WINTER_START_TICK = SEASONS.indexOf("winter") * TICKS_PER_SEASON;

export interface InstitutionSupport {
  kind: InstitutionKind;
  score: number;
  supports: boolean;
  opposes: boolean;
}

function clampUnit(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function foodShortagePressure(world: WorldState): number {
  return clampUnit(1 - foodDaysRemaining(world) / FOOD_SECURITY_SAFE_FOOD_DAYS);
}

function winterPressure(tick: number): number {
  return clampUnit(1 - daysUntilWinter(tick) / FOOD_SECURITY_WINTER_LOOKAHEAD_DAYS);
}

function homelandCulture(world: WorldState): CulturalValueWeight[] {
  const homelandPolityId = world.history.settlementOrigin?.homelandPolityId;
  if (homelandPolityId === undefined) return [];
  return world.history.polities.find(({ id }) => id === homelandPolityId)?.values ?? [];
}

function culturalAffinity(kind: InstitutionKind, culture: CulturalValueWeight[]): number {
  let weightedAffinity = 0;
  let totalWeight = 0;
  for (const { value, weight } of culture) {
    if (!Number.isFinite(weight) || weight <= 0) continue;
    weightedAffinity += INSTITUTION_CULTURAL_AFFINITIES[kind][value] * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  return clampUnit(weightedAffinity / totalWeight);
}

export function daysUntilWinter(tick: number): number {
  const tickInYear = ((tick % TICKS_PER_YEAR) + TICKS_PER_YEAR) % TICKS_PER_YEAR;
  if (tickInYear >= WINTER_START_TICK) return 0;
  return (WINTER_START_TICK - tickInYear) / TICKS_PER_DAY;
}

export function isRecentHungerInterrupt(
  tick: number,
  lastHungerInterruptTick: number | null,
): boolean {
  if (lastHungerInterruptTick === null) return false;
  const elapsedTicks = tick - lastHungerInterruptTick;
  return elapsedTicks >= 0 && elapsedTicks <= FOOD_SECURITY_HUNGER_MEMORY_TICKS;
}

export function updateFoodSecurityDesire(world: WorldState, agent: AgentState): void {
  const hungerHistoryPressure = isRecentHungerInterrupt(world.tick, agent.lastHungerInterruptTick)
    ? 1
    : 0;
  const target = clampUnit(
    foodShortagePressure(world) * FOOD_SECURITY_FOOD_SHORTAGE_WEIGHT +
      winterPressure(world.tick) * FOOD_SECURITY_WINTER_WEIGHT +
      hungerHistoryPressure * FOOD_SECURITY_HUNGER_HISTORY_WEIGHT,
  );
  const current = clampUnit(agent.desires.foodSecurity);
  const change = Math.max(
    -FOOD_SECURITY_MAX_CHANGE_PER_UPDATE,
    Math.min(FOOD_SECURITY_MAX_CHANGE_PER_UPDATE, target - current),
  );
  agent.desires.foodSecurity = clampUnit(current + change);
}

export function institutionSupportScore(
  kind: InstitutionKind,
  culture: CulturalValueWeight[],
  desires: AgentDesires,
): number {
  return clampUnit(
    culturalAffinity(kind, culture) * INSTITUTION_CULTURE_WEIGHT +
      clampUnit(desires.foodSecurity) * INSTITUTION_DESIRE_WEIGHT,
  );
}

export function institutionSupportForAgent(
  world: WorldState,
  agent: AgentState,
): InstitutionSupport[] {
  const culture = homelandCulture(world);
  return INSTITUTION_KINDS.map((kind) => {
    const score = institutionSupportScore(kind, culture, agent.desires);
    return {
      kind,
      score,
      supports: score >= INSTITUTION_SUPPORT_THRESHOLD,
      opposes: score < INSTITUTION_OPPOSITION_THRESHOLD,
    };
  });
}

export function updateFoodSecurityDesires(world: WorldState): void {
  if (world.tick % FOOD_SECURITY_UPDATE_INTERVAL_TICKS !== 0) return;
  for (const agent of world.agents) {
    updateFoodSecurityDesire(world, agent);
  }
}
