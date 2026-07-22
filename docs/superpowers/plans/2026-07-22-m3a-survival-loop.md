# M3a "Survival Loop" Implementation Plan

> **For agentic workers:** Same regime: TDD, all prior Global Constraints apply, no reviewer sub-agents, commit is part of the task. Sim stays deterministic (seeded rng only, no I/O).

**Goal:** Residents must actually survive. Food is eaten, winter burns wood and stops regrowth, hunger interrupts plans, starvation kills, houses gate immigration. The loop accumulate → consume → scarcity → response runs continuously, so plans always have a reason.

**Reference loops (design rationale):**
- *Banished*: population × per-day consumption vs seasonal production; the town's health is "how many days of food are stored".
- *RimWorld*: needs (hunger/rest) as gauges that INTERRUPT plans when critical — interruptions create visible stories.
- *Don't Starve*: hunger as a clock that never stops; winter as a hard gate that repurposes autumn into preparation.
- *Song of Syx*: the single dramatic question "will the stores last the winter?".
- Anti-death-spiral: generous initial tuning, emergency foraging path, regrowth outside winter, immigration to recover population. Death must be possible but not the default outcome of average play.

## Balance constants (all in `packages/shared/src/constants.ts` — single source of tuning)

```ts
export const DAYS_PER_SEASON = 2;
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const; // year = 8 days = ~32 real minutes
export const HUNGER_MAX = 100;
export const HUNGER_DECAY_PER_DAY = 50;      // full → starving in 2 days without eating
export const HUNGER_EAT_THRESHOLD = 40;      // engine interrupt below this
export const FOOD_PER_MEAL = 5;
export const HUNGER_PER_MEAL = 60;
export const FATIGUE_MAX = 100;
export const FATIGUE_DECAY_PER_DAY = 60;
export const FATIGUE_REST_THRESHOLD = 25;
export const FATIGUE_SLOWDOWN = 0.5;         // work/move speed multiplier when fatigue < threshold
export const HEALTH_MAX = 100;
export const STARVATION_HEALTH_PER_DAY = 25; // ~4 days of grace at hunger 0
export const COLD_HEALTH_PER_DAY = 15;       // winter with no wood to burn
export const WOOD_BURN_PER_AGENT_PER_DAY = 2; // winter only
export const BERRY_REGROWTH_PER_DAY = 4;     // per food tile, spring/summer/autumn only, cap at initial amount
export const TREE_REGROWTH_PER_DAY = 1;      // per depleted forest tile, cap 30
export const HOUSE_WOOD_COST = 15;
export const HOUSE_BUILD_TICKS = 400;
export const HOUSE_CAPACITY = 2;
export const IMMIGRATION_FOOD_DAYS_MIN = 4;  // arrive on spring morning if stored food ≥ 4 days AND free housing
export const MAX_POPULATION = 10;
```

Derived helpers in shared (`time.ts`): `dayOfTick(tick)`, `seasonOfTick(tick)`, `isWinter(tick)`, `foodDaysRemaining(worldState)` (stored food ÷ current population daily need).

## Task M3a-1: Needs & calendar plumbing

**Files:** shared `constants.ts` + new `time.ts` (+tests), `world.ts` (`AgentState.hunger/fatigue/health: number`; `WorldState.deaths: {name: string; tick: number; cause: "starvation" | "cold"}[]`), worldGen init (full gauges), engine: per-tick gauge decay (per-tick amounts derived from per-day constants; no death yet), protocol fixture update.
**Tests:** decay over one day matches constants within rounding; season/day helpers; foodDaysRemaining.
**Branch/commit:** `m3a-1-needs-calendar` / `feat(sim): hunger fatigue health gauges and season calendar`

## Task M3a-2: Eating, foraging, starvation, death

**Files:** shared `world.ts` (AgentTask adds `{kind:"eat"}` and `{kind:"forage"; target: Position}`), executor (eat: at/adjacent stockpile, consumes FOOD_PER_MEAL from stockpile, +HUNGER_PER_MEAL, 10 ticks; forage: at food tile, eats directly, slower — 30 ticks, +HUNGER_PER_MEAL, depletes tile by FOOD_PER_MEAL), engine:
- Hunger interrupt: hunger < HUNGER_EAT_THRESHOLD and current head task is not eat/forage → PREPEND eat (stockpile has food) else forage nearest food tile (exists) else continue.
- Starvation: hunger 0 → health −STARVATION_HEALTH_PER_DAY (per-tick derived). health 0 → agent removed from world.agents, entry appended to world.deaths.
- FakePlanner: eat when hungry, keep food target proportional to population (replace fixed STOCKPILE_TARGET_FOOD usage with `population * days` heuristic — keep constant as base).
**Tests:** meal math; interrupt prepends exactly once; agent with no food anywhere starves and dies at the deterministic tick; well-fed agent survives 3 simulated days; death removes agent and records cause.
**Branch/commit:** `m3a-2-eat-starve` / `feat(sim): eating foraging starvation and death`

