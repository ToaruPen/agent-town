# LLMクォータガード Implementation Plan

> **For agentic workers:** このセッション内で直接実装する。レビュアーsubagentは起動しない。production codeを変更する前に、振る舞いごとの失敗テストを確認する。

**Goal:** Claudeのモデルを明示的に固定し、住民のLLM思考を設定可能なcooldownと全体時間上限で制限する。

**Architecture:** process設定は`packages/server/src/index.ts`で読み、既存のWebSocket server factoryを経由してrunnerと`ThoughtBroker`へ渡す。単一flightのbrokerが実際の思考開始tickだけを記録し、1時間windowから外れた開始を除去してから呼び出し可否を決める。上限で見送った住民は`thinking`を解除し、simulationのfake plannerを継続させる。

**Tech Stack:** TypeScript、Vitest、pnpm、Biome

## 全体制約

- `main`から`llm-quota-guard` branchを作る。
- 振る舞いの変更ごとにRed → Green → Refactorを行う。
- `packages/server/src/sim/`の決定論とLLM I/Oからの分離を維持する。
- 依存関係を追加しない。
- 最終commit前に`just check`と`just test`を実行する。
- `feat(llm): quota guard with call budget cooldown and claude model pin`という単一のlocal commitを作り、pushしない。

---

### Task 1: Claudeモデルを固定する

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/server/src/llm/claudeRunner.ts`
- Test: `packages/server/test/claudeRunner.test.ts`

**Interfaces:**
- Produces: `LLM_CLAUDE_MODEL_DEFAULT = "haiku"`
- Produces: `new CliClaudeRunner({ model?: string })`

- [ ] 既存のspawn引数testへ`["--model", "haiku"]`の期待値を追加する。
- [ ] `pnpm vitest run packages/server/test/claudeRunner.test.ts`を実行し、引数assertionの失敗を確認する。
- [ ] 共有default定数を追加し、runnerのconstructorとspawn引数で使う。
- [ ] `{ model: "sonnet" }`でrunnerを生成するtestを追加する。
- [ ] override実装前に`"haiku"`を受け取って失敗することを確認する。
- [ ] constructorのmodelを保持し、focused testをGreenにする。

### Task 2: cooldownの既定値と設定を変更する

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/server/src/llm/thoughtBroker.ts`
- Test: `packages/server/test/thoughtBroker.test.ts`

**Interfaces:**
- Produces: `THINK_COOLDOWN_TICKS = 1200`
- Produces: `ThoughtBrokerOptions.cooldownTicks?: number`

- [ ] cooldown testで1,200 tickというliteralの既定値をassertする。
- [ ] `pnpm vitest run packages/server/test/thoughtBroker.test.ts`を実行し、従来の300 tick動作で失敗することを確認する。
- [ ] 共有定数を1,200へ変更する。
- [ ] 短い`cooldownTicks` overrideのfocused testを追加し、失敗を確認する。
- [ ] constructorで既定値を一度解決し、成功・失敗requestの両方に使う。

### Task 3: 全体sliding-window予算を適用する

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/server/src/llm/thoughtBroker.ts`
- Test: `packages/server/test/thoughtBroker.test.ts`

**Interfaces:**
- Produces: `LLM_MAX_CALLS_PER_HOUR = 30`
- Produces: `TICKS_PER_HOUR = 36000`
- Produces: `ThoughtBrokerOptions.maxCallsPerHour?: number`

- [ ] 上限2件でClaude住民とCodex住民を開始し、window内の3件目を止め、見送った住民を`thinking`から外し、tick 36,000でtick 0がwindow外になった後に再開するtestを追加する。
- [ ] focused testを実行し、予算実装前は3件目が開始されて失敗することを確認する。
- [ ] 実際のdispatch開始を記録し、`currentTick - TICKS_PER_HOUR`以前を除去して、残数が設定上限ならdispatchを見送る。
- [ ] 予算枯渇の反復がtick 0と1,000だけでlogされるtestを追加する。
- [ ] Redを確認してから、broker単位のlog抑制と`{"at":"thoughtBroker","outcome":"budget-exhausted","tick":N}`を追加する。

### Task 4: 環境設定を解析して伝搬する

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/net/wsServer.ts`
- Test: `packages/server/test/index.test.ts`

**Interfaces:**
- Consumes: `LLM_CLAUDE_MODEL`, `LLM_COOLDOWN_TICKS`, `LLM_MAX_CALLS_PER_HOUR`
- Produces: optional `llmClaudeModel`, `llmCooldownTicks`, and `llmMaxCallsPerHour` server options

- [ ] `startServer`をmockして`index.ts`をimportし、正しい環境値が変換・伝搬されることをassertする。
- [ ] 0、負数、小数、非数値、空文字、安全整数超過のtable-driven caseを追加し、変数名と正整数契約を含むerrorを要求する。
- [ ] `pnpm vitest run packages/server/test/index.test.ts`を実行し、新しいassertionの失敗を確認する。
- [ ] `index.ts`へ厳密な正のsafe integer parserを追加し、未設定値を省略して`startServer`と`createThoughtBroker`へ設定値を渡す。

### Task 5: 検証してcommitする

**Files:**
- Inspect: 変更した全fileとtest

- [ ] runner、broker、provider integration、index設定のfocused server testを実行する。
- [ ] 新しいidentifierとliteralを`rg`で検索し、意図したownerとcallerだけにあることを確認する。
- [ ] `just check`を実行する。
- [ ] `just test`を実行する。
- [ ] `git diff --check`、`git diff`、`git status`を確認する。
- [ ] scope内の全変更を`feat(llm): quota guard with call budget cooldown and claude model pin`でlocal commitする。
- [ ] branchがcleanでcommitが`HEAD`にあることを確認し、pushしない。
