# 古い世界と入植地の出自 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 200年・4国家の決定論的な世界史を生成し、入植地の出自と歴史遺構を地図・年代記・国柄カードから確認できる最初の可視vertical sliceを作る。

**Architecture:** `server/sim`に地形生成と独立したseed付き集約歴史生成器を置き、事実・因果・国柄・遺構を`WorldState.history`として共有する。履歴はwelcomeで一度だけ送り、クライアントはPixiJS地図へ遺構を描画し、HTMLの「辺境年代記」パネルで出身国・国柄・因果イベントを読む。LLMは使わず、同じseedから同じ過去と現在が再現される。

**Tech Stack:** TypeScript 7、Vitest、PixiJS 8、WebSocket、Vite、Biome、pnpm、just

---

## スコープ

この計画は、承認済みの
`docs/superpowers/specs/2026-07-23-emergent-fantasy-society-design.md`
のうち、世界史・国家・国柄・入植地への継承・現在に残る歴史的痕跡を実装する。

集団、制度、穀倉、小道、間接介入、LLMによる命名と年代記は別計画に分ける。本計画だけでも、現在の入植者が「どこから、なぜ来たか」と、地図上の遺構が「いつ、なぜ残ったか」をブラウザで確認できる。

新しい依存関係と画像アセットは追加しない。遺構はPixiJSの`Graphics`で描画する。

## ファイル責務

| ファイル | 責務 |
|---|---|
| `packages/shared/src/history.ts` | 世界史、国家、国柄、イベント、遺構、入植地出自の共有型 |
| `packages/shared/src/constants.ts` | 年数、国家数、歴史ターン長など構造的な定数 |
| `packages/shared/src/world.ts` | `WorldState.history`の権威状態 |
| `packages/shared/src/index.ts` | 歴史契約の公開 |
| `packages/server/src/sim/historyGen.ts` | seed付き集約歴史シミュレーションと因果整合性 |
| `packages/server/src/sim/worldGen.ts` | 地形・入植地と生成済み歴史の統合 |
| `packages/client/src/ui/worldChronicle.ts` | 年代記・国柄・入植理由のview modelとDOM描画 |
| `packages/client/src/render/historyLayer.ts` | 地図上の遺構描画 |
| `packages/client/src/ui/infoBubble.ts` | 遺構のhit testと短い因果表示 |
| `packages/client/src/main.ts` | 年代記パネル、ボタン、履歴レイヤーの配線 |
| `packages/client/index.html` | 年代記パネルの骨格と世界固有の視覚トークン |

## 視覚方針

対象は「古い世界の辺境を観察するコロニーシム」、画面の仕事は現在の地図と過去の因果を往復させることである。

### 色

- `Peat #1d2428`: 現在の地図と既存背景
- `Iron #54646b`: 境界と非選択情報
- `Parchment #ded3b3`: 年代記の主文字
- `Ember #d7864b`: 戦争・傷・選択中の因果
- `Verdigris #6f9f91`: 交易・継承・出身国
- `Ley violet #8878a6`: 魔術的異常だけに使う稀少色

### 書体

- 見出し: `Palatino Linotype`, `Book Antiqua`, serif
- 本文: `Georgia`, serif
- 年、値、短いラベル: `ui-monospace`, monospace

外部フォントは読み込まない。既存ゲーム表示のmonospaceと、年代記のserifを役割で分ける。

### レイアウト

```text
┌──────────────────────── GAME MAP ────────────────────────┐
│ [SPRING]                                      [年代記]   │
│                                                         │
│       遺構 ◇        入植地と住民                        │
│                                                         │
│                    遺構を選ぶ → 短い因果吹き出し         │
└─────────────────────────────────────────────────────────┘

                      年代記を開く

┌───────────── FRONTIER CHRONICLE ─────────────────────────┐
│  出身国の紋色 ┃ 入植理由と継承した価値                   │
│──────────────────────────────────────────────────────────│
│  -200 ── 建国 ── 飢饉 ── 戦争 ── 異常 ── 移住 ── 0     │
│──────────────────────────────────────────────────────────│
│  4国家の国柄カード（横送り / 狭幅では縦積み）           │
└──────────────────────────────────────────────────────────┘
```

