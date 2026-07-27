import {
  NATION_TICKS_PER_SEASON,
  NATION_TICKS_PER_YEAR,
  type NationState,
} from "@agent-town/shared";

import { generateWorldHistory } from "../src/sim/historyGen.js";
import { bootstrapNations } from "../src/sim/nation/bootstrap.js";
import { advanceNationEngine, type NationEngineState } from "../src/sim/nation/engine.js";

const SMOKE_SEED = 42;
const SMOKE_YEARS = 20;
const REPORT_INTERVAL_YEARS = 5;
const MINIMUM_FINAL_PROSPERITY_SPREAD = 0.15;

interface ProsperitySnapshot {
  year: number;
  totals: Map<string, number>;
}

interface StockPeaks {
  food: number;
  materials: number;
  wealth: number;
}

function rankedNations(nations: readonly NationState[]): NationState[] {
  return nations.toSorted(
    (left, right) =>
      right.prosperity.total - left.prosperity.total || left.id.localeCompare(right.id),
  );
}

function updateStockPeaks(peaks: StockPeaks, nation: NationState): void {
  peaks.food = Math.max(peaks.food, nation.stocks.food);
  peaks.materials = Math.max(peaks.materials, nation.stocks.materials);
  peaks.wealth = Math.max(peaks.wealth, nation.stocks.wealth);
}

function validateNationState(nation: NationState): void {
  if (nation.population <= 0) {
    throw new Error(`${nation.id} collapsed to zero population`);
  }

  for (const [stock, amount] of Object.entries(nation.stocks)) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`${nation.id} has invalid ${stock} stock: ${amount}`);
    }
  }
}

function printProsperityTable(
  snapshots: readonly ProsperitySnapshot[],
  nations: readonly NationState[],
  names: ReadonlyMap<string, string>,
): void {
  const yearHeaders = snapshots.map(({ year }) => `Year ${year}`);
  console.log(`| Nation | ${yearHeaders.join(" | ")} |`);
  console.log(`| --- | ${yearHeaders.map(() => "---:").join(" | ")} |`);
  for (const nation of nations) {
    const totals = snapshots.map(({ totals }) => totals.get(nation.id)?.toFixed(2) ?? "missing");
    console.log(`| ${names.get(nation.id) ?? nation.id} | ${totals.join(" | ")} |`);
  }
}

const history = generateWorldHistory(SMOKE_SEED);
let state: NationEngineState = {
  tick: 0,
  nations: bootstrapNations(history, null),
};
const polityNames = new Map(history.polities.map(({ id, name }) => [id, name]));
const snapshots: ProsperitySnapshot[] = [];
const stockPeaks: StockPeaks = { food: 0, materials: 0, wealth: 0 };
let leader = rankedNations(state.nations)[0]?.id;
let leadershipChanges = 0;

if (state.nations.some(({ autoPilot }) => !autoPilot)) {
  throw new Error("all smoke-run nations must start on auto-pilot");
}

for (let tick = 1; tick <= NATION_TICKS_PER_YEAR * SMOKE_YEARS; tick += 1) {
  state = advanceNationEngine(state, history, []).state;
  if (state.tick % NATION_TICKS_PER_SEASON !== 0) continue;

  for (const nation of state.nations) {
    validateNationState(nation);
    updateStockPeaks(stockPeaks, nation);
  }

  const nextLeader = rankedNations(state.nations)[0]?.id;
  if (leader !== undefined && nextLeader !== undefined && nextLeader !== leader) {
    leadershipChanges += 1;
  }
  leader = nextLeader;

  if (state.tick % (NATION_TICKS_PER_YEAR * REPORT_INTERVAL_YEARS) === 0) {
    snapshots.push({
      year: state.tick / NATION_TICKS_PER_YEAR,
      totals: new Map(state.nations.map((nation) => [nation.id, nation.prosperity.total])),
    });
  }
}

const finalRanking = rankedNations(state.nations);
const topProsperity = finalRanking[0]?.prosperity.total;
const bottomProsperity = finalRanking.at(-1)?.prosperity.total;
if (topProsperity === undefined || bottomProsperity === undefined || bottomProsperity <= 0) {
  throw new Error("cannot calculate the final prosperity spread");
}
const finalProsperitySpread = (topProsperity - bottomProsperity) / bottomProsperity;

printProsperityTable(snapshots, state.nations, polityNames);
console.log(`Leadership changes: ${leadershipChanges}`);
console.log(`Final prosperity spread: ${(finalProsperitySpread * 100).toFixed(2)}%`);
console.log(
  `Peak stocks: food=${stockPeaks.food.toFixed(2)}, materials=${stockPeaks.materials.toFixed(2)}, wealth=${stockPeaks.wealth.toFixed(2)}`,
);

if (leadershipChanges === 0) {
  throw new Error("prosperity leadership never changed hands");
}
if (finalProsperitySpread < MINIMUM_FINAL_PROSPERITY_SPREAD) {
  throw new Error("final prosperity spread is below 15%");
}
