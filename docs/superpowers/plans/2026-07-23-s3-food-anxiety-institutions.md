# Food Anxiety, Collectives, and Institutions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic causal loop from food anxiety through problem recognition and collective formation to institution establishment, and make each milestone visible in Japanese without using an LLM.

**Architecture:** Add strict social-state contracts to `packages/shared`, calculate food-security desire and institution support in pure deterministic `packages/server/src/sim` modules, and let the existing engine own the small amount of streak memory needed for formation and dissolution. Send authoritative collectives and institutions in welcome/update messages; the client derives Japanese ticker milestones and inspect-panel rows through pure view-model functions and never decides simulation outcomes.

**Tech Stack:** TypeScript 7, Vitest, PixiJS 8, WebSocket, Vite, Biome, pnpm, just

---

## Scope

This plan implements item 3 of §16 in
`docs/superpowers/specs/2026-07-23-emergent-fantasy-society-design.md`
only:

```text
food anxiety
  -> problem recognition
  -> sustained support
  -> collective
  -> institution proposal
  -> established institution
```

The slice is complete when the same seed and state produce the same desires,
support scores, collectives, dissolutions, institutions, provenance, and client
milestones.

The following are explicitly out of scope:

- granary construction or any other building requested by an institution;
- paths or traffic accumulation;
- the causal inspector and navigation through provenance;
- indirect player intervention;
- LLM calls, LLM preference selection, naming, speeches, or narration;
- changes to the existing history generator beyond reading its settlement
  origin and formative trauma IDs;
- new dependencies, fonts, images, or other assets.

The only names in this slice are deterministic placeholders from a fixed shared
table:

| Institution kind | Japanese name |
|---|---|
| `communalGranaryStore` | `共同備蓄` |
| `grainMarket` | `私的取引` |
| `rationControl` | `配給統制` |

All other player-visible strings introduced by this plan are also Japanese.

## Frozen Contracts

Do not rename, make optional, or add fields to these contracts while executing
this plan. `AgentDesires` remains open to later numeric desires, but this slice
only reads and writes `foodSecurity`.

```ts
export type AgentId = string;
export type EventId = string;

export interface AgentDesires extends Record<string, number> {
  foodSecurity: number;
}

export type InstitutionKind =
  | "communalGranaryStore"
  | "grainMarket"
  | "rationControl";

export interface Provenance {
  causedByEventIds: EventId[];
  proposedByAgentIds: AgentId[];
  supportedByAgentIds: AgentId[];
  opposedByAgentIds: AgentId[];
  decidedAtTick: number;
}

export interface Collective {
  id: string;
  purpose: InstitutionKind;
  supporterIds: AgentId[];
  representativeId: AgentId;
  cohesion: number;
  formedAtTick: number;
  provenance: Provenance;
}

export interface Institution {
  id: string;
  kind: InstitutionKind;
  supporterIds: AgentId[];
  opposedIds: AgentId[];
  establishedAtTick: number;
  provenance: Provenance;
}
```

`Provenance` is the §8.1 contract: `causedByEventIds`,
`proposedByAgentIds`, `supportedByAgentIds`, `opposedByAgentIds`, and
`decidedAtTick` have exactly the meanings specified there. `causedByEventIds`
may include the settlement departure event and formative trauma events from
the homeland polity. Every included ID must resolve in `WorldHistory.events`.

`AgentState` gains these required fields:

```ts
desires: AgentDesires;
lastHungerInterruptTick: number | null;
```

`WorldState` gains these required fields:

```ts
collectives: Collective[];
institutions: Institution[];
```

Values stored in `AgentDesires.foodSecurity` and `Collective.cohesion` must be
finite and clamped to the inclusive range `0..1`. Supporter, opponent, cause,
and proposer arrays must be deduplicated and sorted by ID before they enter
authoritative state.

## Constants and Deterministic Rules

All thresholds, durations, labels, candidate order, affinities, and weights
belong in `packages/shared/src/constants.ts`. No numeric rule from this table
may be inlined in `server/sim` or the client.

```ts
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
```

The food-security target is the clamped weighted sum of:

1. food shortage: `1 - foodDaysRemaining / FOOD_SECURITY_SAFE_FOOD_DAYS`;
2. winter proximity: `1 - daysUntilWinter / FOOD_SECURITY_WINTER_LOOKAHEAD_DAYS`;
3. recent hunger history: `1` when the most recent hunger interrupt is inside
   `FOOD_SECURITY_HUNGER_MEMORY_TICKS`, otherwise `0`.

Each input is clamped to `0..1` before weighting. Each scheduled update moves
`foodSecurity` toward the target by at most
`FOOD_SECURITY_MAX_CHANGE_PER_UPDATE`; it does not jump directly.

Candidate cultural affinity is the weighted mean of the homeland polity's
`CulturalValueWeight.weight` values against the candidate affinity table.
Missing history or an empty value list produces cultural affinity `0`.

```text
support =
  cultural affinity * INSTITUTION_CULTURE_WEIGHT
  + foodSecurity * INSTITUTION_DESIRE_WEIGHT
```

The result is clamped to `0..1`. No random draw breaks ties. Sort equal support
by `agent.id`, and iterate candidate kinds in `INSTITUTION_KINDS` order.

