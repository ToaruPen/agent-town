import type {
  NationState,
  NationWorldState,
  Polity,
  SeasonLedgerEntry,
  SeasonReport,
  WorldHistory,
} from "@agent-town/shared";

/**
 * Hand-built nation state for the HUD view models, following `worldMapFixture.ts` and
 * `spatialFixture.ts`. Values sit in the ranges the live server was measured to produce at seed 12345
 * — population 10.5k–15.1k, stability 67–72, culture 46–58, stocks fractional — so a layout that
 * holds these holds the real thing rather than round numbers.
 */
export function polityFixture(overrides: Partial<Polity> = {}): Polity {
  return {
    id: "polity-1",
    name: "ヴェルディン侯国",
    adjective: "ヴェルディンの",
    color: 0xd7864b,
    values: [],
    foundingMyth: "",
    formativeTraumaEventIds: [],
    taboo: "",
    ambition: "",
    governance: "",
    ...overrides,
  };
}

export function nationFixture(overrides: Partial<NationState> = {}): NationState {
  return {
    id: "polity-1",
    controller: "player",
    autoPilot: true,
    stocks: { food: 1949.8451999999997, materials: 590.5, wealth: 1960 },
    cities: [{ cityId: "city-polity-1-1", population: 4_200, developmentLevel: 2 }],
    territoryCellCount: 240,
    population: 10_507,
    stability: 67.4,
    culture: 46,
    foodProduction: 120,
    materialProduction: 64,
    activeDirectives: [],
    prosperity: {
      population: 0.5306,
      production: 0.5132508,
      wealth: 0.412,
      stability: 0.716,
      culture: 0.5884,
      total: 536.1327,
    },
    lastReport: null,
    ...overrides,
  };
}

export function ledgerEntry(overrides: Partial<SeasonLedgerEntry> = {}): SeasonLedgerEntry {
  return { metric: "food", delta: 0, reason: "baseProduction", directiveId: null, ...overrides };
}

export function reportFixture(overrides: Partial<SeasonReport> = {}): SeasonReport {
  return { year: 3, season: "summer", entries: [], completedDirectiveIds: [], ...overrides };
}

export function historyFixture(polities: readonly Polity[] = [polityFixture()]): WorldHistory {
  return {
    startYear: -200,
    currentYear: 1041,
    polities: [...polities],
    events: [],
    landmarks: [],
    settlementOrigin: null,
    worldMap: {
      width: 1,
      height: 1,
      cells: [{ terrain: "plains", polityId: "polity-1" }],
      cities: [],
      tradeRoutes: [],
      borderChanges: [],
      settlementFrontierPos: { x: 0, y: 0 },
    },
  };
}

export function worldFixture(overrides: Partial<NationWorldState> = {}): NationWorldState {
  return {
    tick: 0,
    year: 1,
    season: "spring",
    speed: 1,
    history: historyFixture(),
    nations: [nationFixture()],
    playerNationId: "polity-1",
    ...overrides,
  };
}