記憶に残す要素は、地図上の遺構と年代記上の原因イベントを同じ紋色で結ぶ「地層の糸」である。派手な常時アニメーションは使わず、選択したイベント・国家・遺構だけ同色で強調する。`prefers-reduced-motion`時は開閉transitionを無効にする。

## Task 1: 世界史の共有契約を定義する

**Files:**
- Create: `packages/shared/src/history.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/world.ts`
- Modify: `packages/shared/src/index.ts`
- Modify fixtures in: `packages/shared/test/time.test.ts`, `packages/shared/test/protocol.test.ts`, `packages/client/test/infoBubble.test.ts`, `packages/client/test/keyboardNavigation.test.ts`, `packages/client/test/survivalViewModel.test.ts`, `packages/client/test/wsClient.test.ts`, `packages/server/test/astar.test.ts`, `packages/server/test/executor.test.ts`, `packages/server/test/fakePlanner.test.ts`, `packages/server/test/llmPlanner.test.ts`, `packages/server/test/normalizePlan.test.ts`, `packages/server/test/planPrompt.test.ts`, `packages/server/test/planSchema.test.ts`

- [ ] **Step 1: protocol round-tripへ失敗する期待値を追加する**

`packages/shared/test/protocol.test.ts`のwelcome用`WorldState`へ、最小の履歴を追加する。

```ts
history: {
  startYear: -200,
  currentYear: 0,
  polities: [],
  events: [],
  landmarks: [],
  settlementOrigin: null,
},
```

round-trip後の既存deep equalityにより、新フィールドが共有契約へ入っていない状態では型検査が失敗する。

- [ ] **Step 2: 型検査を実行してRedを確認する**

Run:

```sh
pnpm --filter @agent-town/shared exec tsc
```

Expected: `history`または歴史型が未定義のためFAIL。

- [ ] **Step 3: `history.ts`へ厳格な契約を追加する**

`packages/shared/src/history.ts`を作る。

```ts
import type { Position } from "./world.js";

export type CulturalValue =
  | "commerce"
  | "faith"
  | "knowledge"
  | "kinship"
  | "mutualAid"
  | "order"
  | "stewardship"
  | "valor";

export interface CulturalValueWeight {
  value: CulturalValue;
  weight: number;
  changedByEventIds: string[];
}

export interface Polity {
  id: string;
  name: string;
  adjective: string;
  color: number;
  values: CulturalValueWeight[];
  foundingMyth: string;
  formativeTraumaEventIds: string[];
  taboo: string;
  ambition: string;
  governance: string;
}

export type HistoryEventKind =
  | "anomaly"
  | "founding"
  | "migration"
  | "scarcity"
  | "trade"
  | "war";

export type HistoryEffect =
  | { kind: "culture"; targetId: string; value: CulturalValue; delta: number }
  | { kind: "landmark"; targetId: string; landmarkKind: LandmarkKind }
  | { kind: "population"; targetId: string; delta: number }
  | { kind: "relation"; targetId: string; otherPolityId: string; delta: number };

export interface HistoryEvent {
  id: string;
  year: number;
  kind: HistoryEventKind;
  title: string;
  summary: string;
  polityIds: string[];
  causeIds: string[];
  effects: HistoryEffect[];
}

export type LandmarkKind = "borderFort" | "ruin" | "standingStone";

export interface HistoricalLandmark {
  id: string;
  kind: LandmarkKind;
  name: string;
  pos: Position;
  polityId: string;
  foundedByEventId: string;
}

export interface SettlementOrigin {
  homelandPolityId: string;
  departureEventId: string;
  reason: string;
  inheritedValues: CulturalValue[];
}

export interface WorldHistory {
  startYear: number;
  currentYear: number;
  polities: Polity[];
  events: HistoryEvent[];
  landmarks: HistoricalLandmark[];
  settlementOrigin: SettlementOrigin | null;
}
```