## Task M3a-3: Seasons bite — regrowth, winter wood burn, cold

**Files:** engine (daily hooks: berry regrowth non-winter, tree regrowth, winter wood burn = population × WOOD_BURN_PER_AGENT_PER_DAY deducted from stockpile at day start; insufficient wood → all agents take COLD_HEALTH_PER_DAY that day), worldGen (unchanged), FakePlanner (wood target proportional to population for winter).
**Tests:** regrowth caps and winter pause; wood burn deducts exactly; cold damage only when wood short; a prepared colony (stocked wood+food) survives a full year deterministically; an unprepared one loses health in winter.
**Branch/commit:** `m3a-3-seasons` / `feat(sim): seasonal regrowth winter wood burn and cold`

## Task M3a-4: Houses, rest, immigration

**Files:** shared `world.ts` (`WorldState.buildings: {kind:"house"; pos: Position; progress: number; complete: boolean}[]`; AgentTask adds `{kind:"build"; pos: Position}` and `{kind:"rest"}`), executor (build: adjacent, consumes HOUSE_WOOD_COST from stockpile at start — reject if short, progress += per tick, complete at HOUSE_BUILD_TICKS; rest: at any complete house — or stockpile if no house — restores fatigue over time), engine (fatigue < threshold applies FATIGUE_SLOWDOWN to move/gather tick progress; spring day-1 morning: if foodDaysRemaining ≥ IMMIGRATION_FOOD_DAYS_MIN and housing capacity (houses × HOUSE_CAPACITY) > population and population < MAX_POPULATION → spawn one new agent near stockpile with a name from a fixed pool ["Dahlia","Elm","Fern","Gorse","Hazel","Iris","Juniper"] in order), FakePlanner (build a house when wood ≥ cost + winter reserve and capacity ≤ population; rest when tired).
**Tests:** build lifecycle incl. insufficient-wood rejection; rest restores; slowdown applies; immigration triggers exactly on the boundary conditions and respects MAX_POPULATION; new agent has full gauges and fake planner state.
**Branch/commit:** `m3a-4-houses-immigration` / `feat(sim): houses rest and immigration`

## Task M3a-5: LLM planner knows the stakes

**Files:** llm `planPrompt.ts` (add: today's day/season and days until winter; food stored + days-remaining forecast; wood stored vs winter need forecast; own hunger/fatigue/health; population vs housing; new actions eat/forage/build/rest with when-to-use notes; persona line gains "you must survive the winter"), `planSchema.ts` (validate new task kinds incl. build affordability and positions), thoughtBroker (also trigger a replan when an agent's hunger crosses the eat threshold — cooldown still applies), config: `LLM_AGENTS` env = comma names or "all" (default "all" under dev-llm; keep single-flight).
**Tests:** prompt contains forecasts; new kinds validated; broker hunger-trigger.
**Branch/commit:** `m3a-5-llm-survival` / `feat(llm): survival-aware prompts validation and triggers`

## Task M3a-6: Survival UI

**Files:** client — HUD adds day/season badge and "food: Nd / wood: winter-ok|short" forecast; inspect panel adds hunger/fatigue/health bars; house sprite (tiny-town building tiles) with construction state (semi-transparent until complete); death: tombstone marker sprite at death position for one day + event line in a minimal top-center ticker ("Ash starved, day 7"); population count in HUD.
**Tests:** view-model formatting for forecasts and bars (pure logic only).
**Branch/commit:** `m3a-6-survival-ui` / `feat(client): survival hud needs bars houses and death markers`

## Task M3a-7 (SUPERVISOR-RUN): Full-year balance smoke

- `just dev-llm` with all-LLM agents; observe one full year (~32 min real). Acceptance: colony survives an average year with visible autumn preparation behavior; at least one hunger interrupt occurs; if tuning fails (mass death or zero tension), adjust constants ONLY (they live in one file) and re-run. Then update README gameplay section, memory, and deploy public build.

## Order

M3a-1 → M3a-2 → M3a-3 → M3a-4 sequential (all touch engine/executor). M3a-5 and M3a-6 in parallel after M3a-4 (server-llm vs client, separate worktrees). M3a-7 last.