## File Responsibilities

| File | Responsibility |
|---|---|
| `packages/shared/src/society.ts` | Frozen desire, collective, institution, and provenance contracts |
| `packages/shared/src/constants.ts` | Candidate order/names/affinities and every threshold, duration, and weight |
| `packages/shared/src/world.ts` | Required social fields in authoritative agent and world state |
| `packages/shared/src/protocol.ts` | Welcome/update transport and required-key validation |
| `packages/shared/src/index.ts` | Public export of social contracts |
| `packages/server/src/sim/foodAnxiety.ts` | Pure forecast pressure, desire update, cultural affinity, and support scoring |
| `packages/server/src/sim/society.ts` | Pure deterministic collective lifecycle and institution establishment |
| `packages/server/src/sim/engine.ts` | Tick ordering, hunger-interrupt recording, and private streak-memory ownership |
| `packages/server/src/sim/worldGen.ts` | Initial and immigrant social state |
| `packages/server/src/net/wsServer.ts` | Authoritative collectives/institutions in update messages |
| `packages/client/src/ui/societyViewModel.ts` | Pure Japanese inspect rows and queued milestone notifications |
| `packages/client/src/ui/inspectPanel.ts` | Render the selected resident plus current collectives/institutions |
| `packages/client/src/render/tickerLayer.ts` | Generic top-ticker rendering for death and social messages |
| `packages/client/src/render/deathLayer.ts` | Death markers only after ticker rendering is extracted |
| `packages/client/src/main.ts` | Schedule/view-model wiring; no social decisions |
| `packages/client/index.html` | Minimal styles for the social section in the existing inspect panel |

## Task 1: Define Shared Social and Wire Contracts

**Branch:** `s3-food-anxiety-01-contracts` from `main`

**Commit:** `feat(shared): define food anxiety social contracts`

**Files:**
- Create: `packages/shared/src/society.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/world.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/server/src/sim/engine.ts`
- Modify: `packages/server/src/sim/worldGen.ts`
- Modify: `packages/server/src/net/wsServer.ts`
- Modify: `packages/client/src/net/wsClient.ts`
- Modify protocol fixtures: `packages/shared/test/protocol.test.ts`, `packages/client/test/wsClient.test.ts`, `packages/server/test/wsServer.test.ts`
- Modify `WorldState` fixtures: `packages/shared/test/time.test.ts`, `packages/client/test/infoBubble.test.ts`, `packages/client/test/keyboardNavigation.test.ts`, `packages/client/test/survivalViewModel.test.ts`, `packages/server/test/astar.test.ts`, `packages/server/test/executor.test.ts`, `packages/server/test/fakePlanner.test.ts`, `packages/server/test/llmPlanner.test.ts`, `packages/server/test/normalizePlan.test.ts`, `packages/server/test/planPrompt.test.ts`, `packages/server/test/planSchema.test.ts`
- Modify `AgentState` fixtures: `packages/client/test/infoBubble.test.ts`, `packages/client/test/inspectPanel.test.ts`, `packages/client/test/keyboardNavigation.test.ts`, `packages/client/test/sprites.test.ts`, `packages/client/test/survivalViewModel.test.ts`, `packages/client/test/wsClient.test.ts`, `packages/server/test/engine.test.ts`, `packages/server/test/executor.test.ts`, `packages/server/test/fakePlanner.test.ts`, `packages/server/test/llmAgentSelection.test.ts`, `packages/server/test/llmPlanner.test.ts`, `packages/server/test/llmProviderRouting.test.ts`, `packages/server/test/normalizePlan.test.ts`, `packages/server/test/planPrompt.test.ts`, `packages/server/test/planSchema.test.ts`, `packages/server/test/thoughtBroker.test.ts`

- [ ] **Step 1: Add failing welcome and update fixture expectations**

In `packages/shared/test/protocol.test.ts`, extend the welcome fixture's agent
with:

```ts
desires: { foodSecurity: 0.72 },
lastHungerInterruptTick: 120,
```

Add one collective and one institution to the `WorldState` fixture:

```ts
collectives: [
  {
    id: "collective-communalGranaryStore-150",
    purpose: "communalGranaryStore",
    supporterIds: ["agent-1", "agent-2"],
    representativeId: "agent-1",
    cohesion: 0.78,
    formedAtTick: 150,
    provenance: {
      causedByEventIds: ["event-scarcity-1"],
      proposedByAgentIds: ["agent-1"],
      supportedByAgentIds: ["agent-1", "agent-2"],
      opposedByAgentIds: [],
      decidedAtTick: 150,
    },
  },
],
institutions: [
  {
    id: "institution-communalGranaryStore-200",
    kind: "communalGranaryStore",
    supporterIds: ["agent-1", "agent-2"],
    opposedIds: [],
    establishedAtTick: 200,
    provenance: {
      causedByEventIds: ["event-scarcity-1"],
      proposedByAgentIds: ["agent-1"],
      supportedByAgentIds: ["agent-1", "agent-2"],
      opposedByAgentIds: [],
      decidedAtTick: 200,
    },
  },
],
```