`packages/shared/src/constants.ts`へ追加する。

```ts
export const WORLD_HISTORY_YEARS = 200;
export const WORLD_HISTORY_TURN_YEARS = 20;
export const WORLD_POLITY_COUNT = 4;
```

`WorldState`へ必須だが明示的に空を許すフィールドを追加する。

```ts
import type { WorldHistory } from "./history.js";

export interface WorldState {
  // existing fields...
  history: WorldHistory;
}
```

`packages/shared/src/index.ts`から`history.ts`をexportする。

- [ ] **Step 4: test fixtureを新契約へ移行する**

列挙した各`WorldState` fixtureへ次を追加する。

```ts
history: {
  startYear: 0,
  currentYear: 0,
  polities: [],
  events: [],
  landmarks: [],
  settlementOrigin: null,
},
```

生成済み`WorldState`を使うfixtureは変更しない。optional fieldにはせず、wire境界で履歴の有無を曖昧にしない。

- [ ] **Step 5: sharedと全体の型検査を通す**

Run:

```sh
pnpm --filter @agent-town/shared exec tsc
pnpm -r exec tsc
```

Expected: TypeScript errors 0。

- [ ] **Step 6: 変更箇所と差分を確認する**

Run:

```sh
rg -n 'history:' packages --glob '*.ts'
git diff --check
```

Expected: `WorldState`生成箇所と明示したfixtureだけに`history`が存在し、whitespace errorなし。

- [ ] **Step 7: commitする**

```sh
git add packages/shared packages/client/test packages/server/test
git commit -m "feat(shared): define old world history contracts"
```

## Task 2: 200年の決定論的な集約歴史を生成する

**Files:**
- Create: `packages/server/src/sim/historyGen.ts`
- Create: `packages/server/test/historyGen.test.ts`

- [ ] **Step 1: 再現性・差分・因果整合性の失敗テストを書く**

`packages/server/test/historyGen.test.ts`を作る。

