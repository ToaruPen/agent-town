import type { CulturalValue } from "./history.js";
import type { InstitutionKind } from "./society.js";
import type { FacilityKind, MovementPurpose, SiteFactor, TrailLevel } from "./spatial.js";
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
/** Food a single ripe field yields when harvested. Sized in Task 7 by measurement. */
export const FIELD_YIELD = 25;
/** Work units to till a new field, mirroring house construction progress. */
export const FIELD_TILL_WORK = 30;
/** Fields the settlement wants, one per this many residents. */
export const RESIDENTS_PER_FIELD = 1;
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
export const FOOD_SECURITY_SAFE_FOOD_DAYS = 5;
export const FOOD_SECURITY_WINTER_LOOKAHEAD_DAYS = 6;
export const FOOD_SECURITY_HUNGER_MEMORY_TICKS = 2 * TICKS_PER_DAY;
export const FOOD_SECURITY_FOOD_SHORTAGE_WEIGHT = 0.55;
export const FOOD_SECURITY_WINTER_WEIGHT = 0.2;
export const FOOD_SECURITY_HUNGER_HISTORY_WEIGHT = 0.25;
export const FOOD_SECURITY_MAX_CHANGE_PER_UPDATE = 0.1;
export const FOOD_SECURITY_RECOGNITION_THRESHOLD = 0.5;

export const INSTITUTION_CULTURE_WEIGHT = 0.45;
export const INSTITUTION_DESIRE_WEIGHT = 0.55;
export const INSTITUTION_SUPPORT_THRESHOLD = 0.48;
export const INSTITUTION_OPPOSITION_THRESHOLD = 0.35;

export const SOCIETY_UPDATE_INTERVAL_TICKS = 10;
export const COLLECTIVE_MIN_SUPPORTERS = 2;
export const COLLECTIVE_FORMATION_TICKS = 2400;
export const COLLECTIVE_DISSOLUTION_TICKS = 50;
export const COLLECTIVE_DISSOLUTION_COHESION = 0.35;
export const INSTITUTION_FOOD_PRESSURE_DAYS = 4;
export const SOCIAL_MILESTONE_DURATION_TICKS = 50;

export const FACILITY_KIND_BY_INSTITUTION = {
  communalGranaryStore: "communalGranary",
  grainMarket: "grainMarket",
  rationControl: "rationDepot",
} as const satisfies Readonly<Record<InstitutionKind, FacilityKind>>;

export const FACILITY_NAMES = {
  communalGranary: "共同穀倉",
  grainMarket: "穀物市場",
  rationDepot: "配給所",
} as const satisfies Readonly<Record<FacilityKind, string>>;

export const FACILITY_WOOD_COST = {
  communalGranary: 15,
  grainMarket: 12,
  rationDepot: 10,
} as const satisfies Readonly<Record<FacilityKind, number>>;

export const FACILITY_BUILD_TICKS = {
  communalGranary: 240,
  grainMarket: 200,
  rationDepot: 180,
} as const satisfies Readonly<Record<FacilityKind, number>>;

export const FACILITY_FOOD_CAPACITY = {
  communalGranary: 120,
  grainMarket: 80,
  rationDepot: 80,
} as const satisfies Readonly<Record<FacilityKind, number>>;

export const FACILITY_MAINTENANCE_PER_DAY = {
  communalGranary: 40,
  grainMarket: 30,
  rationDepot: 35,
} as const satisfies Readonly<Record<FacilityKind, number>>;

/** Days of food residents keep at the stockpile before storing the rest in a facility. */
export const FACILITY_STOCK_RESERVE_DAYS = 1;
export const FACILITY_SITE_DISTANCE_CAP = 32;
export const SPATIAL_DEMAND_RETRY_INTERVAL_TICKS = 100;

export const SITE_FACTORS = [
  "foodAccess",
  "residentAccess",
  "stockpileAccess",
  "existingTraffic",
  "settlementEdgeAccess",
  "openSpace",
  "accessEquality",
] as const satisfies readonly SiteFactor[];

export const FACILITY_SITE_WEIGHTS = {
  communalGranary: {
    foodAccess: 0.25,
    residentAccess: 0.2,
    stockpileAccess: 0.25,
    existingTraffic: 0.05,
    settlementEdgeAccess: 0,
    openSpace: 0.15,
    accessEquality: 0.1,
  },
  grainMarket: {
    foodAccess: 0.05,
    residentAccess: 0.2,
    stockpileAccess: 0.1,
    existingTraffic: 0.25,
    settlementEdgeAccess: 0.2,
    openSpace: 0.2,
    accessEquality: 0,
  },
  rationDepot: {
    foodAccess: 0.05,
    residentAccess: 0.25,
    stockpileAccess: 0.15,
    existingTraffic: 0.1,
    settlementEdgeAccess: 0,
    openSpace: 0.15,
    accessEquality: 0.3,
  },
} as const satisfies Readonly<Record<FacilityKind, Readonly<Record<SiteFactor, number>>>>;

