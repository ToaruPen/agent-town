import type { CulturalValue } from "./history.js";
import type { InstitutionKind } from "./society.js";
import type { WorldMapTerrain } from "./worldMap.js";

export const TICK_RATE = 10; // sim ticks per second
export const TICKS_PER_DAY = 2400;
export const THINK_COOLDOWN_TICKS = 1200;
export const MAX_PLAN_TASKS = 8;
export const MAX_PLAN_REASONING_CHARS = 512;
export const LLM_TIMEOUT_MS = 90_000;
export const LLM_CLAUDE_MODEL_DEFAULT = "haiku";
export const LLM_MAX_CALLS_PER_HOUR = 30;
export const LLM_BUDGET_LOG_INTERVAL_TICKS = 1_000;
export const TICKS_PER_HOUR = 36_000;
export const DAYS_PER_SEASON = 2;
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const; // year = 8 days = ~32 real minutes
export const HUNGER_MAX = 100;
export const HUNGER_DECAY_PER_DAY = 50; // full → starving in 2 days without eating
export const HUNGER_EAT_THRESHOLD = 40; // engine interrupt below this
export const FOOD_PER_MEAL = 5;
export const HUNGER_PER_MEAL = 60;
export const FATIGUE_MAX = 100;
export const FATIGUE_DECAY_PER_DAY = 60;
export const FATIGUE_REST_THRESHOLD = 25;
export const FATIGUE_SLOWDOWN = 0.5; // work/move speed multiplier when fatigue < threshold
export const FATIGUE_REST_RECOVERY_PER_DAY = FATIGUE_MAX + FATIGUE_DECAY_PER_DAY;
export const HEALTH_MAX = 100;
export const STARVATION_HEALTH_PER_DAY = 25; // ~4 days of grace at hunger 0
export const COLD_HEALTH_PER_DAY = 15; // winter with no wood to burn
export const WOOD_BURN_PER_AGENT_PER_DAY = 2; // winter only
export const BERRY_REGROWTH_PER_DAY = 4; // per food tile, spring/summer/autumn only, cap at initial amount
export const TREE_REGROWTH_PER_DAY = 1; // per depleted forest tile, cap 30
export const TREE_REGROWTH_CAP = 30;
export const HOUSE_WOOD_COST = 15;
export const HOUSE_BUILD_TICKS = 400;
export const HOUSE_CAPACITY = 2;
export const IMMIGRATION_FOOD_DAYS_MIN = 4; // arrive on spring morning if stored food ≥ 4 days AND free housing
export const MAX_POPULATION = 10;
export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 48;
export const AGENT_COUNT = 3;
export const AGENT_NAMES = ["トネリコ", "シラカバ", "スギ"] as const;
export const IMMIGRANT_NAMES = [
  "ダリア",
  "ニレ",
  "シダ",
  "ハリエニシダ",
  "ハシバミ",
  "アヤメ",
  "ネズ",
] as const;
export const MOVE_TICKS_PER_TILE = 3;
export const GATHER_TICKS = 20;
export const EAT_TICKS = 10;
export const FORAGE_TICKS = 30;
export const CARRY_CAPACITY = 5;
export const STOCKPILE_TARGET_WOOD = 30;
export const STOCKPILE_TARGET_FOOD = 20;
export const WANDER_RADIUS = 5;
export const WS_PORT = 8790;
export const TERRAIN_PATCH_SIZE = 4;
export const WATER_PATCH_CHANCE = 0.05;
export const ROCK_PATCH_CHANCE = 0.05;
export const FOREST_TILE_CHANCE = 0.25;
export const FOOD_TILE_CHANCE = 0.08;
export const WOOD_RESOURCE_MIN = 20;
export const WOOD_RESOURCE_MAX = 50;
export const FOOD_RESOURCE_MIN = 10;
export const FOOD_RESOURCE_MAX = 30;
export const WORLD_HISTORY_YEARS = 200;
export const WORLD_HISTORY_TURN_YEARS = 20;
export const WORLD_POLITY_COUNT = 4;
export const WORLD_LANDMARK_MIN_DISTANCE = 12;
export const WORLD_LANDMARK_FALLBACK_DISTANCE = 6;
export const WORLD_MAP_WIDTH = 96;
export const WORLD_MAP_HEIGHT = 64;
export const WORLD_MAP_RNG_SALT = 0x9e3779b9;
export const WORLD_MAP_NOISE_PASSES = 3;
export const WORLD_MAP_ELEVATION_NOISE_WEIGHT = 0.55;
export const WORLD_MAP_CENTER_BIAS_WEIGHT = 0.45;
export const WORLD_MAP_LAND_THRESHOLD = 0.46;
export const WORLD_MAP_HILLS_THRESHOLD = 0.62;
export const WORLD_MAP_MOUNTAINS_THRESHOLD = 0.76;
export const WORLD_MAP_FOREST_MOISTURE_THRESHOLD = 0.54;
export const WORLD_MAP_CLAIMED_LAND_RATIO = 0.7;
export const WORLD_MAP_CAPITAL_MIN_DISTANCE = 12;
export const WORLD_MAP_CITY_MIN_DISTANCE = 5;
export const WORLD_MAP_CITY_COUNT_MIN = 1;
export const WORLD_MAP_CITY_COUNT_MAX = 3;
export const WORLD_MAP_WAR_BORDER_CELLS_PER_EVENT = 2;
export const WORLD_MAP_CELL_SIZE_PX = 6;
export const WORLD_MAP_CITY_RADIUS_PX = 2;
export const WORLD_MAP_CAPITAL_RADIUS_PX = 3;
export const WORLD_MAP_SETTLEMENT_RADIUS_PX = 4;
export const WORLD_MAP_POLITY_ALPHA = 0.28;
export const WORLD_MAP_SELECTED_POLITY_ALPHA = 0.52;