```ts
import { WORLD_HISTORY_YEARS, WORLD_POLITY_COUNT } from "@agent-town/shared";
import { describe, expect, it } from "vitest";

import { generateWorldHistory } from "../src/sim/historyGen.js";

describe("generateWorldHistory", () => {
  it("replays the same two centuries from the same seed", () => {
    expect(generateWorldHistory(42)).toEqual(generateWorldHistory(42));
  });

  it("changes polity order and events for a different seed", () => {
    expect(generateWorldHistory(42)).not.toEqual(generateWorldHistory(43));
  });

  it("creates four polities, two hundred years, and a migration origin", () => {
    const history = generateWorldHistory(42);

    expect(history.currentYear - history.startYear).toBe(WORLD_HISTORY_YEARS);
    expect(history.polities).toHaveLength(WORLD_POLITY_COUNT);
    expect(history.settlementOrigin).not.toBeNull();
  });

  it("keeps every cause, trauma, origin, and landmark reference resolvable", () => {
    const history = generateWorldHistory(42);
    const eventIds = new Set(history.events.map(({ id }) => id));

    for (const event of history.events) {
      for (const causeId of event.causeIds) expect(eventIds.has(causeId)).toBe(true);
    }
    for (const polity of history.polities) {
      for (const traumaId of polity.formativeTraumaEventIds) {
        expect(eventIds.has(traumaId)).toBe(true);
      }
    }
    for (const landmark of history.landmarks) {
      expect(eventIds.has(landmark.foundedByEventId)).toBe(true);
    }
    expect(eventIds.has(history.settlementOrigin?.departureEventId ?? "")).toBe(true);
  });

  it("contains a costly anomaly and derives the final migration from an earlier pressure", () => {
    const history = generateWorldHistory(42);
    const anomaly = history.events.find(({ kind }) => kind === "anomaly");
    const departure = history.events.find(
      ({ id }) => id === history.settlementOrigin?.departureEventId,
    );

    expect(anomaly?.effects.some(({ kind }) => kind === "culture")).toBe(true);
    expect(departure?.kind).toBe("migration");
    expect(departure?.causeIds.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: focused testのRedを確認する**

Run:

```sh
pnpm vitest run packages/server/test/historyGen.test.ts
```

Expected: `historyGen.ts`が存在しないためFAIL。

- [ ] **Step 3: 内部状態と素材表を定義する**

`packages/server/src/sim/historyGen.ts`に、公開型とは分離した可変内部状態を作る。

```ts
interface MutablePolity {
  id: string;
  name: string;
  adjective: string;
  color: number;
  population: number;
  relation: number;
  values: Map<CulturalValue, { weight: number; changedByEventIds: string[] }>;
  foundingMyth: string;
  traumaIds: string[];
  taboo: string;
  ambition: string;
  governance: string;
  latestEventId: string;
}
```

国家名、創設神話、禁忌、野心、統治慣行は8組以上の素材表からseed付きshuffleで4組を選ぶ。国家の`id`とイベント`id`は配列順と年から組み立て、乱数文字列や時刻を使わない。

- [ ] **Step 4: 20年単位の因果ループを実装する**

`generateWorldHistory(seed)`は専用の`createRng(seed ^ 0x5f3759df)`を使い、地形生成の乱数列へ影響させない。

```ts
export function generateWorldHistory(seed: number): WorldHistory {
  const rng = createRng(seed ^ 0x5f3759df);
  const polities = createPolities(rng);
  const events = createFoundingEvents(polities);

  for (
    let year = -WORLD_HISTORY_YEARS + WORLD_HISTORY_TURN_YEARS;
    year < 0;
    year += WORLD_HISTORY_TURN_YEARS
  ) {
    simulateTurn(rng, year, polities, events);
  }

  ensureAnomaly(rng, polities, events);
  const departure = createDeparture(rng, polities, events);
  return finalizeHistory(polities, events, departure);
}
```

`simulateTurn`は、主体国家、近隣国家、気候圧、関係値を入力として`scarcity`、`trade`、`war`のいずれかを生成する。各イベントは主体の`latestEventId`を`causeIds`へ入れ、人口・関係・文化値を更新する。更新した文化値の`changedByEventIds`へ同じイベントIDを記録する。

`ensureAnomaly`は履歴中に一度だけ、希少資源を得る代わりに人口減少または禁忌強化が起きる`anomaly`を作る。万能な利益だけのイベントにしない。

`createDeparture`は出身国の直近の`scarcity`、`war`、`anomaly`を原因とする年-1の`migration`を作る。`SettlementOrigin.reason`は原因イベントの構造化結果から決定論的に選ぶ。

- [ ] **Step 5: focused testを通す**

Run:

```sh
pnpm vitest run packages/server/test/historyGen.test.ts
```

Expected: 5 tests PASS。

- [ ] **Step 6: 100 seedの不変条件テストを追加する**

同じtest fileへ追加する。

```ts
it("preserves referential integrity across one hundred seeds", () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const history = generateWorldHistory(seed);
    const ids = new Set(history.events.map(({ id }) => id));
    expect(ids.size).toBe(history.events.length);
    expect(history.polities).toHaveLength(WORLD_POLITY_COUNT);
    expect(history.events.every(({ causeIds }) => causeIds.every((id) => ids.has(id)))).toBe(true);
  }
});
```

- [ ] **Step 7: focused test、lint、差分検査を通す**

Run:

```sh
pnpm vitest run packages/server/test/historyGen.test.ts
pnpm biome check packages/server/src/sim/historyGen.ts packages/server/test/historyGen.test.ts
git diff --check
```

Expected: tests PASS、Biome errors 0、whitespace errorなし。

- [ ] **Step 8: commitする**

```sh
git add packages/server/src/sim/historyGen.ts packages/server/test/historyGen.test.ts
git commit -m "feat(sim): generate causal old world history"
```

## Task 3: 歴史を現在の地図へ接続する

**Files:**
- Modify: `packages/server/src/sim/historyGen.ts`
- Modify: `packages/server/src/sim/worldGen.ts`
- Modify: `packages/server/test/historyGen.test.ts`
- Modify: `packages/server/test/worldGen.test.ts`
- Modify: `packages/server/test/wsServer.test.ts`
- Modify: `packages/client/test/wsClient.test.ts`

- [ ] **Step 1: 地図上の遺構とwelcome保持の失敗テストを書く**

`packages/server/test/worldGen.test.ts`へ追加する。

```ts
it("anchors old-world landmarks on distinct walkable tiles away from the stockpile", () => {
  const world = generateWorld(42);
  const positions = new Set<string>();

  expect(world.history.landmarks.length).toBeGreaterThan(0);
  for (const landmark of world.history.landmarks) {
    const key = `${landmark.pos.x},${landmark.pos.y}`;
    expect(positions.has(key)).toBe(false);
    expect(landmark.pos).not.toEqual(world.stockpile.pos);
    expect(["plains", "forest"]).toContain(tileAt(world.tiles, landmark.pos)?.terrain);
    positions.add(key);
  }
});
```

`packages/client/test/wsClient.test.ts`のwelcome履歴へ識別可能な国家名を入れ、update後にも同じ`history`参照内容が残ることを期待する。

```ts
expect(onUpdate).toHaveBeenCalledWith(
  expect.objectContaining({
    history: expect.objectContaining({ startYear: -200 }),
  }),
);
```

- [ ] **Step 2: focused testのRedを確認する**

Run:

```sh
pnpm vitest run packages/server/test/worldGen.test.ts packages/client/test/wsClient.test.ts
```

Expected: 遺構位置または生成履歴が未統合のためFAIL。

- [ ] **Step 3: walkableな遺構位置を割り当てる**

`historyGen.ts`の公開関数を次の契約にする。

```ts
interface HistoryMap {
  width: number;
  height: number;
  tiles: Tile[];
  stockpile: Position;
}