Add an update round-trip test whose update contains the same two arrays and
whose decoded result is deeply equal to the encoded message. Add rejection
tests for an update missing `collectives` and an update missing `institutions`.

- [ ] **Step 2: Run the shared contract test to verify Red**

Run:

```sh
pnpm vitest run packages/shared/test/protocol.test.ts
```

Expected: FAIL because the social types and update fields do not exist.

- [ ] **Step 3: Add the frozen shared contracts and constants**

Create `packages/shared/src/society.ts` with the exact declarations in
**Frozen Contracts**. Add the exact declarations in **Constants and
Deterministic Rules** to `packages/shared/src/constants.ts`, using type-only
imports for `CulturalValue` and `InstitutionKind`.

Export the new module:

```ts
export * from "./society.js";
```

Do not add a dependency and do not add labels in the client or simulation.
The shared fixed table is the only owner of institution placeholder names.

- [ ] **Step 4: Make agent and world social state required**

In `packages/shared/src/world.ts`, import `AgentDesires`, `Collective`, and
`Institution` as types. Add the required agent fields immediately after
`lastThought`, and add the required world arrays immediately before
`history`.

In every listed `AgentState` fixture add:

```ts
desires: { foodSecurity: 0 },
lastHungerInterruptTick: null,
```

In every listed `WorldState` fixture add:

```ts
collectives: [],
institutions: [],
```

Add the same empty arrays to the object returned by `generateWorld` in
`packages/server/src/sim/worldGen.ts`.

In both `createAgents` in `packages/server/src/sim/worldGen.ts` and the
immigrant object in `packages/server/src/sim/engine.ts`, initialize:

```ts
desires: { foodSecurity: 0 },
lastHungerInterruptTick: null,
```

Do not use optional fields or fixture casts to bypass the migration.

- [ ] **Step 5: Extend update transport and runtime required-key checks**

Add the two authoritative arrays to the update variant in
`packages/shared/src/protocol.ts`:

```ts
collectives: WorldState["collectives"];
institutions: WorldState["institutions"];
```

Add both names to the update `hasRequiredKeys` list. Welcome already transports
the complete `WorldState`; extend its required-key check from only `history` to
`["history", "collectives", "institutions"]`.

In `packages/server/src/net/wsServer.ts`, add:

```ts
collectives: engine.world.collectives,
institutions: engine.world.institutions,
```

In `packages/client/src/net/wsClient.ts`, apply both update fields:

```ts
collectives: message.collectives,
institutions: message.institutions,
```

Update `packages/client/test/wsClient.test.ts` and
`packages/server/test/wsServer.test.ts` so a non-empty update proves both
arrays survive the server message and replace the client's prior arrays.

- [ ] **Step 6: Run focused tests and repository-wide type checks**

Run:

```sh
pnpm vitest run packages/shared/test/protocol.test.ts packages/client/test/wsClient.test.ts packages/server/test/wsServer.test.ts
pnpm -r exec tsc
```

Expected: focused tests PASS and TypeScript errors 0.

- [ ] **Step 7: Verify fixture ownership and the full pre-commit gate**

Run:

```sh
rg -n 'desires:|lastHungerInterruptTick:|collectives:|institutions:' packages --glob '*.ts'
git diff --check
just check && just test
```

Expected: every full agent/world fixture owns the new required fields, no
unrelated files changed, no whitespace errors, and both gates PASS.

- [ ] **Step 8: Commit Task 1**

```sh
git add packages/shared packages/client/src/net/wsClient.ts packages/client/test packages/server/src/net/wsServer.ts packages/server/src/sim/engine.ts packages/server/src/sim/worldGen.ts packages/server/test
git commit -m "feat(shared): define food anxiety social contracts"
```

## Task 2: Update Food-Security Desire and Score Three Institution Candidates

**Branch:** `s3-food-anxiety-02-desire` from the Task 1 commit

**Commit:** `feat(sim): derive food anxiety and institution support`

**Files:**
- Create: `packages/server/src/sim/foodAnxiety.ts`
- Create: `packages/server/test/foodAnxiety.test.ts`
- Modify: `packages/server/src/sim/engine.ts`
- Modify: `packages/server/test/engine.test.ts`
- Modify: `packages/server/test/worldGen.test.ts`

- [ ] **Step 1: Write failing tests for §13.4 desire updates**

Create `packages/server/test/foodAnxiety.test.ts`. Use `generateWorld(42)` as
the fixture source and replace the homeland values in the test when a specific
culture is required.

Cover these exact cases:

```ts
it("raises food security from shortage, approaching winter, and a recent hunger interrupt", () => {
  const world = generateWorld(42);
  const agent = world.agents[0]!;
  world.stockpile.food = 0;
  world.tick = 6 * TICKS_PER_DAY - FOOD_SECURITY_UPDATE_INTERVAL_TICKS;
  agent.desires.foodSecurity = 0;
  agent.lastHungerInterruptTick = world.tick - 1;

  updateFoodSecurityDesire(world, agent);

  expect(agent.desires.foodSecurity).toBe(FOOD_SECURITY_MAX_CHANGE_PER_UPDATE);
});

it("decays food security when stores are safe, winter is distant, and hunger is not recent", () => {
  const world = generateWorld(42);
  const agent = world.agents[0]!;
  world.stockpile.food = 10_000;
  world.tick = 0;
  agent.desires.foodSecurity = 0.6;
  agent.lastHungerInterruptTick = null;

  updateFoodSecurityDesire(world, agent);

  expect(agent.desires.foodSecurity).toBeCloseTo(
    0.6 - FOOD_SECURITY_MAX_CHANGE_PER_UPDATE,
  );
});

it("expires hunger history at the configured boundary", () => {
  expect(isRecentHungerInterrupt(100, 100 - FOOD_SECURITY_HUNGER_MEMORY_TICKS)).toBe(true);
  expect(isRecentHungerInterrupt(101, 100 - FOOD_SECURITY_HUNGER_MEMORY_TICKS)).toBe(false);
});
```