export const WORLD_MAP_TERRAIN_EXPANSION_WEIGHTS: Readonly<Record<WorldMapTerrain, number>> = {
  sea: 0,
  plains: 1,
  forest: 0.8,
  hills: 0.55,
  mountains: 0.2,
};

export const WORLD_CITY_NAME_SUFFIXES = ["府", "市", "砦"] as const;

export const INSTITUTION_KINDS = [
  "communalGranaryStore",
  "grainMarket",
  "rationControl",
] as const satisfies readonly InstitutionKind[];

export const INSTITUTION_NAMES: Readonly<Record<InstitutionKind, string>> = {
  communalGranaryStore: "共同備蓄",
  grainMarket: "私的取引",
  rationControl: "配給統制",
};

export const INSTITUTION_CULTURAL_AFFINITIES: Readonly<
  Record<InstitutionKind, Readonly<Record<CulturalValue, number>>>
> = {
  communalGranaryStore: {
    commerce: 0.05,
    faith: 0.35,
    knowledge: 0.2,
    kinship: 0.55,
    mutualAid: 1,
    order: 0.3,
    stewardship: 0.8,
    valor: 0.25,
  },
  grainMarket: {
    commerce: 1,
    faith: 0.4,
    knowledge: 0.7,
    kinship: 0.35,
    mutualAid: 0.15,
    order: 0.3,
    stewardship: 0.2,
    valor: 0.2,
  },
  rationControl: {
    commerce: 0.1,
    faith: 0.45,
    knowledge: 0.2,
    kinship: 0.35,
    mutualAid: 0.35,
    order: 1,
    stewardship: 0.3,
    valor: 0.8,
  },
};

export const FOOD_SECURITY_UPDATE_INTERVAL_TICKS = 10;
export const FOOD_SECURITY_SAFE_FOOD_DAYS = 4;
export const FOOD_SECURITY_WINTER_LOOKAHEAD_DAYS = 6;
export const FOOD_SECURITY_HUNGER_MEMORY_TICKS = 2 * TICKS_PER_DAY;
export const FOOD_SECURITY_FOOD_SHORTAGE_WEIGHT = 0.55;
export const FOOD_SECURITY_WINTER_WEIGHT = 0.2;
export const FOOD_SECURITY_HUNGER_HISTORY_WEIGHT = 0.25;
export const FOOD_SECURITY_MAX_CHANGE_PER_UPDATE = 0.1;
export const FOOD_SECURITY_RECOGNITION_THRESHOLD = 0.5;

export const INSTITUTION_CULTURE_WEIGHT = 0.45;
export const INSTITUTION_DESIRE_WEIGHT = 0.55;
export const INSTITUTION_SUPPORT_THRESHOLD = 0.55;
export const INSTITUTION_OPPOSITION_THRESHOLD = 0.35;

export const SOCIETY_UPDATE_INTERVAL_TICKS = 10;
export const COLLECTIVE_MIN_SUPPORTERS = 2;
export const COLLECTIVE_FORMATION_TICKS = 50;
export const COLLECTIVE_DISSOLUTION_TICKS = 50;
export const COLLECTIVE_DISSOLUTION_COHESION = 0.5;
export const INSTITUTION_FOOD_PRESSURE_DAYS = 2;
export const SOCIAL_MILESTONE_DURATION_TICKS = 50;