export function generateWorldHistory(seed: number, map?: HistoryMap): WorldHistory;
```

mapがある場合は、stockpileからマンハッタン距離12以上、`plains`または`forest`、資源なしの候補を行優先で収集する。専用rngで候補を選び、同じタイルを重複利用しない。候補不足時だけ距離条件を6へ緩め、それでも不足する場合は作れる数だけ返す。

各遺構は`war`から`borderFort`または`ruin`、`anomaly`から`standingStone`を作り、`foundedByEventId`を原因イベントへ結ぶ。

- [ ] **Step 4: `generateWorld`へ歴史を統合する**

`packages/server/src/sim/worldGen.ts`では既存の地形、stockpile、agentを作り、spawn areaをwalkableにした後で履歴を生成する。

```ts
const history = generateWorldHistory(seed, {
  width: MAP_WIDTH,
  height: MAP_HEIGHT,
  tiles,
  stockpile: stockpilePosition,
});

return {
  tick: 0,
  width: MAP_WIDTH,
  height: MAP_HEIGHT,
  tiles,
  agents,
  stockpile: { pos: stockpilePosition, wood: 0, food: 0 },
  buildings: [],
  deaths: [],
  history,
};
```

- [ ] **Step 5: 更新メッセージが静的履歴を複製しないことを確認する**

`packages/server/test/wsServer.test.ts`で`createUpdateMessage`の結果に`history`キーがないことを明示する。

```ts
expect("history" in createUpdateMessage(engine)).toBe(false);
```

welcomeは従来どおり完全な`WorldState`を送る。`wsClient.applyUpdate`はspreadした既存stateを返すため、historyを保持する。

- [ ] **Step 6: focused testと全体型検査を通す**

Run:

```sh
pnpm vitest run packages/server/test/historyGen.test.ts packages/server/test/worldGen.test.ts packages/server/test/wsServer.test.ts packages/client/test/wsClient.test.ts
pnpm -r exec tsc
```

Expected: tests PASS、TypeScript errors 0。

- [ ] **Step 7: commitする**

```sh
git add packages/server/src/sim packages/server/test packages/client/test
git commit -m "feat(sim): anchor old world history in the settlement map"
```

## Task 4: 年代記と国柄を読み取れるview modelを作る

**Files:**
- Create: `packages/client/src/ui/worldChronicle.ts`
- Create: `packages/client/test/worldChronicle.test.ts`

- [ ] **Step 1: 出身国・文化・因果順の失敗テストを書く**

`packages/client/test/worldChronicle.test.ts`を作り、4国家、原因イベント、移住イベントを持つfixtureから次を検証する。

```ts
const view = buildWorldChronicleViewModel(historyFixture());