Also test `daysUntilWinter` at spring start, the tick immediately before
winter, winter start, and next spring. Test `Number.POSITIVE_INFINITY` from the
food forecast as zero shortage pressure and verify every returned desire is
finite and inside `0..1`.

- [ ] **Step 2: Write failing candidate-order and support tests**

In the same file, assert that the candidates are exactly and only the fixed
three:

```ts
expect(INSTITUTION_KINDS).toEqual([
  "communalGranaryStore",
  "grainMarket",
  "rationControl",
]);
```

For a culture containing only `mutualAid` weight `1`, assert
`communalGranaryStore` scores above the other candidates. For a culture
containing only `commerce`, assert `grainMarket` is first. For only `order`,
assert `rationControl` is first.

Assert the formula itself:

```ts
expect(
  institutionSupportScore("communalGranaryStore", [{
    value: "mutualAid",
    weight: 1,
    changedByEventIds: [],
  }], { foodSecurity: 0.5 }),
).toBeCloseTo(
  INSTITUTION_CULTURE_WEIGHT + 0.5 * INSTITUTION_DESIRE_WEIGHT,
);
```

Run the same input twice and expect deep equality. Do not test a random
distribution; no random number belongs in this module.

- [ ] **Step 3: Run the focused tests to verify Red**

Run:

```sh
pnpm vitest run packages/server/test/foodAnxiety.test.ts
```

Expected: FAIL because `foodAnxiety.ts` does not exist.

- [ ] **Step 4: Implement the pure food-anxiety module**

Create `packages/server/src/sim/foodAnxiety.ts` with these exports:

```ts
export interface InstitutionSupport {
  kind: InstitutionKind;
  score: number;
  supports: boolean;
  opposes: boolean;
}

export function daysUntilWinter(tick: number): number;

export function isRecentHungerInterrupt(
  tick: number,
  lastHungerInterruptTick: number | null,
): boolean;

export function updateFoodSecurityDesire(
  world: WorldState,
  agent: AgentState,
): void;

export function institutionSupportScore(
  kind: InstitutionKind,
  culture: CulturalValueWeight[],
  desires: AgentDesires,
): number;

export function institutionSupportForAgent(
  world: WorldState,
  agent: AgentState,
): InstitutionSupport[];

export function updateFoodSecurityDesires(world: WorldState): void;
```

Use small private helpers for finite `0..1` clamping, food pressure, winter
pressure, and homeland lookup. Resolve culture through:

```text
WorldHistory.settlementOrigin.homelandPolityId
  -> WorldHistory.polities[].id
  -> Polity.values
```

If any link is absent, use an empty value list and cultural affinity `0`.
Normalize the weighted affinity by the sum of positive cultural weights; do
not treat a polity with more recorded values as automatically stronger.

`updateFoodSecurityDesires` must return immediately unless:

```ts
world.tick % FOOD_SECURITY_UPDATE_INTERVAL_TICKS === 0
```

Iterate the current `world.agents` array in order and mutate only each agent's
`desires.foodSecurity`. The module must not import from `net/`, `llm/`, Node,
or browser APIs.

- [ ] **Step 5: Record real hunger interrupts and schedule desire updates**

Change `maybeInterruptForHunger` to return `true` only when it actually
prepends a new `eat` or `forage` task. In `advanceAgent`, record the tick only
on that transition:

```ts
if (maybeInterruptForHunger(world, agent)) {
  agent.lastHungerInterruptTick = world.tick;
}
```

Do not update the timestamp every tick while an existing hunger task remains
at the queue head.

After all agents advance and after `world.tick += 1`, call:

```ts
updateFoodSecurityDesires(world);
```

This ordering makes the desire snapshot correspond to the completed
authoritative tick and includes hunger interrupts observed during that step.

- [ ] **Step 6: Add focused engine integration tests**

In `packages/server/test/engine.test.ts`, add:

1. a resident below `HUNGER_EAT_THRESHOLD` records the current tick once when
   an `eat` task is inserted;
2. the timestamp does not change on the next tick while the same hunger task
   remains active;
3. food-security desire changes only on
   `FOOD_SECURITY_UPDATE_INTERVAL_TICKS` boundaries.

In `packages/server/test/worldGen.test.ts`, assert every initial resident has:

```ts
expect(agent.desires).toEqual({ foodSecurity: 0 });
expect(agent.lastHungerInterruptTick).toBeNull();
```

Extend the existing immigration test in `packages/server/test/engine.test.ts`
with the same expectations for the new resident.