export const STOCKPILE_FOOD_SPOILAGE_RATE = 0.04;
export const GRANARY_FOOD_SPOILAGE_RATE = 0.01;
export const FACILITY_RESERVE_FOOD_DAYS = 4;
export const MARKET_TRADE_INTERVAL_TICKS = 600;
export const MARKET_IMPORT_WOOD = 5;
export const MARKET_IMPORT_FOOD = 10;
export const MARKET_EXPORT_FOOD = 10;
export const MARKET_EXPORT_WOOD = 4;
export const MARKET_IMPORT_BELOW_FOOD_DAYS = 3;
export const MARKET_EXPORT_ABOVE_FOOD_DAYS = 7;
export const RATION_FOOD_PER_MEAL = 4;
export const RATION_HUNGER_PER_MEAL = 50;
export const RATION_BELOW_FOOD_DAYS = 4;
export const RATION_STRAIN_PER_MEAL = 0.08;
export const RATION_STRAIN_RECOVERY_PER_DAY = 0.03;
export const RATION_SUPPORT_PENALTY = 0.35;

export const TRAIL_LEVEL_WEAR = {
  none: 0,
  trace: 2,
  trail: 8,
  establishedTrail: 24,
} as const satisfies Readonly<Record<TrailLevel, number>>;

export const MOVEMENT_PURPOSES = [
  "survival",
  "gathering",
  "construction",
  "facilityService",
  "wandering",
] as const satisfies readonly MovementPurpose[];

export const TRAIL_PURPOSE_WEAR = {
  survival: 0.5,
  gathering: 0.65,
  construction: 1,
  facilityService: 1,
  wandering: 0.05,
} as const satisfies Readonly<Record<MovementPurpose, number>>;

export const TRAIL_DAILY_DECAY = 0.85;
export const TRAIL_MAX_CAUSE_FACILITIES = 3;
export const TRAIL_MOVE_TICK_MULTIPLIER = {
  none: 1,
  trace: 0.95,
  trail: 0.8,
  establishedTrail: 0.65,
} as const satisfies Readonly<Record<TrailLevel, number>>;

export const NATION_TICKS_PER_SEASON = 300; // 30 s at x1
export const NATION_TICKS_PER_YEAR = NATION_TICKS_PER_SEASON * SEASONS.length; // 2 min at x1
export const SPEED_MULTIPLIERS = [0, 1, 2, 4, 8] as const;
export const DEFAULT_SPEED: import("./nation.js").SpeedMultiplier = 1;
export const CLOCK_BROADCAST_MS = 1000; // wall-clock heartbeat; stays ~1 Hz at every speed

/** Live residents represented by one population point recorded in world history. */
export const NATION_POPULATION_PER_HISTORY_POINT = 100;
/** Relative population weight assigned to a capital during the initial city split. */
export const NATION_CAPITAL_POPULATION_WEIGHT = 2;
/** Relative population weight assigned to a non-capital city during the initial city split. */
export const NATION_CITY_POPULATION_WEIGHT = 1;
/** Per-cell food production contributed by each owned terrain kind. */
export const NATION_TERRAIN_FOOD_PRODUCTION = {
  sea: 0,
  plains: 2,
  forest: 1,
  hills: 0.5,
  mountains: 0.25,
} as const satisfies Readonly<Record<WorldMapTerrain, number>>;
/** Per-cell material production contributed by each owned terrain kind. */
export const NATION_TERRAIN_MATERIAL_PRODUCTION = {
  sea: 0,
  plains: 0.25,
  forest: 1,
  hills: 1.5,
  mountains: 2,
} as const satisfies Readonly<Record<WorldMapTerrain, number>>;
/** Base seasons of food production held as the initial food stock. */
export const NATION_STARTING_FOOD_PRODUCTION_MULTIPLIER = 4;
/** Extra initial food-production seasons granted per mutual-aid value weight. */
export const NATION_STARTING_FOOD_MUTUAL_AID_COEFFICIENT = 2;
/** Extra initial food-production seasons granted per stewardship value weight. */
export const NATION_STARTING_FOOD_STEWARDSHIP_COEFFICIENT = 2;
/** Base seasons of material production held as the initial material stock. */
export const NATION_STARTING_MATERIAL_PRODUCTION_MULTIPLIER = 4;
/** Extra initial material-production seasons granted per valor value weight. */
export const NATION_STARTING_MATERIAL_VALOR_COEFFICIENT = 2;
/** Extra initial material-production seasons granted per order value weight. */
export const NATION_STARTING_MATERIAL_ORDER_COEFFICIENT = 2;
/** Base wealth held for each owned territory cell. */
export const NATION_STARTING_WEALTH_PER_TERRITORY_CELL = 2;
/** Extra per-cell initial wealth granted per commerce value weight. */
export const NATION_STARTING_WEALTH_COMMERCE_COEFFICIENT = 6;