expect(view.eraLabel).toBe("開拓以前の200年間");
expect(view.origin).toEqual({
  homelandName: "黒貂辺境国",
  reason: "国境戦争の後、最後の穀倉が尽きた。",
  inheritedValues: ["相互扶助", "秩序"],
});
expect(view.polities[0]).toEqual(
  expect.objectContaining({
    name: "黒貂辺境国",
    isHomeland: true,
    values: expect.arrayContaining(["相互扶助", "秩序"]),
  }),
);
expect(view.events.at(-1)).toEqual(
  expect.objectContaining({ kind: "migration", causes: ["黒貂・金環国境戦争"] }),
);
```

- [ ] **Step 2: focused testのRedを確認する**

Run:

```sh
pnpm vitest run packages/client/test/worldChronicle.test.ts
```

Expected: `worldChronicle.ts`が存在しないためFAIL。

- [ ] **Step 3: 純粋なview model変換を実装する**

`buildWorldChronicleViewModel(history)`は次を返す。

```ts
export interface WorldChronicleViewModel {
  eraLabel: string;
  origin: {
    homelandName: string;
    reason: string;
    inheritedValues: string[];
  } | null;
  polities: {
    id: string;
    name: string;
    adjective: string;
    color: number;
    foundingMyth: string;
    traumaTitles: string[];
    taboo: string;
    ambition: string;
    governance: string;
    values: string[];
    isHomeland: boolean;
  }[];
  events: {
    id: string;
    year: number;
    kind: HistoryEventKind;
    title: string;
    summary: string;
    causes: string[];
    polityIds: string[];
  }[];
}
```

イベントは`year`昇順、同年は`id`昇順にする。文化値はweight降順で上位3件を表示する。event IDを表示文へ露出させず、`causeIds`をイベントtitleへ解決する。

- [ ] **Step 4: DOM controllerを実装する**

同じファイルに`createWorldChronicle(root, onClose)`を追加する。

```ts
export interface WorldChronicleController {
  show(history: WorldHistory): void;
  close(): void;
  isOpen(): boolean;
}
```

すべてのゲーム由来文字列は`textContent`で挿入する。HTML文字列連結と`innerHTML`を使わない。国家カード、年表、出身欄を小さなDOM生成関数へ分け、各関数の認知的複雑度を10以下に保つ。

- [ ] **Step 5: focused testとlintを通す**

Run:

```sh
pnpm vitest run packages/client/test/worldChronicle.test.ts
pnpm biome check packages/client/src/ui/worldChronicle.ts packages/client/test/worldChronicle.test.ts
```

Expected: tests PASS、Biome errors 0。

- [ ] **Step 6: commitする**

```sh
git add packages/client/src/ui/worldChronicle.ts packages/client/test/worldChronicle.test.ts
git commit -m "feat(client): explain settlement origins in a world chronicle"
```

## Task 5: 歴史遺構を地図上で見て選べるようにする

**Files:**
- Create: `packages/client/src/render/historyLayer.ts`
- Modify: `packages/client/src/render/sprites.ts`
- Modify: `packages/client/src/ui/infoBubble.ts`
- Modify: `packages/client/test/sprites.test.ts`
- Modify: `packages/client/test/infoBubble.test.ts`
- Modify: `packages/client/test/keyboardNavigation.test.ts`

- [ ] **Step 1: 遺構のdepth・hit priority・因果文の失敗テストを書く**

`packages/client/test/sprites.test.ts`へ追加する。

```ts
expect(objectDepth(4, "resource")).toBeLessThan(objectDepth(4, "landmark"));
expect(objectDepth(4, "landmark")).toBeLessThan(objectDepth(4, "agent"));
```

`packages/client/test/infoBubble.test.ts`へ、遺構を持つworld fixtureを追加し、次を検証する。

```ts
expect(resolveInfoBubbleTarget(world, [], new Map(), { x: 8, y: 8 })).toEqual({
  kind: "landmark",
  landmarkId: "landmark-1",
});
expect(buildLandmarkBubbleText(world.history.landmarks[0]!, world.history)).toBe(
  "古き黒貂国境砦 — 黒貂・金環国境戦争の後に築かれた（−80年）",
);
```

優先順位は`agent > tombstone > house > landmark > stockpile > resource > terrain`とする。

- [ ] **Step 2: focused testのRedを確認する**

Run:

```sh
pnpm vitest run packages/client/test/sprites.test.ts packages/client/test/infoBubble.test.ts packages/client/test/keyboardNavigation.test.ts
```

Expected: `landmark` kindとbubble builderが未定義のためFAIL。

- [ ] **Step 3: 遺構レイヤーを実装する**

`packages/client/src/render/historyLayer.ts`に`renderHistoryLayer`を作る。

```ts
export function renderHistoryLayer(
  layer: Container,
  landmarks: HistoricalLandmark[],
  selectedLandmarkId: string | null,
): void;
```

- `ruin`: 欠けた石壁を灰色の矩形3つで描く
- `borderFort`: 石の輪郭と小さなEmber色の旗
- `standingStone`: 縦長の石とLey violet色の細い刻印
- 選択中: 国家色の1px輪郭を追加

各objectは`landmark-object` label、`objectDepth(pos.y, "landmark")`を持つ。常時pulseやparticleは追加しない。

- [ ] **Step 4: depthとhit testを拡張する**

`WorldObjectKind`へ`"landmark"`を追加し、同じ行のresourceより前、agentより後ろになるdepthを割り当てる。

`InfoBubbleTarget`へ追加する。

```ts
| { kind: "landmark"; landmarkId: string }
```

`resolveInfoBubbleTarget`はtile位置と一致する遺構を追加し、`buildInfoBubbleViewModel`はイベントを`foundedByEventId`で解決して短い因果文を作る。参照イベントが欠ける場合は`"origin unknown"`と明示し、例外や空文字にしない。

- [ ] **Step 5: keyboard経路も同じhit testで通ることを確認する**

`packages/client/test/keyboardNavigation.test.ts`で上位objectを順に除去し、houseの次にlandmarkが選ばれることを追加する。別のkeyboard専用判定は実装しない。

- [ ] **Step 6: focused testと型検査を通す**

Run:

```sh
pnpm vitest run packages/client/test/sprites.test.ts packages/client/test/infoBubble.test.ts packages/client/test/keyboardNavigation.test.ts
pnpm -r exec tsc
```

Expected: tests PASS、TypeScript errors 0。

- [ ] **Step 7: commitする**

```sh
git add packages/client/src/render packages/client/src/ui/infoBubble.ts packages/client/test
git commit -m "feat(client): reveal old world landmarks on the map"
```

## Task 6: 年代記パネルをゲームへ配線し、ブラウザで検証する

**Files:**
- Modify: `packages/client/src/main.ts`
- Modify: `packages/client/index.html`
- Modify: `packages/client/src/net/wsClient.ts` only if static history retention needs correction
- Modify: `README.md`

- [ ] **Step 1: 年代記パネルのHTML骨格を追加する**

`packages/client/index.html`へ、canvasの前後関係を壊さない固定UIを追加する。

```html
<button id="chronicle-toggle" class="chronicle-toggle" type="button" hidden>
  年代記を開く