- [ ] **Step 7: Run focused tests, static checks, and the full gate**

Run:

```sh
pnpm vitest run packages/server/test/foodAnxiety.test.ts packages/server/test/engine.test.ts packages/server/test/worldGen.test.ts
pnpm biome check packages/server/src/sim/foodAnxiety.ts packages/server/src/sim/engine.ts packages/server/test/foodAnxiety.test.ts
git diff --check
just check && just test
```

Expected: focused tests PASS, Biome errors 0, no whitespace errors, and both
repository gates PASS.

- [ ] **Step 8: Commit Task 2**

```sh
git add packages/server/src/sim packages/server/test
git commit -m "feat(sim): derive food anxiety and institution support"
```

## Task 3: Form, Dissolve, and Institutionalize Collectives

**Branch:** `s3-food-anxiety-03-institutions` from the Task 2 commit

**Commit:** `feat(sim): form collectives and establish institutions`

**Files:**
- Create: `packages/server/src/sim/society.ts`
- Create: `packages/server/test/society.test.ts`
- Modify: `packages/server/src/sim/engine.ts`
- Modify: `packages/server/test/engine.test.ts`
- Modify: `packages/server/test/wsServer.test.ts`

- [ ] **Step 1: Write failing collective formation and dissolution tests**

Create `packages/server/test/society.test.ts`. Define a helper that starts from
`generateWorld(42)`, sets each resident's `foodSecurity` to `1`, and sets the
homeland culture to one `mutualAid` value of weight `1`.

Drive the pure social step only at `SOCIETY_UPDATE_INTERVAL_TICKS` boundaries.
Before `COLLECTIVE_FORMATION_TICKS` of sustained support, expect no
collective. At the boundary, expect:

```ts
expect(world.collectives).toEqual([
  expect.objectContaining({
    id: `collective-communalGranaryStore-${world.tick}`,
    purpose: "communalGranaryStore",
    supporterIds: ["agent-1", "agent-2", "agent-3"],
    representativeId: "agent-1",
    formedAtTick: world.tick,
  }),
]);
expect(world.collectives[0]?.cohesion).toBeGreaterThanOrEqual(0);
expect(world.collectives[0]?.cohesion).toBeLessThanOrEqual(1);
```

Then set safe food, set all `foodSecurity` values to `0`, and advance for
`COLLECTIVE_DISSOLUTION_TICKS`. Assert the collective remains one interval
before the boundary and is removed exactly at the boundary.

Add a reset case: support sustained for one interval less than formation,
drops for one interval, then rises again. Formation must require the complete
configured duration after the reset.

- [ ] **Step 2: Write failing institution pressure/support/provenance tests**

Add a helper that inserts a valid majority collective. Cover all four cells of
the gate:

| Majority support | Food days below pressure threshold | Result |
|---|---|---|
| no | no | no institution |
| yes | no | no institution |
| no | yes | no institution |
| yes | yes | one institution |

Use strict majority:

```ts
supporterIds.length > world.agents.length / 2
```

At establishment, assert:

```ts
expect(institution).toEqual({
  id: `institution-communalGranaryStore-${world.tick}`,
  kind: "communalGranaryStore",
  supporterIds: ["agent-1", "agent-2"],
  opposedIds: ["agent-3"],
  establishedAtTick: world.tick,
  provenance: {
    causedByEventIds: expect.arrayContaining([
      world.history.settlementOrigin!.departureEventId,
    ]),
    proposedByAgentIds: [collective.representativeId],
    supportedByAgentIds: ["agent-1", "agent-2"],
    opposedByAgentIds: ["agent-3"],
    decidedAtTick: world.tick,
  },
});
```

Resolve every `causedByEventIds` entry against `world.history.events`. Assert a
second step does not establish a duplicate institution of the same kind.

- [ ] **Step 3: Write the deterministic replay test**

In `packages/server/test/engine.test.ts`, build two separate worlds with the
same seed, set the same homeland culture and zero food, create two engines with
the same idle planner and seeded RNG, and run both for enough ticks to pass
formation.

Compare only authoritative outcomes:

```ts
expect({
  agents: first.world.agents.map(({ id, desires, lastHungerInterruptTick }) => ({
    id,
    desires,
    lastHungerInterruptTick,
  })),
  collectives: first.world.collectives,
  institutions: first.world.institutions,
}).toEqual({
  agents: second.world.agents.map(({ id, desires, lastHungerInterruptTick }) => ({
    id,
    desires,
    lastHungerInterruptTick,
  })),
  collectives: second.world.collectives,
  institutions: second.world.institutions,
});
```

Assert at least one collective and one institution exist so an empty-state
comparison cannot satisfy the determinism requirement accidentally.

- [ ] **Step 4: Run the new tests to verify Red**

Run:

```sh
pnpm vitest run packages/server/test/society.test.ts packages/server/test/engine.test.ts
```

Expected: FAIL because `society.ts` and engine social progression do not exist.

- [ ] **Step 5: Implement explicit private streak memory**

Create `packages/server/src/sim/society.ts` with:

```ts
export interface SocietyMemory {
  supportTicks: Map<InstitutionKind, Map<AgentId, number>>;
  dissolutionTicks: Map<string, number>;
}

export function createSocietyMemory(): SocietyMemory;

export function advanceSociety(
  world: WorldState,
  memory: SocietyMemory,
): void;
```

`advanceSociety` returns immediately off a
`SOCIETY_UPDATE_INTERVAL_TICKS` boundary. On a boundary it performs these
phases in order:

1. calculate each living agent's three support records;
2. increment or reset each `(institution kind, agent ID)` support streak;
3. create a missing collective when at least
   `COLLECTIVE_MIN_SUPPORTERS` agents have a streak of
   `COLLECTIVE_FORMATION_TICKS`;
4. refresh existing collective supporters, representative, and cohesion;
5. increment/reset low-support dissolution streaks and remove collectives at
   `COLLECTIVE_DISSOLUTION_TICKS`;
6. establish eligible institutions from surviving collectives.

Clean dead or missing agent IDs from both maps each boundary. Iterate
`INSTITUTION_KINDS` and agent IDs in stable order. Build deterministic IDs only
from kind and authoritative tick; do not use RNG, dates, UUIDs, or array
lengths.

The representative is the current supporter with highest support score,
breaking ties by ascending `agent.id`. Cohesion is the arithmetic mean of the
current supporter scores, clamped to `0..1`. A collective is in a dissolution
interval when it has fewer than `COLLECTIVE_MIN_SUPPORTERS` current supporters
or cohesion is below `COLLECTIVE_DISSOLUTION_COHESION`.

- [ ] **Step 6: Build provenance from real history and current support**

Use one private provenance builder. It must:

1. find `WorldHistory.settlementOrigin.departureEventId`;
2. find the homeland polity and its `formativeTraumaEventIds`;
3. keep only IDs present in `WorldHistory.events`;
4. deduplicate and sort cause IDs;
5. deduplicate and sort proposer, supporter, and opponent IDs;
6. set `decidedAtTick` to the current world tick.

Collective provenance uses its representative as the sole proposer, its
formation supporters as supporters, and living agents below
`INSTITUTION_OPPOSITION_THRESHOLD` as opponents. Institution provenance uses
the collective representative as proposer and the exact supporter/opponent
partition at establishment.

Do not fabricate a live event ID. This slice has no new event-log contract, so
the valid departure and trauma IDs are the available long-range causes.

- [ ] **Step 7: Integrate social progression into engine order**

In `createEngine`, create one private memory object:

```ts
const societyMemory = createSocietyMemory();
```

After `world.tick += 1` and `updateFoodSecurityDesires(world)`, call:

```ts
advanceSociety(world, societyMemory);
```

Then run existing daily hooks and dirty-tile tracking. Do not expose
`SocietyMemory` through `WorldState` or the wire protocol. It is deterministic
engine bookkeeping, like existing cached simulation data, while all
player-relevant outcomes remain authoritative state.

- [ ] **Step 8: Verify update transport carries same-tick outcomes**

In `packages/server/test/wsServer.test.ts`, make a world with a collective and
institution, call `createUpdateMessage`, and assert:

```ts
expect(update).toMatchObject({
  type: "update",
  collectives: world.collectives,
  institutions: world.institutions,
});
```

Keep the existing welcome and update integration test. Do not add a second
social transport path or place simulation logic in `net/wsServer.ts`.

- [ ] **Step 9: Run §13.5/13.6 tests and the full gate**

Run:

```sh
pnpm vitest run packages/server/test/society.test.ts packages/server/test/engine.test.ts packages/server/test/wsServer.test.ts
pnpm biome check packages/server/src/sim/society.ts packages/server/src/sim/engine.ts packages/server/test/society.test.ts
rg -n 'Date|crypto|randomUUID|Math\\.random|from .*net/|from .*llm/' packages/server/src/sim/foodAnxiety.ts packages/server/src/sim/society.ts
git diff --check
just check && just test
```

Expected: desire, formation, reset, dissolution, institution gate,
provenance, wire, and replay tests PASS; the structural scan prints no
forbidden use; no whitespace errors; both repository gates PASS.

- [ ] **Step 10: Commit Task 3**

```sh
git add packages/server/src/sim packages/server/test
git commit -m "feat(sim): form collectives and establish institutions"
```

## Task 4: Show Japanese Milestones and Social State

**Branch:** `s3-food-anxiety-04-client` from the Task 3 commit

**Commit:** `feat(client): show food anxiety institutions`

**Files:**
- Create: `packages/client/src/ui/societyViewModel.ts`
- Create: `packages/client/src/render/tickerLayer.ts`
- Create: `packages/client/test/societyViewModel.test.ts`
- Modify: `packages/client/src/ui/inspectPanel.ts`
- Modify: `packages/client/src/render/deathLayer.ts`
- Modify: `packages/client/src/main.ts`
- Modify: `packages/client/index.html`
- Modify: `packages/client/test/inspectPanel.test.ts`

- [ ] **Step 1: Write failing pure view-model tests for social rows**

Create `packages/client/test/societyViewModel.test.ts` with a `WorldState`
fixture containing three Japanese-named agents, one collective, and one
institution.

Assert exact Japanese output and no raw IDs:

