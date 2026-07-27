# Settlement Growth Deadlock Implementation Plan

> Bug fix. A failing test comes first and must fail for the stated reason before any source
> change. `just check` and `just test` green before the commit. One Conventional Commit.

**Goal:** an ordinary generated world grows. Today it cannot: no house is ever built, so the
population is pinned at its initial three residents forever, and with three well-fed residents
no institution and no facility can form either. The map has nothing to show because the
simulation produces nothing to show.

**Not a regression from S5.** The two lines that set the thresholds are byte-identical between
`main` and `codex/s5-social-facilities-trails`, and none of the relevant constants changed on
that branch. This dates from `be7181e feat(sim): houses rest and immigration`.

## The deadlock

`FakePlanner.resourceTasks` stops gathering wood once the winter reserve is met:

```ts
if (world.stockpile.wood < winterWoodTarget) { /* gather wood */ }
```

`FakePlanner.newHouseTasks` starts a house only when the reserve *plus* the house cost is held:

```ts
const canAfford = world.stockpile.wood >= HOUSE_WOOD_COST + winterWoodTarget;
```

For the initial three residents `winterWoodTarget` is `3 * WOOD_BURN_PER_AGENT_PER_DAY *
DAYS_PER_SEASON` = 12, and the build threshold is `15 + 12` = 27. Gathering stops at 12,
overshoots to 25 because a haul is granular, and stays at 25. Measured across 12,000 ticks and
five seeds, wood never moves off 25 and no house is ever built.

Everything downstream follows from that:

| Consequence | Mechanism |
| --- | --- |
| No immigration | `hasImmigrationCapacity` is `completedHouses * HOUSE_CAPACITY > agents`, so `0 > 3` is false |
| Population pinned at 3 | immigration is the only growth path |
| No institution | 70 food / 12.5 daily need = 5.6 days, above `INSTITUTION_FOOD_PRESSURE_DAYS` (4), so `establishEligibleInstitutions` returns early |
| No facility, no real trails | facilities require an institution |

The settlement is stable, fed, and permanently three people standing in a field.

## Contract

The gathering target and the building threshold must be derived from one expression, so they
cannot drift apart again. A resident who intends to build gathers enough to build.

```ts
/** Wood the settlement is currently trying to hold: the winter reserve, plus a house when one is wanted. */
export function woodTarget(world: WorldState, winterWoodTarget: number): number;
```

- When housing capacity already exceeds the population, `woodTarget` is exactly
  `winterWoodTarget`; residents must not hoard wood they have no plan for.
- When a house is wanted, `woodTarget` is `winterWoodTarget + HOUSE_WOOD_COST`, the same
  expression `newHouseTasks` tests against. Assert in the test that the two agree by
  construction, not by two literals that happen to match.
- `winterWoodTarget` still scales with population, so the target rises as the settlement grows.
- `newHouseTasks`'s existing capacity guard (`completedCapacity > world.agents.length`) is the
  negation of the same housing question. Express both through one helper so a future change
  cannot move one without the other.

## Measured against a prototype

This approach was prototyped and measured over 40,000 ticks on five seeds, then reverted. It is
not a guess, but it is also not a substitute for the failing test — write that first.

| | before | after |
| --- | --- | --- |
| first completed house | never | tick ~221 |
| houses at 40,000 ticks | 0 | 3 |
| population | 3, pinned | 3 → 5 |
| seeds reaching an institution | 0 of 5 | 1 of 5 (seed 7, tick 34,571) |
| seeds reaching a facility | 0 of 5 | 1 of 5 (seed 7, tick 34,799) |

Two things to understand rather than tune away:

- Population settles at 5, not `MAX_POPULATION`. `maybeImmigrate` only runs on
  `tick % TICKS_PER_YEAR === 0` and admits one arrival, so 40,000 ticks offers two chances.
  That is the designed rate, not a second bug.
- Institutions still appear in only one seed of five, and only near tick 34,500. Closing the
  wood gap does not by itself make the social layer reliably visible. Record this; do not fix
  it here.

## Steps

1. Write the failing test in `packages/server/test/fakePlanner.test.ts` (or a new
   `growth.test.ts` if that file is the wrong home): an ordinary `generateWorld(seed)` run
   through the engine with `FakePlanner` for a bounded number of ticks builds at least one
   completed house and reaches a population above its initial size. Use two or three seeds.
   Confirm it fails, and that it fails because wood plateaus below the build threshold — not
   because the tick budget is too small.
2. Add `woodTarget` and use it in both `resourceTasks` and `newHouseTasks`.
3. Re-run the test. If the settlement now builds but still does not grow, keep going: the
   acceptance criterion is growth, not a house.
4. Keep the test's tick budget honest. A house lands around tick 221, but the first immigrant
   cannot arrive before `TICKS_PER_YEAR`. Derive the budget from that constant rather than
   hard-coding a number, and do not assert on institutions or facilities — at one seed in five
   near tick 34,500 that assertion would be flaky.
5. Confirm no existing test changes meaning. Several suites construct worlds with specific wood
   levels; a changed gathering target may shift them. Never weaken an assertion to get green —
   if a test now describes the old deadlock, that test encoded the bug and its expectation
   needs a stated reason to change.

## Verify

```sh
pnpm vitest run packages/server/test
just check
just test
pnpm --filter @agent-town/client build
git diff --check
```

## Commit

`fix(sim): let residents gather enough wood to build`

## Out of scope

Do not touch rendering, the client, or the V3 documents. Do not tune
`INSTITUTION_FOOD_PRESSURE_DAYS`, `COLLECTIVE_FORMATION_TICKS`, or the hunger constants to
force a livelier settlement; this ticket closes one arithmetic gap and reports what remains.