/** One-time stock cost paid when each directive becomes active. */
export const NATION_DIRECTIVE_COSTS = {
  clearFarmland: { food: 20, materials: 30, wealth: 10 },
  developTimber: { food: 10, materials: 20, wealth: 15 },
  openMine: { food: 15, materials: 50, wealth: 30 },
  growCity: { food: 30, materials: 40, wealth: 50 },
  encourageStores: { food: 10, materials: 10, wealth: 20 },
  holdFestival: { food: 20, materials: 0, wealth: 40 },
} as const satisfies Readonly<
  Record<import("./nation.js").DirectiveKind, import("./nation.js").NationStocks>
>;
/** Seasons each directive remains active before its completion effect. */
export const NATION_DIRECTIVE_DURATIONS = {
  clearFarmland: 2,
  developTimber: 2,
  openMine: 3,
  growCity: 3,
  encourageStores: 2,
  holdFestival: 1,
} as const satisfies Readonly<Record<import("./nation.js").DirectiveKind, number>>;
/** Signed cultural-value coefficients used to score directive affinity. */
export const NATION_DIRECTIVE_CULTURAL_AFFINITIES = {
  clearFarmland: {
    commerce: 0.15,
    faith: 0,
    knowledge: 0.1,
    kinship: 0.1,
    mutualAid: 0.3,
    order: 0.15,
    stewardship: -1,
    valor: 0,
  },
  developTimber: {
    commerce: 0,
    faith: 0,
    knowledge: 0,
    kinship: 0,
    mutualAid: 0,
    order: 0,
    stewardship: -1,
    valor: 0,
  },
  openMine: {
    commerce: 0.3,
    faith: 0,
    knowledge: 0.35,
    kinship: 0,
    mutualAid: 0,
    order: 0.2,
    stewardship: -0.75,
    valor: 0.2,
  },
  growCity: {
    commerce: 0.6,
    faith: 0,
    knowledge: 0.2,
    kinship: 0.2,
    mutualAid: 0.1,
    order: 0.4,
    stewardship: 0,
    valor: 0,
  },
  encourageStores: {
    commerce: 0,
    faith: 0,
    knowledge: 0,
    kinship: 0.2,
    mutualAid: 0.7,
    order: 0.25,
    stewardship: 0.3,
    valor: 0,
  },
  holdFestival: {
    commerce: 0,
    faith: 0.7,
    knowledge: 0,
    kinship: 0.5,
    mutualAid: 0.2,
    order: 0,
    stewardship: 0,
    valor: 0,
  },
} as const satisfies Readonly<
  Record<import("./nation.js").DirectiveKind, Readonly<Record<CulturalValue, number>>>
>;
/** Affinity at or below this value makes a directive culturally taboo. */
export const NATION_DIRECTIVE_TABOO_AFFINITY = -0.75;
/** Maximum development level reachable by a nation city. */
export const NATION_CITY_DEVELOPMENT_CAP = 5;
/** Permanent food-production increase when farmland clearing completes. */
export const NATION_CLEAR_FARMLAND_FOOD_PRODUCTION_BONUS = 10;
/** Permanent material-production increase when timber development completes. */
export const NATION_DEVELOP_TIMBER_MATERIAL_PRODUCTION_BONUS = 8;
/** Permanent material-production increase when mine development completes. */
export const NATION_OPEN_MINE_MATERIAL_PRODUCTION_BONUS = 16;
/** Development levels added when city growth completes. */
export const NATION_GROW_CITY_DEVELOPMENT_BONUS = 1;
/** Food added to stocks when a storage-encouragement directive completes. */
export const NATION_ENCOURAGE_STORES_FOOD_BONUS = 50;
/** Stability added when a festival completes. */
export const NATION_HOLD_FESTIVAL_STABILITY_BONUS = 8;
/** Culture added when a festival completes. */
export const NATION_HOLD_FESTIVAL_CULTURE_BONUS = 5;
/** Score added when the chancellor responds to a reported deficit. */
export const NATION_CHANCELLOR_DEFICIT_BONUS = 0.5;
/** Stability below this value makes festivals a chancellor priority. */
export const NATION_CHANCELLOR_LOW_STABILITY = 40;