```ts
expect(buildSocietyViewModel(world)).toEqual({
  collectives: [
    {
      id: "collective-communalGranaryStore-150",
      name: "共同備蓄を求める集団",
      representative: "トネリコ",
      supporters: ["トネリコ", "シラカバ"],
      cohesion: "78%",
    },
  ],
  institutions: [
    {
      id: "institution-communalGranaryStore-200",
      name: "共同備蓄",
      supporters: ["トネリコ", "シラカバ"],
      opponents: ["スギ"],
    },
  ],
});
```

Add an empty-state test. For an unresolved agent ID, expect `不明な住民`
instead of exposing the ID.

- [ ] **Step 2: Write failing queued milestone tests**

The milestone schedule observes welcome state without replaying old events.
For later state transitions, assert these exact labels and order:

```ts
expect(schedule.events.map(({ kind, text }) => ({ kind, text }))).toEqual([
  { kind: "recognition", text: "危機認識：食料不安が共有され始めた" },
  { kind: "collective", text: "集団結成：共同備蓄を求める集団" },
  { kind: "proposal", text: "制度提案：共同備蓄" },
  { kind: "institution", text: "制度成立：共同備蓄" },
]);
```

Trigger the events with:

1. at least one agent crossing
   `FOOD_SECURITY_RECOGNITION_THRESHOLD` from below;
2. a new collective ID;
3. a collective crossing from at most half to strict majority support;
4. a new institution ID.

When multiple transitions arrive in one update, assert they receive
non-overlapping display windows of `SOCIAL_MILESTONE_DURATION_TICKS` in the
order above. Assert existing welcome collectives/institutions do not replay,
proposal fires once per collective, and expired events are removed.

- [ ] **Step 3: Run client view-model tests to verify Red**

Run:

```sh
pnpm vitest run packages/client/test/societyViewModel.test.ts
```

Expected: FAIL because `societyViewModel.ts` does not exist.

- [ ] **Step 4: Implement the pure Japanese social view models**

Create `packages/client/src/ui/societyViewModel.ts` with:

```ts
export interface SocietyViewModel {
  collectives: {
    id: string;
    name: string;
    representative: string;
    supporters: string[];
    cohesion: string;
  }[];
  institutions: {
    id: string;
    name: string;
    supporters: string[];
    opponents: string[];
  }[];
}

export type SocialMilestoneKind =
  | "recognition"
  | "collective"
  | "proposal"
  | "institution";

export interface SocialMilestone {
  id: string;
  kind: SocialMilestoneKind;
  text: string;
  visibleFromTick: number;
  expiresAtTick: number;
}

export interface SocialMilestoneSchedule {
  recognizedAgentIds: Set<string>;
  observedCollectiveIds: Set<string>;
  proposedCollectiveIds: Set<string>;
  observedInstitutionIds: Set<string>;
  events: SocialMilestone[];
}

export function buildSocietyViewModel(world: WorldState): SocietyViewModel;

export function createSocialMilestoneSchedule(
  state: WorldState,
): SocialMilestoneSchedule;

export function updateSocialMilestoneSchedule(
  schedule: SocialMilestoneSchedule,
  previous: WorldState,
  next: WorldState,
): SocialMilestoneSchedule;

export function currentSocialMilestone(
  schedule: SocialMilestoneSchedule,
  tick: number,
): SocialMilestone | null;
```

Use `INSTITUTION_NAMES` for every candidate/institution name. Preserve
authoritative supporter order in the view model after resolving names. Use
`Math.round(clampedCohesion * 100)` for the percentage.

Queue simultaneous transitions by assigning the next event's
`visibleFromTick` to the greater of `next.tick` and the last queued event's
`expiresAtTick`. Set `expiresAtTick` to
`visibleFromTick + SOCIAL_MILESTONE_DURATION_TICKS`.

These functions compare authoritative snapshots only. They must not calculate
desires, support scores, formation, dissolution, or establishment.

- [ ] **Step 5: Extend the inspect panel with a tested society section**

Change the controller contract in `packages/client/src/ui/inspectPanel.ts`:

```ts
export interface InspectPanelController {
  show(agent: AgentState, world: WorldState): void;
  close(): void;
}
```

Change `buildInspectPanelViewModel` to accept the same world and include:

```ts
foodSecurity: `${Math.round(agent.desires.foodSecurity * 100)}%`;
society: SocietyViewModel;
```

Render these Japanese headings:

- `食料安定への関心`
- `集団`
- `制度`
- `支持者`
- `反対者`

Use `textContent` through the existing `createElement` helper. For empty arrays
render `結成された集団はありません。` and
`成立した制度はありません。`. Do not use `innerHTML`.

Update `packages/client/test/inspectPanel.test.ts` to pass a world fixture and
assert the extended pure view model, including the `foodSecurity` percentage,
collective/institution Japanese names, and supporter names.

- [ ] **Step 6: Extract generic ticker rendering and wire schedules**

Create `packages/client/src/render/tickerLayer.ts` by moving the top-ticker
box/text rendering out of `deathLayer.ts`. Use this contract:

```ts
export type TickerTone = "death" | "social";

export interface TickerMessage {
  text: string;
  tone: TickerTone;
}

export function renderTickerLayer(
  layer: Container,
  message: TickerMessage | null,
): void;
```