</button>
<aside
  id="world-chronicle"
  class="world-chronicle"
  aria-labelledby="world-chronicle-title"
  hidden
></aside>
```

ボタンは右上へ置き、年代記はdesktopで右側`min(34rem, 46vw)`、600px以下で下側`max-height: 72dvh`とする。既存inspect panelと同時表示せず、片方を開いたら片方を閉じる。

- [ ] **Step 2: 視覚トークンと状態スタイルを実装する**

`index.html`の既存styleへ、視覚方針の6色をCSS custom propertiesで追加する。カードを均一な角丸カード群にせず、国家色の左罫線、年のmonospace、本文のserifで情報の役割を示す。

必須状態:

```css
.world-chronicle[hidden],
.chronicle-toggle[hidden] {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .world-chronicle,
  .chronicle-toggle {
    transition: none;
  }
}
```

buttonの`:focus-visible`、狭幅のsafe-area padding、縦scroll、44px以上のtouch targetを含める。

- [ ] **Step 3: `main.ts`へ履歴UIとレイヤーを配線する**

起動時にrootを取得し、存在しなければ他の必須rootと同様にthrowする。

```ts
const chronicle = createWorldChronicle(chronicleRoot, closeWorldChronicle);
```

welcome受信後、履歴がある場合だけtoggleを表示する。toggle clickでinspect panelとinfo bubbleを閉じ、chronicleを開く。Escapeはchronicleを閉じる。

`historyLayer`をobject layerの兄弟ではなく既存`objectLayer`内へ描き、`historyDirty`をwelcome時と遺構選択時だけ立てる。毎tick再描画しない。

遺構bubbleの選択時には同じ`landmarkId`をレイヤーへ渡し、国家色の輪郭を表示する。

- [ ] **Step 4: READMEへ観察方法を追加する**

既存の起動手順へ、次の確認点を短く追加する。

```md
- Open **Chronicle** to inspect the four old-world polities and the settlers' reason for leaving.
- Select a ruin or standing stone on the map to trace it to the event that created it.
- World history is deterministic for the server seed and does not consume LLM quota.
```

- [ ] **Step 5: 全品質ゲートを通す**

Run:

```sh
just check
just test
pnpm --filter @agent-town/client build
npx secretlint .
git diff --check
```

Expected: checks PASS、全test PASS、client build成功、secret findings 0、whitespace errorなし。

- [ ] **Step 6: ローカルサーバーをLLMなしで起動する**

Run:

```sh
just serve
```

Expected: `http://localhost:8790`が200を返し、LLM CLI processは起動しない。

- [ ] **Step 7: desktopとmobile viewportで視覚確認する**

ブラウザで最低限次を確認する。

1. 1440×900で年代記ボタンがHUDやtickerと重ならない。
2. 年代記を開くと、入植理由、出身国、4国家、-200から-1までの因果年表が読める。
3. 地図上にruinまたはstanding stoneがあり、選択すると原因イベントと年が出る。
4. 年代記と住民inspect panelが同時に開かない。
5. 390×844で年代記が下側sheetとなり、地図へ戻れる。
6. keyboardだけで年代記ボタンと地図上の遺構を操作できる。
7. console errorがない。

画面全体のdesktop screenshotとmobile screenshotを保存し、空のパネル、文字切れ、過剰な装飾がないか自己批評する。情報を説明しない装飾があれば1つ削る。

- [ ] **Step 8: serverを停止し、最終検証する**

起動したprocessを終了し、port 8790がlistenしていないことを確認する。

Run:

```sh
just check
just test
git status --short
```

Expected: checks PASS、全test PASS、意図した変更だけが表示される。

- [ ] **Step 9: commitする**

```sh
git add packages/client README.md
git commit -m "feat(client): open the frontier chronicle"
```

## 完了条件

- 同じseedから同じ200年史、4国家、入植理由、遺構が生成される。
- 異なるseedでは国家順または歴史イベントが変わる。
- すべての原因、傷、移住、遺構参照が実在イベントへ解決できる。
- 魔術的異常は利益だけでなく代償を持つ。
- 履歴はwelcomeで送られ、10 Hzのupdateへ重複しない。
- 地図上の遺構をpointerとkeyboardの両方で選べる。
- 年代記で出身国の国柄と入植理由を読み、原因イベントへ遡れる。
- LLMを無効にした通常の`just serve`で完動し、quotaを消費しない。
- `just check`、`just test`、client build、secretlintがすべて成功する。