Keep the current death border for `death`; use `world-verdigris` equivalent
`0x6f9f91` for `social`. `deathLayer.ts` continues to own tombstone rendering
and no longer owns ticker UI.

In `packages/client/src/main.ts`:

1. initialize a `SocialMilestoneSchedule` on welcome;
2. update it before replacing `state` on each update;
3. mark `tickerDirty` when its queue changes or the active display window
   changes;
4. pass `(selectedAgent, currentWorld)` to every `inspectPanel.show` call;
5. render the current social milestone first, otherwise the latest death
   event, otherwise `null`.

The mapping is:

```ts
const tickerMessage =
  socialMilestone === null
    ? deathEvent === null
      ? null
      : { text: deathEvent.text, tone: "death" as const }
    : { text: socialMilestone.text, tone: "social" as const };
```

Do not add timers or `Date.now()`. Milestone visibility uses authoritative
simulation ticks so replay remains deterministic. The existing
`performance.now()` use for transient thought bubbles is unrelated and must
not be copied into the social schedule.

- [ ] **Step 7: Add minimal inspect-panel styles**

In `packages/client/index.html`, add styles only for the new social section:

- compact unbulleted rows;
- supporter/opponent text that wraps;
- the existing Japanese UI font stack;
- no new floating panel and no new always-visible HUD;
- no animation;
- no color as the only distinction between supporters and opponents.

Keep the existing desktop side panel and mobile bottom-sheet layout. Use the
same section-title hierarchy and 44px close target already present.

- [ ] **Step 8: Run client tests, build, and full pre-commit gates**

Run:

```sh
pnpm vitest run packages/client/test/societyViewModel.test.ts packages/client/test/inspectPanel.test.ts packages/client/test/survivalViewModel.test.ts
pnpm --filter @agent-town/client build
pnpm biome check packages/client/src/ui/societyViewModel.ts packages/client/src/ui/inspectPanel.ts packages/client/src/render/tickerLayer.ts packages/client/src/main.ts packages/client/test/societyViewModel.test.ts
git diff --check
just check && just test
```

Expected: pure view-model tests PASS, client build succeeds, Biome errors 0,
no whitespace errors, and both repository gates PASS.

- [ ] **Step 9: Verify the slice in desktop and mobile browsers**

Run:

```sh
just serve
```

With LLM planning disabled, verify:

1. the top ticker shows `危機認識`, `集団結成`, `制度提案`, and `制度成立`
   in causal order;
2. the ticker does not overlap the survival HUD at 1440×900 or 390×844;
3. selecting a resident shows food-security concern and the current
   collectives/institutions with Japanese supporter names;
4. dissolved collectives disappear from the inspect section;
5. reconnecting after an institution exists does not replay old milestones;
6. death messages still appear when no social milestone is active;
7. no LLM process starts and the browser console has no errors.

Stop the server and confirm port 8790 is no longer listening. Then rerun:

```sh
just check && just test
git status --short
```

Expected: both gates PASS and only Task 4 files are modified.

- [ ] **Step 10: Commit Task 4**

```sh
git add packages/client
git commit -m "feat(client): show food anxiety institutions"
```

## Completion Criteria

- `AgentDesires.foodSecurity` is finite, clamped, and updated from
  `foodDaysRemaining`, days until winter, and recent hunger-interrupt history.
- The candidate set is exactly `communalGranaryStore`, `grainMarket`, and
  `rationControl`, with deterministic culture-weighted affinity plus desire
  pressure.
- At least two sustained supporters form a collective only after the configured
  duration; broken support resets formation and sustained low support dissolves
  it.
- Institution establishment requires both strict population majority and food
  days below the pressure threshold.
- Collectives and institutions carry resolvable §8.1 provenance and stable,
  sorted agent IDs.
- Welcome and update messages both carry authoritative collectives and
  institutions, with fixture tests at shared, server, and client boundaries.
- Same seed and inputs produce the same desire, collective, institution, and
  provenance outcome.
- The client uses pure tested view models for Japanese milestone notifications
  and collectives/institutions with supporters.
- No code in this slice calls an LLM, imports `net/` from `sim/`, reads I/O or
  wall-clock time, or adds a dependency.
- `just check && just test` passes before every task commit.

## Task List

| Order | One-worker assignment | Branch | Depends on | Independent gate |
|---|---|---|---|---|
| 1 | Shared social contracts, constants, fixtures, welcome/update transport | `s3-food-anxiety-01-contracts` | `main` | Focused protocol tests, `just check && just test`, local commit |
| 2 | Food-security desire, hunger history, cultural affinity, support scoring | `s3-food-anxiety-02-desire` | Task 1 commit | Focused sim/engine tests, `just check && just test`, local commit |
| 3 | Collective formation/reset/dissolution, institution gate, provenance, determinism | `s3-food-anxiety-03-institutions` | Task 2 commit | §13.5/13.6 and replay tests, `just check && just test`, local commit |
| 4 | Japanese milestone ticker, inspect-panel social view models, browser verification | `s3-food-anxiety-04-client` | Task 3 commit | Focused client tests/build/browser check, `just check && just test`, local commit |
